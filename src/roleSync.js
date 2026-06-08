// =====================================================================
// ROLE & NICKNAME SYNC SYSTEM
// Mirrors a linked player's in-game identity (class / subclass / level /
// Section ID) into Discord roles, and appends their live level to their
// nickname. Assign-existing-only: an admin must pre-create the roles;
// the bot never creates or recolors roles, it only adds/removes them.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { ChannelType } = require('discord.js');
const { config, MEMORY_DIR } = require('./config');
const { apiCall } = require('./api');
const { logInfo, logWarn, logError } = require('./actionLog');
const { lurkerTier } = require('./interactions');
const { canSupport, memberTier, resolveMember } = require('./permissions');
const {
    SUBCLASS_TO_MAIN,
    SECTION_ID_NAMES,
    LEVEL_ROLE_NAMES,
    MANAGED_ROLE_NAMES,
    normalizeSectionId,
    normalizeClass,
    levelRoleName,
} = require('./pso');

// Every identity role the bot is designed to manage, in display order and grouped,
// so the audit can report exactly what exists / is missing / is mispositioned.
const MANAGED_ROLE_GROUPS = {
    'Main classes': [...new Set(Object.values(SUBCLASS_TO_MAIN))], // Hunter, Ranger, Force
    Subclasses: Object.keys(SUBCLASS_TO_MAIN),
    'Section IDs': [...SECTION_ID_NAMES],
    'Level roles': [...LEVEL_ROLE_NAMES],
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Detect whether a get_player response represents a linked account that actually has
// at least one real character. The all-slots API returns every one of the 20 slots,
// padding empty ones with { slot, exists: false }, so a bare length check would treat
// a character-less account as linked. Require a slot that isn't an empty placeholder
// (legacy/online entries have no `exists` field, so `exists !== false` keeps them).
function isLinked(playerInfo) {
    if (!playerInfo || playerInfo.error) return false;
    if (playerInfo.linked === false) return false;
    const chars = playerInfo.Characters || playerInfo.characters;
    return Array.isArray(chars) && chars.some((c) => c && c.exists !== false);
}

// Pick the relevant character. Preference order:
//   1. the live "last played" character (LastPlayerName) — only present while online,
//   2. a character flagged active,
//   3. `fallbackName` — the last active character the bot saw for this player while
//      they were online (Option A cache), used to keep offline syncs on their real
//      last-used character instead of guessing,
//   4. the highest-level character,
//   5. the first character.
function selectProfile(playerInfo, fallbackName = null) {
    if (!playerInfo) return null;
    // Drop empty-slot placeholders (exists:false) so every later step — name match,
    // active flag, highest-level fallback — only ever considers real characters.
    const chars = (playerInfo.Characters || playerInfo.characters || []).filter((c) => c && c.exists !== false);
    if (chars.length === 0) return null;

    const charNameOf = (c) => c.name || c.Name || c.character_name || c.CharacterName;
    const findByName = (name) => name
        ? chars.find((c) => {
            const cName = charNameOf(c);
            return cName && cName.toLowerCase() === String(name).toLowerCase();
        })
        : null;

    const lastPlayerName = playerInfo.LastPlayerName || playerInfo.last_player_name;
    let chosen = findByName(lastPlayerName);
    if (!chosen) chosen = chars.find((c) => c.is_active || c.isActive || c.active || c.Active);
    if (!chosen) chosen = findByName(fallbackName);
    if (!chosen) {
        chosen = chars.reduce((best, c) => {
            const lvl = parseInt(c.level || c.Level || 0) || 0;
            const bestLvl = best ? (parseInt(best.level || best.Level || 0) || 0) : -1;
            return lvl > bestLvl ? c : best;
        }, null);
    }
    if (!chosen) chosen = chars[0];

    return {
        is_online: !!playerInfo.is_online,
        charName: chosen.name || chosen.Name || chosen.character_name || chosen.CharacterName || null,
        charClass: chosen.class || chosen.Class || chosen.className || chosen.ClassName,
        charLevel: parseInt(chosen.level || chosen.Level || 0) || 0,
        sectionId: normalizeSectionId(chosen.section_id || chosen.SectionID || chosen.sectionId || chosen.Section_ID || chosen.section || chosen.Section)
    };
}

function computeTargetRoleNames(profile) {
    const result = { classRole: null, subRole: null, levelRole: null, sectionRole: null };
    if (!profile) return result;
    const sub = normalizeClass(profile.charClass);
    if (sub) {
        result.subRole = sub;
        result.classRole = SUBCLASS_TO_MAIN[sub] || null;
    }
    if (profile.charLevel) result.levelRole = levelRoleName(profile.charLevel);
    if (profile.sectionId) result.sectionRole = profile.sectionId;
    return result;
}

// Warn once per missing role so admins know what to create.
const warnedMissingRoles = new Set();
function findGuildRole(guild, name) {
    if (!name) return null;
    const role = guild.roles.cache.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (!role && !warnedMissingRoles.has(name.toLowerCase())) {
        warnedMissingRoles.add(name.toLowerCase());
        logWarn('ROLE-SYNC', `Missing role "${name}" in "${guild.name}" — create it so the bot can assign it.`);
    }
    return role;
}

// Admin-defined allowlist of roles the bot must NEVER strip, even if they have no
// permissions. Useful for opt-in cosmetic roles (pronouns, colors, event roles) that
// would otherwise be removed on a sync. Matched case-insensitively by role name OR id.
const PROTECTED_ROLES = new Set(
    ((config.role_sync || {}).protected_roles || []).map((r) => String(r).toLowerCase())
);

// A role is a strippable cosmetic role — one the bot may freely remove and replace
// during a sync — when it has NO permissions ("permissions set to none"), OR its name
// is one of our known managed identity roles. We never strip: protected roles, the
// known target roles excepted; integration/booster roles (r.managed); or any role
// at/above the bot in the hierarchy (!r.editable), since Discord would reject the
// whole update.
function isStrippableRole(role) {
    if (!role) return false;
    if (role.managed || !role.editable) return false;
    if (PROTECTED_ROLES.has(role.id) || PROTECTED_ROLES.has(role.name.toLowerCase())) return false;
    const zeroPerms = role.permissions.bitfield === 0n;
    return zeroPerms || MANAGED_ROLE_NAMES.has(role.name.toLowerCase());
}

// Section ID role names (lowercased) — used by the per-user "!lock secid" feature
// to recognise and preserve a member's current Section ID role during a sync.
const SECTION_ID_ROLE_SET = new Set([...SECTION_ID_NAMES].map((n) => String(n).toLowerCase()));

// Text/emoji prefix prepended to every linked member's nickname on a successful
// sync. Applied REGARDLESS of the per-user nickname lock (the lock only governs
// the "LVL<level>" suffix). Configurable via role_sync.nickname_prefix; defaults
// to the 💠 emoji (U+1F4A0, a real Unicode codepoint that renders in Discord
// nicknames, unlike a custom :shortcode:). Set to "" to disable entirely.
const NICK_PREFIX = String(
    (config.role_sync || {}).nickname_prefix !== undefined
        ? (config.role_sync || {}).nickname_prefix
        : String.fromCodePoint(0x1F4A0)
).trim();

// Lurker badge: applied to UNLINKED members who have never interacted (no message in
// the server's recent history). Linked members ALWAYS wear the 💠 diamond instead —
// the eyes are specifically the "joined but never linked and never spoke" marker.
// Configurable via role_sync.nickname_prefix_lurker; default 👀.
const EYES_PREFIX = String(
    (config.role_sync || {}).nickname_prefix_lurker !== undefined
        ? (config.role_sync || {}).nickname_prefix_lurker
        : '👀'
).trim();

// Holders of these roles are server staff/regulars and must NEVER be tagged as a 👀
// lurker, regardless of message history. Admins (Administrator permission) and anyone
// already wearing the 💠 diamond are exempt too. Defaults to "Community Support";
// extend via role_sync.lurker_exempt_roles (role names or ids, case-insensitive).
const LURKER_EXEMPT_ROLES = new Set(
    (((config.role_sync || {}).lurker_exempt_roles) || ['Community Support']).map((r) => String(r).toLowerCase())
);

// Lurker escalation tiers prefixed ONTO the eyes (never stacked onto a diamond):
//   👀     base lurker (14–45 days idle)
//   ⚠️👀   U+26A0 — idle 45+ days
//   ❗👀   U+2757 — never interacted at all (only after a full-history deep scan)
// These are composite badges (warning/bang immediately before the eyes); the tier is
// decided by interactions.lurkerTier() during the !interactions build lurker pass.
const WARN_PREFIX = '⚠️';                                  // ⚠️ U+26A0 (+VS16)
const BANG_PREFIX = '❗';                                       // ❗ U+2757
const WARN_EYES = EYES_PREFIX ? WARN_PREFIX + EYES_PREFIX : '';     // ⚠️👀
const BANG_EYES = EYES_PREFIX ? BANG_PREFIX + EYES_PREFIX : '';     // ❗👀

// All prefixes the bot manages, so a nickname rebuild strips whichever is present
// (and swaps between lurker tiers / 💠 cleanly) without ever stacking. Composite
// lurker badges are listed before the bare 👀 so the longest match is stripped first.
const MANAGED_PREFIXES = [NICK_PREFIX, BANG_EYES, WARN_EYES, EYES_PREFIX].filter(Boolean);
// The lurker-only subset (excludes 💠) — used to detect/clear a stale lurker badge.
const MANAGED_LURKER_PREFIXES = [BANG_EYES, WARN_EYES, EYES_PREFIX].filter(Boolean);
function stripManagedPrefix(s) {
    for (const p of MANAGED_PREFIXES) {
        if (p && s.startsWith(p)) return s.slice(p.length).trimStart();
    }
    return s;
}

// Build a linked member's managed nickname from a raw source string (their current
// nickname, or a name passed to !nickname). `prefix` is the badge to apply (💠 for
// interacted members, 👀 for lurkers). The "LVL<level>" suffix is appended only
// when the member hasn't locked their nickname, level-suffixing is enabled, and a
// level is known. When locked we preserve whatever the member kept (incl. any level
// tag). Fitted to Discord's 32-char cap, reserving room so the LVL tag is never cut.
function buildManagedNick(raw, level, nicknameLocked, prefix = NICK_PREFIX) {
    const src = raw || '';
    const stripped = stripManagedPrefix(src);
    const pre = prefix ? prefix + ' ' : '';
    if (!nicknameLocked && (config.role_sync || {}).nickname_level !== false && level > 0) {
        const base = stripped.replace(/\s*(\[\d+\]|LVL\d+)\s*$/i, '').trim();
        const suffix = ` LVL${level}`;
        const room = 32 - pre.length - suffix.length;
        return `${pre}${room > 0 ? base.substring(0, room).trim() : ''}${suffix}`.substring(0, 32);
    }
    const room = 32 - pre.length;
    return `${pre}${room > 0 ? stripped.substring(0, room).trim() : ''}`.trim().substring(0, 32);
}

// Skip redundant Discord API calls when nothing changed since last sync.
const lastSyncSignature = new Map();

// Returns a detailed result so callers (especially the manual !sync command) can
// report what actually happened instead of assuming success:
//   { ok, skipped, applied[], missing[], rolesChanged, roleError, nickError, level }
async function syncMember(member, playerInfo) {
    const result = { ok: false, skipped: false, applied: [], missing: [], rolesChanged: false, roleError: null, nickError: null, level: 0 };
    if (!member || !isLinked(playerInfo)) return result;
    const profile = selectProfile(playerInfo, getLastChar(member.id));
    if (!profile) return result;

    // While the player is online we definitively know their active character — remember
    // it so a later OFFLINE sync stays pinned to that same character (Option A cache).
    if (playerInfo.is_online && profile.charName) setLastChar(member.id, profile.charName);

    const targets = computeTargetRoleNames(profile);
    const level = profile.charLevel || 0;
    result.level = level;

    // Per-user locks (set via "!lock secid" / "!lock nickname"). When Section ID is
    // locked we neither apply a new Section ID role nor strip the member's current
    // one; when nickname is locked we skip the level-suffix nickname update entirely.
    const locks = getLocks(member.id);
    const sectionLocked = !!locks.secid;
    const nicknameLocked = !!locks.nickname;
    const effectiveTargets = sectionLocked ? { ...targets, sectionRole: null } : targets;

    // Badge: a LINKED member always wears the 💠 diamond — the diamond marks a linked
    // PSOBB.io account and must never be overwritten with the 👀 lurker badge (the eyes
    // are applied separately, only to UNLINKED members; see applyLurkerBadge). Tracking
    // whether the diamond is already present lets it roll out and self-heal if removed,
    // even while roles/level are otherwise unchanged.
    const badge = NICK_PREFIX;
    const hasBadge = !badge || (member.nickname || '').startsWith(badge);
    const sig = [effectiveTargets.classRole, effectiveTargets.subRole, effectiveTargets.levelRole, effectiveTargets.sectionRole, level, sectionLocked ? 'SL' : '', nicknameLocked ? 'NL' : '', hasBadge ? 'P' : ''].join('|');
    if (lastSyncSignature.get(member.id) === sig) {
        result.skipped = true;
        result.ok = true;
        return result;
    }

    const guild = member.guild;
    // Ensure the role cache is populated before matching by name — a stale/empty
    // cache would make every target role look "missing" and assign nothing.
    if (guild.roles.cache.size <= 1) await guild.roles.fetch().catch(() => {});

    const targetRoleNames = [effectiveTargets.classRole, effectiveTargets.subRole, effectiveTargets.levelRole, effectiveTargets.sectionRole].filter(Boolean);
    const targetRoles = [];
    for (const name of targetRoleNames) {
        const role = findGuildRole(guild, name);
        if (role) targetRoles.push(role);
        else result.missing.push(name);
    }
    result.applied = targetRoles.map((r) => r.name);

    // Final role set = the member's existing roles MINUS every strippable cosmetic
    // role (any zero-permission / managed identity role) PLUS the target roles.
    // This wipes whatever permission-less roles were previously assigned (old class /
    // subclass / level / Section ID) and reapplies the correct ones in one API call,
    // so a character swap fully overwrites the prior identity.
    const finalRoleIds = new Set();
    member.roles.cache.forEach((r) => {
        if (r.id === guild.id) return; // @everyone is implicit, never in the role list
        // Section ID locked: keep whatever Section ID role the member currently has.
        if (sectionLocked && SECTION_ID_ROLE_SET.has(r.name.toLowerCase())) { finalRoleIds.add(r.id); return; }
        if (!isStrippableRole(r)) finalRoleIds.add(r.id);
    });
    targetRoles.forEach((r) => finalRoleIds.add(r.id));

    // Discord rejects the ENTIRE roles.set() call if any target role sits at or above
    // the bot's highest role. Flag those up front so we can tell the admin exactly why.
    const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    const unmanageable = targetRoles.filter((r) => me && r.comparePositionTo(me.roles.highest) >= 0);
    if (me && !me.permissions.has('ManageRoles')) {
        result.roleError = 'I am missing the **Manage Roles** permission.';
    } else if (unmanageable.length) {
        result.roleError = `These roles are above my own role in the list, so Discord won't let me assign them: **${unmanageable.map((r) => r.name).join(', ')}**. Drag my bot role above them.`;
    }

    const currentIds = new Set(member.roles.cache.map((r) => r.id));
    const rolesChanged = finalRoleIds.size !== currentIds.size || [...finalRoleIds].some((id) => !currentIds.has(id));
    result.rolesChanged = rolesChanged;

    if (rolesChanged && !result.roleError) {
        try {
            await member.roles.set([...finalRoleIds], 'PSOBB role sync');
        } catch (e) {
            result.roleError = e.message;
            logWarn('ROLE-SYNC', `Could not set roles for ${member.user.tag}: ${e.message}`);
        }
    }

    // Nickname update. A LINKED member ALWAYS gets the 💠 badge, which (via
    // buildManagedNick → stripManagedPrefix) overwrites any stale lurker eyes
    // (👀/⚠️👀/❗👀) — becoming linked must always win over an interaction badge. This
    // runs independent of the nickname lock AND independent of role-assignment success:
    // a role error (e.g. a target role above the bot) must not leave a linked member
    // wearing eyes. setNickname has its own try/catch, so a missing-perms case is
    // harmless. The "LVL<level>" suffix is still maintained only when not locked.
    {
        try {
            const newNick = buildManagedNick(member.nickname || member.user.username, level, nicknameLocked, badge);
            if (member.nickname !== newNick) await member.setNickname(newNick, 'PSOBB sync');
        } catch (e) {
            result.nickError = e.message;
            logWarn('ROLE-SYNC', `Could not set nickname for ${member.user.tag}: ${e.message}`);
        }
    }

    // Only cache the signature as "done" when roles actually applied cleanly, so a
    // transient failure doesn't get skipped on the next tick / next !sync.
    if (!result.roleError) lastSyncSignature.set(member.id, sig);
    result.ok = !result.roleError;
    const summary = `Synced ${member.user.tag}: [${result.applied.join(', ') || 'no roles matched'}] Lvl ${level}`;
    if (result.roleError) logWarn('ROLE-SYNC', `${summary} — ERROR: ${result.roleError}`);
    else logInfo('ROLE-SYNC', summary);
    return result;
}

// A member is exempt from the 👀 lurker badge when they are: a bot, a server admin,
// already wearing the 💠 diamond (a linked account — never overwrite a diamond), or a
// holder of a configured exempt role (default "Community Support"). Used by the
// unlinked-member badge pass so eyes only ever land on genuine, non-staff lurkers.
function isLurkerExempt(member) {
    if (!member || (member.user && member.user.bot)) return true;
    if (member.permissions && member.permissions.has('Administrator')) return true;
    if (NICK_PREFIX && (member.nickname || '').startsWith(NICK_PREFIX)) return true;
    return member.roles.cache.some(
        (r) => LURKER_EXEMPT_ROLES.has(r.id) || LURKER_EXEMPT_ROLES.has(r.name.toLowerCase())
    );
}

// Apply (or clear) the tiered lurker badge on an UNLINKED member. The tier comes from
// interactions.lurkerTier(), which reads the back-filled message history + live
// reaction/message tracking:
//   active → no badge   ·   eyes → 👀 (14–45d idle)
//   warn   → ⚠️👀 (45d+ idle)   ·   never → ❗👀 (never interacted; needs a deep scan)
// Eyes never land on exempt members (admins / Community Support / anyone wearing 💠);
// a member who has since interacted — or become exempt — has any stale badge stripped.
// This is the unlinked counterpart to syncMember (which handles linked members + 💠).
// Returns { changed, action: 'eyes' | 'warn' | 'never' | 'cleared' | 'none', error }.
async function applyLurkerBadge(member) {
    const result = { changed: false, action: 'none', error: null };
    if (!member || (member.user && member.user.bot) || !EYES_PREFIX) return result;

    const current = member.nickname || '';
    const hasLurkerBadge = MANAGED_LURKER_PREFIXES.some((p) => current.startsWith(p));

    // Tier the member unless they're exempt (caller only passes unlinked members).
    const tier = isLurkerExempt(member) ? 'active' : lurkerTier(member.id);
    const prefix = tier === 'eyes' ? EYES_PREFIX
        : tier === 'warn' ? WARN_EYES
        : tier === 'never' ? BANG_EYES
        : null; // 'active' (or exempt) → no badge

    let desired;
    if (prefix) {
        desired = buildManagedNick(current || member.user.username, 0, true, prefix);
    } else if (hasLurkerBadge) {
        // No longer a lurker (interacted, or now exempt) — strip the stale badge.
        desired = stripManagedPrefix(current || member.user.username).substring(0, 32);
    } else {
        return result; // not a lurker, no stale badge → nothing to do
    }

    if (!desired || desired === current) return result;
    try {
        await member.setNickname(desired, 'PSOBB lurker badge');
        result.changed = true;
        result.action = prefix ? tier : 'cleared';
    } catch (e) {
        result.error = e.message;
        logWarn('ROLE-SYNC', `Could not set lurker nickname for ${member.user.tag}: ${e.message}`);
    }
    return result;
}

// Walk every member and apply the tiered eyes badge to genuine UNLINKED lurkers. This
// is the whole lurker-badge surface, owned by the !interactions command (NOT !sync) —
// the two are intentionally separated: !sync deals only with linked website players
// (roles + 💠); the interaction log + eyes badges live entirely under !interactions.
// Linked members are skipped via the persisted roster, and applyLurkerBadge's own
// isLurkerExempt() skips anyone wearing 💠 / admins / Community Support as a backstop.
// `onProgress(stats)` is invoked periodically so the caller can update a status reply.
// Returns { eyes, warn, never, cleared, skipped, errors, checked }.
async function runLurkerPass(guild, onProgress) {
    const stats = { eyes: 0, warn: 0, never: 0, cleared: 0, skipped: 0, errors: 0, checked: 0 };
    const members = [...guild.members.cache.values()];
    let written = 0;
    for (const member of members) {
        if (!member || (member.user && member.user.bot)) continue;
        if (linkedRoster.has(String(member.id))) continue; // linked → !sync's job (gets 💠)
        stats.checked++;
        const r = await applyLurkerBadge(member);
        if (r.error) stats.errors++;
        else if (r.action === 'eyes') stats.eyes++;
        else if (r.action === 'warn') stats.warn++;
        else if (r.action === 'never') stats.never++;
        else if (r.action === 'cleared') stats.cleared++;
        else stats.skipped++;
        if (r.changed) { written++; await delay(400); } // only pace when we actually wrote
        if (written > 0 && written % 25 === 0 && onProgress) await onProgress(stats);
    }
    return stats;
}

// Persisted roster of Discord IDs known to be linked (fallback for the online poll
// when the server feed does not expose Discord IDs).
const ROSTER_PATH = path.join(MEMORY_DIR, 'linked_roster.json');
function loadRoster() {
    try {
        if (fs.existsSync(ROSTER_PATH)) {
            const arr = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8'));
            if (Array.isArray(arr)) return new Set(arr.map(String));
        }
    } catch (e) { logError('ROLE-SYNC', `Roster load error: ${e.message}`); }
    return new Set();
}
let linkedRoster = loadRoster();
function addToRoster(id) {
    id = String(id);
    if (linkedRoster.has(id)) return;
    linkedRoster.add(id);
    try {
        fs.writeFileSync(ROSTER_PATH, JSON.stringify([...linkedRoster], null, 2));
        logInfo('ROLE-SYNC', `Added ${id} to linked roster (now ${linkedRoster.size}).`);
    } catch (e) { logError('ROLE-SYNC', `Roster save error: ${e.message}`); }
}

// Option A cache: the last active character name the bot observed for each Discord ID
// while that player was ONLINE. Used to keep offline syncs pinned to the player's real
// last-used character instead of falling back to their highest-level one.
const LAST_CHAR_PATH = path.join(MEMORY_DIR, 'last_character.json');
function loadLastChars() {
    try {
        if (fs.existsSync(LAST_CHAR_PATH)) {
            const obj = JSON.parse(fs.readFileSync(LAST_CHAR_PATH, 'utf8'));
            if (obj && typeof obj === 'object') return new Map(Object.entries(obj));
        }
    } catch (e) { logError('ROLE-SYNC', `Last-character load error: ${e.message}`); }
    return new Map();
}
let lastChars = loadLastChars();
function getLastChar(id) {
    return lastChars.get(String(id)) || null;
}
function setLastChar(id, name) {
    id = String(id);
    if (!name || lastChars.get(id) === name) return; // no change → no disk write
    lastChars.set(id, name);
    try {
        fs.writeFileSync(LAST_CHAR_PATH, JSON.stringify(Object.fromEntries(lastChars), null, 2));
    } catch (e) { logError('ROLE-SYNC', `Last-character save error: ${e.message}`); }
}

// Persisted per-user sync locks: { [discordId]: { secid?: true, nickname?: true } }.
// A member can opt out of having their Section ID role and/or nickname overwritten
// by the sync, via "!lock secid" / "!lock nickname".
const LOCKS_PATH = path.join(MEMORY_DIR, 'role_sync_locks.json');
function loadLocks() {
    try {
        if (fs.existsSync(LOCKS_PATH)) {
            const obj = JSON.parse(fs.readFileSync(LOCKS_PATH, 'utf8'));
            if (obj && typeof obj === 'object') return new Map(Object.entries(obj));
        }
    } catch (e) { logError('ROLE-SYNC', `Locks load error: ${e.message}`); }
    return new Map();
}
let memberLocks = loadLocks();
function getLocks(id) {
    return memberLocks.get(String(id)) || {};
}
function setLock(id, kind, enabled) {
    id = String(id);
    const cur = { ...(memberLocks.get(id) || {}) };
    if (enabled) cur[kind] = true; else delete cur[kind];
    if (Object.keys(cur).length === 0) memberLocks.delete(id);
    else memberLocks.set(id, cur);
    try {
        fs.writeFileSync(LOCKS_PATH, JSON.stringify(Object.fromEntries(memberLocks), null, 2));
    } catch (e) { logError('ROLE-SYNC', `Locks save error: ${e.message}`); }
}

function getDiscordIdFromEntry(entry) {
    return entry && (entry.discord_id || entry.DiscordID || entry.discord || entry.discordId) || null;
}

async function runRoleSyncTick(guild) {
    try {
        const seen = new Set();
        let syncedCount = 0;

        // Path A: if the online feed exposes Discord IDs, sync those directly.
        const online = await apiCall('get_online_players');
        const entries = Array.isArray(online) ? online
            : (online && Array.isArray(online.players) ? online.players
            : (online && Array.isArray(online.data) ? online.data : []));
        for (const entry of entries) {
            const did = getDiscordIdFromEntry(entry);
            if (!did || seen.has(String(did))) continue;
            seen.add(String(did));
            const info = await apiCall('get_player', { discord_id: did });
            if (isLinked(info)) {
                addToRoster(did);
                const member = await guild.members.fetch(String(did)).catch(() => null);
                if (member) {
                    const r = await syncMember(member, info);
                    if (r.ok && !r.skipped) syncedCount++;
                }
            }
            await delay(400);
        }

        // Path B: poll the persisted roster and sync every linked member, online or
        // not. Offline character data comes from the server's save-file source (see
        // get_player_all_slots.patch); the per-member signature cache below means an
        // unchanged member costs no Discord API calls, so this won't churn roles.
        for (const id of linkedRoster) {
            if (seen.has(id)) continue;
            const info = await apiCall('get_player', { discord_id: id });
            if (isLinked(info)) {
                const member = await guild.members.fetch(id).catch(() => null);
                if (member) {
                    const r = await syncMember(member, info);
                    if (r.ok && !r.skipped) syncedCount++;
                }
            }
            await delay(400);
        }
        if (syncedCount > 0) logInfo('ROLE-SYNC', `Tick complete — updated ${syncedCount} member(s).`);
    } catch (e) {
        logError('ROLE-SYNC', `Tick error: ${e.message}`);
    }
}

let roleSyncTimer = null;
async function startRoleSync(guild) {
    const cfg = config.role_sync || {};
    if (cfg.enabled === false) {
        logInfo('ROLE-SYNC', 'Disabled via config.');
        return;
    }
    const intervalMs = Math.max(1, cfg.interval_minutes || 5) * 60 * 1000;
    await guild.roles.fetch().catch(() => {});
    logInfo('ROLE-SYNC', `Active in "${guild.name}". Interval: ${intervalMs / 60000} min. Roster: ${linkedRoster.size} linked. Protected roles: ${PROTECTED_ROLES.size}.`);
    runRoleSyncTick(guild);
    roleSyncTimer = setInterval(() => runRoleSyncTick(guild), intervalMs);
}

// Manual on-demand sync via "!sync".
async function handleSyncCommand(message) {
    try {
        logInfo('COMMAND', `!sync by ${message.author.tag} (${message.author.id})`);
        if (!message.guild) {
            return await message.reply('⚠️ Run `!sync` in the server (not DMs) so I can update your roles.');
        }
        const info = await apiCall('get_player', { discord_id: message.author.id });
        // Diagnostic: record exactly what the server returned so offline-sync problems
        // are visible via !log. If chars=0 while the player is offline, the server-side
        // get_player_all_slots.patch is not returning save-file characters.
        const charCount = ((info && (info.Characters || info.characters)) || []).filter((c) => c && c.exists !== false).length;
        logInfo('ROLE-SYNC', `!sync data for ${message.author.tag}: linked=${info && info.linked !== false && !info.error}, is_online=${!!(info && info.is_online)}, characters=${charCount}`);
        // The API layer turns any HTTP failure (e.g. a 500) into { error: ... }. Surface
        // that as a server problem rather than the misleading "you're not linked".
        if (info && info.error) {
            if (info.error === 'Not linked') {
                return await message.reply('🔗 I couldn\'t find a linked PSOBB account. Sign in at https://psobb.io/login and link your Discord in your player dashboard, then run `!sync` again.');
            }
            logWarn('ROLE-SYNC', `!sync: get_player API error for ${message.author.tag}: ${info.error}`);
            return await message.reply('🛰️ The server hit an error fetching your character data. This is a **server-side** problem (often it fails for offline accounts). Please let an admin know — or try again while logged in.');
        }
        if (!isLinked(info)) {
            if (info && !info.error && info.linked !== false && charCount === 0) {
                // Linked account, but the API returned no characters — almost always the
                // offline case on a server without the save-file (all-slots) patch.
                logWarn('ROLE-SYNC', `${message.author.tag} is linked but the API returned 0 characters (is_online=${!!info.is_online}). Likely the server is not returning offline character data.`);
                return await message.reply('🛰️ Your account is linked, but the server returned no character data right now. This usually happens when you\'re offline on a server that only reports live characters. Try again while logged in, or ask an admin to enable offline character data.');
            }
            return await message.reply('🔗 I couldn\'t find a linked PSOBB account. Sign in at https://psobb.io/login and link your Discord in your player dashboard, then run `!sync` again.');
        }
        addToRoster(message.author.id);
        const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
        if (!member) {
            return await message.reply('⚠️ I couldn\'t fetch your server membership to update roles.');
        }
        lastSyncSignature.delete(member.id); // force a fresh apply
        // Build the reply header from the same character syncMember will act on,
        // including the offline last-used-character fallback (Option A cache).
        const profile = selectProfile(info, getLastChar(member.id));
        const res = await syncMember(member, info);

        const header = `Character: **${profile.charName || 'Unknown'}** (Lvl ${profile.charLevel || '?'})`;
        let reply;
        if (res.roleError) {
            // Roles were resolved but Discord refused the change — surface the real cause.
            reply = `⚠️ **Couldn't update your roles.** ${header}\n`;
            reply += `Intended roles: ${res.applied.join(', ') || '(none matched)'}\n`;
            reply += `Reason: ${res.roleError}`;
        } else if (res.applied.length) {
            reply = `✅ **Synced!** ${header}\nRoles: ${res.applied.join(', ')}`;
            if (res.missing.length) reply += `\n⚠️ Not found on this server (ask an admin to create them): ${res.missing.join(', ')}`;
        } else {
            reply = `ℹ️ **Linked, but no matching roles were found to assign.** ${header}\n`;
            reply += res.missing.length
                ? `Ask an admin to create these roles: ${res.missing.join(', ')}`
                : 'There were no roles to apply for this character.';
        }
        if (res.nickError) reply += `\n⚠️ Couldn't update your nickname: ${res.nickError}`;
        return await message.reply(reply);
    } catch (e) {
        logError('ROLE-SYNC', `!sync error for ${message.author.tag}: ${e.message}`);
        return await message.reply('📡 Sync failed due to interference. Try again shortly.');
    }
}

// Admin command: "!sync all" — force a full re-sync of every LINKED website player the
// bot knows about (the persisted roster ∪ get_linked_players ∪ anyone online), online
// or offline. This command is deliberately scoped to linked players ONLY (roles + 💠);
// it does NOT scan history or touch the interaction log / lurker badges — that lives
// entirely under `!interactions` (see runLurkerPass). The periodic tick only touches
// online players; this is the manual "make every linked player correct right now" button.
async function handleSyncAllCommand(message) {
    try {
        logInfo('COMMAND', `!sync all by ${message.author.tag} (${message.author.id})`);
        if (!message.guild) {
            return await message.reply('⚠️ Run `!sync all` in the server (not DMs).');
        }
        if (!canSupport(message.member)) {
            return await message.reply('🔒 `!sync all` is for server admins and Community Support only. Use `!sync` to sync just yourself.');
        }

        const status = await message.reply('🔄 Gathering linked players…');
        await message.guild.members.fetch().catch(() => {});

        // Collect every Discord ID to sync. Primary source is the website's full
        // list of linked accounts (get_linked_players) so this reaches everyone who
        // linked on the site — even players who never ran !sync or were never seen
        // online. Union in the persisted roster + online feed as a fallback in case
        // that action isn't available on the deployed API yet.
        const ids = new Set([...linkedRoster].map(String));
        const linked = await apiCall('get_linked_players');
        const linkedEntries = Array.isArray(linked) ? linked
            : (linked && Array.isArray(linked.players) ? linked.players
            : (linked && Array.isArray(linked.data) ? linked.data : []));
        for (const entry of linkedEntries) {
            const did = getDiscordIdFromEntry(entry);
            if (did) ids.add(String(did));
        }
        const online = await apiCall('get_online_players');
        const entries = Array.isArray(online) ? online
            : (online && Array.isArray(online.players) ? online.players
            : (online && Array.isArray(online.data) ? online.data : []));
        for (const entry of entries) {
            const did = getDiscordIdFromEntry(entry);
            if (did) ids.add(String(did));
        }

        const total = ids.size;
        await status.edit(`🔄 Syncing **${total}** linked player(s)…`).catch(() => {});

        const stats = { synced: 0, unchanged: 0, notInGuild: 0, notLinked: 0, errors: 0, processed: 0 };
        const missingRoles = new Set();
        let i = 0;
        for (const id of ids) {
            i++;
            try {
                const info = await apiCall('get_player', { discord_id: id });
                if (!isLinked(info)) { stats.notLinked++; continue; }
                addToRoster(id);
                const member = await message.guild.members.fetch(id).catch(() => null);
                if (!member) { stats.notInGuild++; continue; }
                lastSyncSignature.delete(member.id); // force a fresh apply
                const res = await syncMember(member, info);
                if (res.roleError) stats.errors++;
                else if (res.skipped || !res.rolesChanged) stats.unchanged++;
                else stats.synced++;
                res.missing.forEach((m) => missingRoles.add(m));
            } catch (e) {
                stats.errors++;
                logWarn('ROLE-SYNC', `!sync all: error for ${id}: ${e.message}`);
            }
            stats.processed++;
            // Light progress feedback every 10 members without spamming edits.
            if (i % 10 === 0) {
                await status.edit(`🔄 Syncing linked players… ${i}/${total} (✅ ${stats.synced} · ➖ ${stats.unchanged})`).catch(() => {});
            }
            await delay(400); // rate-limit friendly, same pacing as the periodic tick
        }

        let summary = `✅ **Linked player sync complete** — processed ${stats.processed}/${total} linked player(s).\n`;
        summary += `• Updated: **${stats.synced}**\n`;
        summary += `• Already correct: **${stats.unchanged}**\n`;
        if (stats.notInGuild) summary += `• Linked but not in this server: **${stats.notInGuild}**\n`;
        if (stats.notLinked) summary += `• No longer linked (skipped): **${stats.notLinked}**\n`;
        if (stats.errors) summary += `• Errors: **${stats.errors}** (see \`!log\`)\n`;
        summary += `_(Lurker 👀/⚠️/❗ badges are managed separately — run \`!interactions build\`.)_\n`;
        if (missingRoles.size) summary += `⚠️ Roles not found on this server (ask an admin to create them): ${[...missingRoles].join(', ')}`;
        logInfo('ROLE-SYNC', `!sync all by ${message.author.tag}: linked updated ${stats.synced}/unchanged ${stats.unchanged}/notInGuild ${stats.notInGuild}/notLinked ${stats.notLinked}/errors ${stats.errors}.`);
        return await status.edit(summary).catch(() => message.reply(summary));
    } catch (e) {
        logError('ROLE-SYNC', `!sync all error for ${message.author.tag}: ${e.message}`);
        return await message.reply('📡 Full sync failed due to interference. Try again shortly.');
    }
}

// Everyone command: "!lock <secid|nickname>" / "!unlock <secid|nickname>" — opt out
// of (or back into) the bot overwriting your Section ID role or nickname on a sync.
async function handleLockCommand(message) {
    try {
        const parts = message.content.trim().split(/\s+/);
        const cmd = parts[0].toLowerCase();            // "!lock" or "!unlock"
        const lock = cmd === '!lock';
        const what = (parts[1] || '').toLowerCase();
        logInfo('COMMAND', `${cmd} ${what} by ${message.author.tag} (${message.author.id})`);

        const kindMap = {
            secid: 'secid', sectionid: 'secid', section: 'secid', sec: 'secid', id: 'secid',
            nick: 'nickname', nickname: 'nickname', name: 'nickname', nic: 'nickname',
        };
        const kind = kindMap[what];
        if (!kind) {
            const cur = getLocks(message.author.id);
            const status = `Section ID: ${cur.secid ? '🔒 locked' : '🔓 unlocked'} · Nickname: ${cur.nickname ? '🔒 locked' : '🔓 unlocked'}`;
            return await message.reply(
                `Usage: \`!lock secid\`, \`!lock nickname\`, \`!unlock secid\`, \`!unlock nickname\`.\n` +
                `🔒 **Lock** stops me from changing that on a sync; 🔓 **unlock** lets sync manage it again.\n` +
                `Your current settings — ${status}`
            );
        }

        setLock(message.author.id, kind, lock);
        lastSyncSignature.delete(String(message.author.id)); // force re-eval with the new lock state
        const label = kind === 'secid' ? 'Section ID role' : 'nickname';
        if (lock) {
            return await message.reply(`🔒 Locked your **${label}** — I won't change it on future syncs. Use \`!unlock ${what}\` to undo.`);
        }
        return await message.reply(`🔓 Unlocked your **${label}** — sync will manage it again from now on. Run \`!sync\` to update it now.`);
    } catch (e) {
        logError('ROLE-SYNC', `!lock error for ${message.author.tag}: ${e.message}`);
        return await message.reply('📡 Could not update your lock settings. Try again shortly.');
    }
}

// Everyone command: "!nickname <name>" (alias "!nick") — set your own server
// nickname through the bot. Required because members can't change their own
// nickname in this server (that Discord permission is removed so the bot is the
// single source of truth for names). The 💠 linked badge is always kept; the
// "LVL<level>" suffix is added unless the member has `!lock nickname`.
async function handleNicknameCommand(message) {
    try {
        logInfo('COMMAND', `!nickname by ${message.author.tag} (${message.author.id})`);
        if (!message.guild) {
            return await message.reply('⚠️ Run `!nickname` in the server (not DMs).');
        }

        // Everything after the command word, with surrounding single/double quotes
        // stripped so both `!nickname Foo` and `!nickname "Foo Bar"` work.
        let desired = message.content.replace(/^!(nickname|nick)\b\s*/i, '').trim();
        desired = desired.replace(/^['"]+|['"]+$/g, '').trim();
        if (!desired) {
            return await message.reply('Usage: `!nickname YourName` — sets your server nickname. I always keep the 💠 badge, and (unless you `!lock nickname`) your `LVL` level suffix.');
        }

        const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
        if (!member) {
            return await message.reply('⚠️ I couldn\'t fetch your server membership to set your nickname.');
        }

        // Only linked players get a managed nickname — the 💠 badge means "linked".
        const info = await apiCall('get_player', { discord_id: message.author.id });
        if (!isLinked(info)) {
            return await message.reply('🔗 I couldn\'t find a linked PSOBB account. Sign in at https://psobb.io/login and link your Discord in your player dashboard, then try `!nickname` again.');
        }

        const nicknameLocked = !!getLocks(message.author.id).nickname;
        const profile = selectProfile(info, getLastChar(member.id));
        const level = (profile && profile.charLevel) || 0;
        const newNick = buildManagedNick(desired, level, nicknameLocked);

        // Guard against a name that reduces to nothing once the badge/level are
        // stripped back out (e.g. someone passing just "LVL10").
        if (!newNick || newNick === NICK_PREFIX) {
            return await message.reply('Please give me an actual name, e.g. `!nickname RedRanger`.');
        }

        try {
            await member.setNickname(newNick, 'PSOBB !nickname');
        } catch (e) {
            logWarn('ROLE-SYNC', `!nickname failed for ${member.user.tag}: ${e.message}`);
            return await message.reply(`⚠️ I couldn't set your nickname: ${e.message}\n(If you're a server admin/owner, Discord won't let a bot rename you.)`);
        }

        lastSyncSignature.delete(member.id); // force the next sync to re-evaluate
        return await message.reply(
            `✅ Nickname set to **${newNick}**.` +
            (nicknameLocked ? ' Your level suffix is locked, so I left it off — `!unlock nickname` to have me manage it.' : '')
        );
    } catch (e) {
        logError('ROLE-SYNC', `!nickname error for ${message.author.tag}: ${e.message}`);
        return await message.reply('📡 Could not set your nickname. Try again shortly.');
    }
}

// Everyone command: "!commands" (alias "!help") — list the player-facing commands
// publicly. The privileged lists are DMed (never posted publicly) based on the
// caller's tier: admins get the full admin surface, Community Support gets a curated
// read-only/support set. Works in DMs too — the caller's server roles are resolved
// from the configured guild so a DM invocation still detects their tier.
async function handleHelpCommand(message) {
    const invoked = message.content.trim().split(/\s+/)[0] || '!commands';
    // Resolve the caller's GuildMember even from a DM so tier detection works anywhere.
    const member = await resolveMember(message);
    const tier = memberTier(member); // 'admin' | 'support' | 'member'
    logInfo('COMMAND', `${invoked} by ${message.author.tag} (${message.author.id}) — tier ${tier}`);

    // ---- Public player help -------------------------------------------------
    const playerLines = [
        '**`!sync`** — Update your Discord roles & nickname from your linked PSOBB character (class, level, Section ID). Linked players always get the 💠 badge on their nickname.',
        '**`!nickname <name>`** (alias `!nick`) — Set your server nickname through me (you can\'t rename yourself directly here). Example: `!nickname RedRanger`. I keep your 💠 badge, and add your `LVL` level unless you\'ve locked your nickname.',
        '**`!lock nickname`** — Stop me changing your **nickname** on syncs (your `LVL` suffix stops updating). `!unlock nickname` lets me manage it again. The 💠 badge always stays while you\'re linked.',
        '**`!lock secid`** — Stop me changing your **Section ID** role on syncs. `!unlock secid` allows it again.',
        '**`!lock`** — Show your current lock settings.',
        '**`!commands`** (alias `!help`) — Show this message.',
    ];
    // Subsection: the Tekker Challenge / weapon-token commands only matter when a drop
    // puzzle is live, so they get their own titled block instead of being mixed in.
    const weaponLines = [
        '**`/guess [Native] [A.Beast] [Machine] [Dark] [Hit]`** — Solve the active drop puzzle to win a reward token (stats divisible by 5; Hit ≤ 50%, others ≤ 100%).',
        '**`!tokens`** — View your saved reward tokens (everyone, including admins).',
        '**`!gift <token_id> @player`** — Gift one of your reward tokens to another player.',
        '**`!claim <token_id>`** — Redeem a reward token (in-game redemption coming soon; for now it confirms your token is saved).',
    ];
    let reply =
        `🛰️ **PSOBB Bot — Player Commands**\n` +
        playerLines.map((l) => `• ${l}`).join('\n') +
        `\n\n__❓ When a **SPECIAL WEAPON** appears in the chat__\n` +
        weaponLines.map((l) => `• ${l}`).join('\n') +
        `\n\n💠 The diamond badge marks a Discord account linked to a PSOBB.io account — I keep it on your nickname automatically.` +
        `\nℹ️ Not linked yet? Sign in at https://psobb.io/login and link your Discord in your player dashboard, then run \`!sync\`.` +
        `\n💬 You can also **@mention me** or DM me to ask about your characters, stats, missions, or item drop rates.`;

    // ---- Privileged help (DMed, never posted publicly) ----------------------
    const guildName = (member && member.guild && member.guild.name) || (message.guild && message.guild.name) || '';

    // Curated support set — read-only / support tooling. Community Support can RUN
    // every command listed here; the destructive surface is admin-only (below).
    const supportLines = [
        '**`!sync all`** — Re-sync every **linked website player** (roles + 💠), online or offline. Lurker 👀/⚠️/❗ badges are handled separately by `!interactions build`.',
        '**`!roles`** — DM you a full server **role** audit (present / missing / above the bot).',
        '**`!channels`** — DM you a full **channel permission** audit.',
        '**`!log`** — Show the recent bot action log.',
        '**`!health`** — Re-check website dependencies and report which features are enabled/disabled.',
        '**`!interactions`** — Lurker/active log stats (👀/⚠️/❗ unlinked lurkers vs ✅ recently-active; linked members always wear 💠).',
        '**`!interactions check @user`** — Show a member\'s tier: ✅ active, 👀 (14–45d), ⚠️👀 (45d+), or ❗👀 (never).',
    ];
    // Admin-only surface — destructive actions + log-mutating / token-minting commands.
    const adminOnlyLines = [
        '**`!interactions build`** — *(admin)* Recurse 45 days of history, census the interaction log, **and apply the 👀/⚠️ lurker badges** to unlinked members. Add **`deep`** to scan the full history and also flag ❗ (never interacted). This is the only command that writes lurker badges; `!sync all` handles linked players (💠).',
        '**`!clear`** (alias `!purge`) — *(admin)* Bulk-delete recent messages.',
        '**`!pull`** (aliases `!update`, `!gitpull`) — *(admin)* Git-pull the latest code and restart.',
        '**`!restart`** — *(admin)* Restart the bot process.',
        '**`!tekker`** — Show the current Tekker Challenge status (active drop / trigger pool).',
        '**`!tekker roll`** (alias `!tekker start`) — *(admin)* Manually roll a new Tekker Challenge puzzle now.',
        '**`!tekker tokens`** (alias `!tekker all`) — *(admin)* DM you every reward token across all players.',
        '**`!tekker grant @user N AB M D Hit`** — *(admin)* Mint a token with set stats for a player.',
        '**`!tekker revoke <token_id>`** (alias `!tekker delete`) — *(admin)* Delete a token.',
        '**`!tekker give <token_id> @user`** (alias `!tekker setowner`) — *(admin)* Reassign a token to another player.',
        '**`!tekker setclaimed <token_id> <on|off>`** — *(admin)* Mark a token claimed/unclaimed.',
        '**`!tekker threshold [n]`** — *(admin)* View or set the drop-trigger threshold.',
    ];

    if (tier === 'admin') {
        const adminMsg =
            `🔐 **PSOBB Bot — Admin Commands**${guildName ? ` (for ${guildName})` : ''}\n` +
            `__Support tooling__\n` + supportLines.map((l) => `• ${l}`).join('\n') +
            `\n\n__Admin-only__\n` + adminOnlyLines.map((l) => `• ${l}`).join('\n');
        try {
            for (const c of splitForDm(adminMsg)) await message.author.send(c);
            reply += `\n\n🔐 I also DMed you the **admin commands**.`;
        } catch (e) {
            logWarn('ROLE-SYNC', `${invoked} admin DM failed for ${message.author.tag}: ${e.message}`);
            reply += `\n\n🔐 You're an admin — I tried to DM you the admin commands but couldn't. Enable DMs from server members and try again.`;
        }
    } else if (tier === 'support') {
        const supportMsg =
            `🛠️ **PSOBB Bot — Community Support Commands**${guildName ? ` (for ${guildName})` : ''}\n` +
            `You can run these support commands (destructive/admin actions are restricted):\n` +
            supportLines.map((l) => `• ${l}`).join('\n');
        try {
            for (const c of splitForDm(supportMsg)) await message.author.send(c);
            reply += `\n\n🛠️ I also DMed you the **Community Support commands**.`;
        } catch (e) {
            logWarn('ROLE-SYNC', `${invoked} support DM failed for ${message.author.tag}: ${e.message}`);
            reply += `\n\n🛠️ You're Community Support — I tried to DM you your support commands but couldn't. Enable DMs from server members and try again.`;
        }
    }

    return await message.reply(reply);
}

// =====================================================================
// SERVER ROLE AUDIT
// Reads EVERY role on the server and classifies the bot's managed identity
// roles into present / missing / above-the-bot, plus reports the bot's own
// permission + hierarchy position. This is the single source of truth for
// "why can't the bot assign roles?".
// =====================================================================
async function auditGuildRoles(guild) {
    // Pull the complete, fresh role list straight from Discord (not the cache).
    await guild.roles.fetch().catch(() => {});
    const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    const botHighest = me ? me.roles.highest : null;
    const hasManagePerm = !!(me && me.permissions.has('ManageRoles'));

    // Index every server role by lowercased name for case-insensitive matching.
    const byName = new Map();
    guild.roles.cache.forEach((r) => byName.set(r.name.toLowerCase(), r));

    const groups = {};       // group label -> [{ name, status }]
    const present = [];      // exists and the bot can assign it
    const missing = [];      // not created on the server
    const unmanageable = []; // exists but sits at/above the bot's top role

    for (const [label, names] of Object.entries(MANAGED_ROLE_GROUPS)) {
        groups[label] = [];
        for (const name of names) {
            const role = byName.get(name.toLowerCase());
            let status;
            if (!role) {
                status = 'missing';
                missing.push(name);
            } else if (botHighest && role.comparePositionTo(botHighest) >= 0) {
                status = 'above';
                unmanageable.push(role.name);
            } else {
                status = 'ok';
                present.push(role.name);
            }
            groups[label].push({ name, status, id: role ? role.id : null });
        }
    }

    // Every role on the server (highest first) with the exact permissions it grants,
    // so an admin can review the full permission layout — not just the managed roles.
    const allRoles = [...guild.roles.cache.values()]
        .sort((a, b) => b.position - a.position)
        .map((r) => ({
            id: r.id,
            name: r.name,
            position: r.position,
            managed: r.managed,
            isEveryone: r.id === guild.id,
            permissions: r.permissions.has('Administrator') ? ['Administrator (grants ALL)'] : r.permissions.toArray(),
        }));

    return {
        totalServerRoles: guild.roles.cache.size,
        botRoleName: botHighest ? botHighest.name : null,
        botRolePosition: botHighest ? botHighest.position : null,
        hasManagePerm,
        groups,
        present,
        missing,
        unmanageable,
        allRoles,
    };
}

// Format the audit as a Discord-friendly message.
function formatRoleAudit(audit) {
    const icon = { ok: '✅', missing: '❌', above: '⬆️' };
    let out = `**PSOBB Role Audit** — ${audit.totalServerRoles} roles on this server\n`;
    out += audit.hasManagePerm
        ? `🔑 I have **Manage Roles**.`
        : `🚫 I am **missing the Manage Roles permission** — I can't change anyone's roles until that's granted.`;
    if (audit.botRoleName) out += ` My top role is **${audit.botRoleName}** (position ${audit.botRolePosition}).`;
    out += '\n';

    for (const [label, entries] of Object.entries(audit.groups)) {
        const line = entries.map((e) => `${icon[e.status]} ${e.name}${e.id ? ` (${e.id})` : ''}`).join('  ');
        out += `\n__${label}__\n${line}\n`;
    }

    out += `\n**Summary:** ${audit.present.length} ready · ${audit.missing.length} missing · ${audit.unmanageable.length} above my role`;
    if (audit.missing.length) out += `\n❌ **Create these roles:** ${audit.missing.join(', ')}`;
    if (audit.unmanageable.length) out += `\n⬆️ **Drag my bot role above these:** ${audit.unmanageable.join(', ')}`;
    if (!audit.missing.length && !audit.unmanageable.length && audit.hasManagePerm) {
        out += `\n🎉 Everything is set up correctly — I can assign all managed roles.`;
    }

    // Full permission breakdown for every role on the server (highest → lowest).
    out += `\n\n__All roles & their permissions__ (highest → lowest)`;
    for (const r of audit.allRoles) {
        const label = r.isEveryone ? '@everyone' : r.name + (r.managed ? ' (integration)' : '');
        const perms = r.permissions.length ? r.permissions.join(', ') : 'none';
        out += `\n• **${label}** [id ${r.id} · pos ${r.position}] — ${perms}`;
    }
    return out;
}

// Split a long body on line boundaries into <2000-char chunks (Discord's per-message
// cap) without breaking a line mid-word. A single over-long line is hard-split.
function splitForDm(fullText) {
    const chunks = [];
    let cur = '';
    for (const line of fullText.split('\n')) {
        if (line.length > 1900) {
            if (cur) { chunks.push(cur); cur = ''; }
            for (let i = 0; i < line.length; i += 1900) chunks.push(line.substring(i, i + 1900));
            continue;
        }
        if (cur.length + line.length + 1 > 1900) { chunks.push(cur); cur = ''; }
        cur += (cur ? '\n' : '') + line;
    }
    if (cur) chunks.push(cur);
    return chunks;
}

// Shared: DM a long report to the requesting admin, split so it stays under Discord's
// 2000-char limit. Returns true on success; on failure it notifies the user in-channel
// and returns false.
async function dmAdminReport(message, fullText, commandName) {
    try {
        for (const c of splitForDm(fullText)) await message.author.send(c);
        return true;
    } catch (dmErr) {
        logWarn('AUDIT', `${commandName} DM failed for ${message.author.tag}: ${dmErr.message}`);
        await message.reply(`📬 I couldn't DM you — please enable direct messages from server members and try \`${commandName}\` again.`);
        return false;
    }
}

// Admin command: "!roles" — DM the full server role audit to the requesting admin.
async function handleRolesCommand(message) {
    try {
        logInfo('COMMAND', `!roles by ${message.author.tag} (${message.author.id})`);
        if (!message.guild) {
            return await message.reply('⚠️ Run `!roles` in the server (not DMs).');
        }
        // Restrict to staff, since the audit exposes server config.
        if (!canSupport(message.member)) {
            return await message.reply('🔒 `!roles` is for server admins and Community Support only.');
        }
        const audit = await auditGuildRoles(message.guild);
        const report = `**${message.guild.name}**\n${formatRoleAudit(audit)}`;
        if (await dmAdminReport(message, report, '!roles')) {
            return await message.reply('📬 Sent you the role audit in a DM.');
        }
    } catch (e) {
        logError('ROLE-SYNC', `!roles error: ${e.message}`);
        return await message.reply('📡 Could not read the server roles. Try again shortly.');
    }
}

// =====================================================================
// SERVER CHANNEL PERMISSION AUDIT
// Reads every channel and reports its permission overwrites (the per-role /
// per-member allow & deny rules layered on top of the @everyone defaults).
// =====================================================================
function channelTypeLabel(type) {
    switch (type) {
        case ChannelType.GuildText: return 'text';
        case ChannelType.GuildVoice: return 'voice';
        case ChannelType.GuildCategory: return 'category';
        case ChannelType.GuildAnnouncement: return 'announcement';
        case ChannelType.GuildStageVoice: return 'stage';
        case ChannelType.GuildForum: return 'forum';
        case ChannelType.GuildMedia: return 'media';
        default: return `type${type}`;
    }
}

async function auditGuildChannels(guild) {
    await guild.channels.fetch().catch(() => {});
    const channels = [...guild.channels.cache.values()].sort((a, b) => a.rawPosition - b.rawPosition);

    const result = [];
    for (const ch of channels) {
        const overwrites = [];
        const owCache = ch.permissionOverwrites && ch.permissionOverwrites.cache;
        if (owCache) {
            for (const ow of owCache.values()) {
                let target;
                if (ow.type === 0) { // role overwrite
                    const role = guild.roles.cache.get(ow.id);
                    target = role ? (ow.id === guild.id ? '@everyone' : `@${role.name}`) : `role:${ow.id}`;
                } else { // member overwrite
                    const mem = guild.members.cache.get(ow.id) || await guild.members.fetch(ow.id).catch(() => null);
                    target = mem ? `@${mem.user.tag}` : `member:${ow.id}`;
                }
                overwrites.push({ target, id: ow.id, allow: ow.allow.toArray(), deny: ow.deny.toArray() });
            }
        }
        result.push({
            id: ch.id,
            name: ch.name,
            type: channelTypeLabel(ch.type),
            isCategory: ch.type === ChannelType.GuildCategory,
            parent: ch.parent ? ch.parent.name : null,
            parentId: ch.parent ? ch.parent.id : null,
            overwrites,
        });
    }
    return { guildName: guild.name, totalChannels: channels.length, channels: result };
}

function formatChannelAudit(audit) {
    let out = `**PSOBB Channel Permission Audit** — ${audit.totalChannels} channels on this server\n`;
    out += `Each channel's permission overwrites are layered on top of @everyone + category defaults. "(no overwrites)" means it inherits its defaults.`;
    for (const ch of audit.channels) {
        if (ch.isCategory) {
            out += `\n\n📁 **${ch.name}** (category · id ${ch.id})`;
        } else {
            out += `\n\n#${ch.name} [${ch.type} · id ${ch.id}]${ch.parent ? ` — in ${ch.parent} (id ${ch.parentId})` : ''}`;
        }
        if (!ch.overwrites.length) {
            out += `\n   (no overwrites — inherits defaults)`;
            continue;
        }
        for (const ow of ch.overwrites) {
            out += `\n   ${ow.target} (id ${ow.id}):`;
            if (ow.allow.length) out += `\n      ✅ allow: ${ow.allow.join(', ')}`;
            if (ow.deny.length) out += `\n      ⛔ deny: ${ow.deny.join(', ')}`;
            if (!ow.allow.length && !ow.deny.length) out += `\n      (neutral — no explicit allow/deny)`;
        }
    }
    return out;
}

// Admin command: "!channels" — DM the full channel permission audit to the admin.
async function handleChannelsCommand(message) {
    try {
        logInfo('COMMAND', `!channels by ${message.author.tag} (${message.author.id})`);
        if (!message.guild) {
            return await message.reply('⚠️ Run `!channels` in the server (not DMs).');
        }
        if (!canSupport(message.member)) {
            return await message.reply('🔒 `!channels` is for server admins and Community Support only.');
        }
        const audit = await auditGuildChannels(message.guild);
        const report = `**${message.guild.name}**\n${formatChannelAudit(audit)}`;
        if (await dmAdminReport(message, report, '!channels')) {
            return await message.reply('📬 Sent you the channel permission audit in a DM.');
        }
    } catch (e) {
        logError('ROLE-SYNC', `!channels error: ${e.message}`);
        return await message.reply('📡 Could not read the server channels. Try again shortly.');
    }
}

// =====================================================================
// BOOT-TIME SELF-CHECK
// Exercises the command handlers and the pure internal helpers on synthetic
// data so a partial/stale deploy or a broken edit — the class of bug behind the
// "getLastChar is not defined" failures seen mid-!sync — fails LOUDLY at startup
// instead of silently, once per member, during a real sync. Pure: performs no
// Discord or network calls. Throws (with every problem listed) on failure;
// returns a one-line summary string on success.
// =====================================================================
function selfCheck() {
    const problems = [];

    // 1. Every handler the bot wires up, plus every internal helper on the sync
    //    hot path, must resolve to a real function. A stale/partial module load
    //    would surface here as `undefined`.
    const requiredFns = {
        startRoleSync, handleSyncCommand, handleSyncAllCommand, handleLockCommand,
        handleNicknameCommand, handleHelpCommand, handleRolesCommand, handleChannelsCommand,
        syncMember, selectProfile, computeTargetRoleNames, isStrippableRole, isLinked,
        getLastChar, setLastChar, getLocks, buildManagedNick,
    };
    for (const [name, fn] of Object.entries(requiredFns)) {
        if (typeof fn !== 'function') problems.push(`${name} is not wired (typeof = ${typeof fn})`);
    }

    // 2. Run the exact expression syncMember/handleSyncCommand use —
    //    selectProfile(info, getLastChar(id)) → computeTargetRoleNames(profile) —
    //    against a known fixture. This executes every internal reference on the
    //    hot path, so a missing helper throws here at boot rather than mid-sync.
    try {
        const fixture = {
            is_online: false,
            Characters: [
                { slot: 0, exists: true, name: 'BootCheck', class: 'HUmar', level: 42, section_id: 'Viridia' },
                { slot: 1, exists: false },
            ],
        };
        if (!isLinked(fixture)) problems.push('isLinked() returned false for a linked fixture');
        getLocks('selfcheck'); // touch the per-user lock path
        const profile = selectProfile(fixture, getLastChar('selfcheck'));
        const targets = computeTargetRoleNames(profile);
        const got = `${targets.classRole}/${targets.subRole}/${targets.levelRole}/${targets.sectionRole}/L${profile && profile.charLevel}`;
        const want = 'Hunter/HUmar/LVL40/Viridia/L42';
        if (got !== want) problems.push(`sync pipeline produced "${got}", expected "${want}"`);

        // Exercise the nickname builder (used by both syncMember and !nickname).
        const nickUnlocked = buildManagedNick('BootCheck', 42, false);
        const nickLocked = buildManagedNick('BootCheck', 42, true);
        if (NICK_PREFIX) {
            if (!nickUnlocked.startsWith(NICK_PREFIX)) problems.push(`buildManagedNick dropped the prefix: "${nickUnlocked}"`);
            if (!nickLocked.startsWith(NICK_PREFIX)) problems.push(`buildManagedNick dropped the prefix when locked: "${nickLocked}"`);
        }
        if (!/LVL42$/.test(nickUnlocked)) problems.push(`buildManagedNick missing level suffix when unlocked: "${nickUnlocked}"`);
        if (/LVL\d+$/.test(nickLocked)) problems.push(`buildManagedNick added a level suffix while locked: "${nickLocked}"`);

        if (problems.length === 0) return `role-sync self-check OK — handlers wired, sync pipeline → ${got}, nick → "${nickUnlocked}"`;
    } catch (e) {
        problems.push(`sync pipeline threw: ${e.message}`);
    }

    throw new Error(`Role-sync self-check FAILED:\n - ${problems.join('\n - ')}`);
}

// Only symbols actually consumed by other modules are exported. The role/nickname
// helpers (syncMember, selectProfile, computeTargetRoleNames, buildManagedNick,
// isStrippableRole, isLinked, isLurkerExempt, applyLurkerBadge) and the audit builders
// are used internally only — including by selfCheck(), which closes over them directly
// rather than importing them — so they are intentionally NOT exported.
module.exports = {
    startRoleSync,
    selfCheck,
    handleSyncCommand,
    handleSyncAllCommand,
    handleLockCommand,
    handleNicknameCommand,
    handleHelpCommand,
    handleRolesCommand,
    handleChannelsCommand,
    dmAdminReport,
    runLurkerPass,
};
