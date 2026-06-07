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

// Detect whether a get_player response represents a linked account with characters.
function isLinked(playerInfo) {
    if (!playerInfo || playerInfo.error) return false;
    if (playerInfo.linked === false) return false;
    const chars = playerInfo.Characters || playerInfo.characters;
    return Array.isArray(chars) && chars.length > 0;
}

// Pick the relevant character: currently active (by LastPlayerName / active flag),
// else most recently played, falling back to the highest-level character.
function selectProfile(playerInfo) {
    if (!playerInfo) return null;
    const chars = playerInfo.Characters || playerInfo.characters || [];
    if (chars.length === 0) return null;

    const lastPlayerName = playerInfo.LastPlayerName || playerInfo.last_player_name;
    let chosen = null;
    if (lastPlayerName) {
        chosen = chars.find((c) => {
            const cName = c.name || c.Name || c.character_name || c.CharacterName;
            return cName && cName.toLowerCase() === lastPlayerName.toLowerCase();
        });
    }
    if (!chosen) chosen = chars.find((c) => c.is_active || c.isActive || c.active || c.Active);
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

// Skip redundant Discord API calls when nothing changed since last sync.
const lastSyncSignature = new Map();

// Returns a detailed result so callers (especially the manual !sync command) can
// report what actually happened instead of assuming success:
//   { ok, skipped, applied[], missing[], rolesChanged, roleError, nickError, level }
async function syncMember(member, playerInfo) {
    const result = { ok: false, skipped: false, applied: [], missing: [], rolesChanged: false, roleError: null, nickError: null, level: 0 };
    if (!member || !isLinked(playerInfo)) return result;
    const profile = selectProfile(playerInfo);
    if (!profile) return result;

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

    const sig = [effectiveTargets.classRole, effectiveTargets.subRole, effectiveTargets.levelRole, effectiveTargets.sectionRole, level, sectionLocked ? 'SL' : '', nicknameLocked ? 'NL' : ''].join('|');
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

    if (!nicknameLocked && (config.role_sync || {}).nickname_level !== false && level > 0) {
        try {
            // Strip an existing trailing level suffix in either the old "[125]" or the
            // current "LVL125" form, then re-append as "LVL125".
            const baseName = (member.nickname || member.user.username).replace(/\s*(\[\d+\]|LVL\d+)\s*$/i, '').trim();
            const newNick = `${baseName} LVL${level}`.substring(0, 32);
            if (member.nickname !== newNick) await member.setNickname(newNick, 'PSOBB level sync');
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

        // Path B: poll the persisted roster and sync anyone currently online.
        for (const id of linkedRoster) {
            if (seen.has(id)) continue;
            const info = await apiCall('get_player', { discord_id: id });
            if (isLinked(info) && info.is_online) {
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
        if (!isLinked(info)) {
            return await message.reply('🔗 I couldn\'t find a linked PSOBB account. Sign in at https://psobb.io/login and link your Discord in your player dashboard, then run `!sync` again.');
        }
        addToRoster(message.author.id);
        const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
        if (!member) {
            return await message.reply('⚠️ I couldn\'t fetch your server membership to update roles.');
        }
        lastSyncSignature.delete(member.id); // force a fresh apply
        const profile = selectProfile(info);
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

// Admin command: "!sync all" — force a full re-sync of every linked player the bot
// knows about (the persisted roster) plus anyone currently online, online OR
// offline. The periodic tick only touches online players; this is the manual
// "make everyone correct right now" button. Admin-only because it walks the whole
// roster and writes Discord roles for other members.
async function handleSyncAllCommand(message) {
    try {
        logInfo('COMMAND', `!sync all by ${message.author.tag} (${message.author.id})`);
        if (!message.guild) {
            return await message.reply('⚠️ Run `!sync all` in the server (not DMs).');
        }
        if (!message.member || !message.member.permissions.has('Administrator')) {
            return await message.reply('🔒 `!sync all` is for server admins only. Use `!sync` to sync just yourself.');
        }

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
        if (total === 0) {
            return await message.reply('ℹ️ No linked players are known yet. Players appear here after they run `!sync` once or are seen online.');
        }

        const status = await message.reply(`🔄 Syncing **${total}** linked player(s)… this can take a moment.`);

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

        let summary = `✅ **Full sync complete** — processed ${stats.processed}/${total} linked player(s).\n`;
        summary += `• Updated: **${stats.synced}**\n`;
        summary += `• Already correct: **${stats.unchanged}**\n`;
        if (stats.notInGuild) summary += `• Linked but not in this server: **${stats.notInGuild}**\n`;
        if (stats.notLinked) summary += `• No longer linked (skipped): **${stats.notLinked}**\n`;
        if (stats.errors) summary += `• Errors: **${stats.errors}** (see \`!log\`)\n`;
        if (missingRoles.size) summary += `⚠️ Roles not found on this server (ask an admin to create them): ${[...missingRoles].join(', ')}`;
        logInfo('ROLE-SYNC', `!sync all by ${message.author.tag}: updated ${stats.synced}, unchanged ${stats.unchanged}, notInGuild ${stats.notInGuild}, notLinked ${stats.notLinked}, errors ${stats.errors}.`);
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

// Everyone command: "!commands" — list the player-facing commands. Admin commands
// (!sync all, !roles, !channels, !log, !restart) are intentionally omitted. Note:
// "!help" is deliberately NOT handled here — it's reserved for the website.
async function handleHelpCommand(message) {
    logInfo('COMMAND', `!commands by ${message.author.tag} (${message.author.id})`);
    const lines = [
        '**`!sync`** — Update your Discord roles & nickname from your linked PSOBB character (class, level, Section ID).',
        '**`!lock secid`** — Stop me changing your **Section ID** role on syncs. `!unlock secid` allows it again.',
        '**`!lock nickname`** — Stop me changing your **nickname** on syncs. `!unlock nickname` allows it again.',
        '**`!lock`** — Show your current lock settings.',
        '**`!commands`** — Show this message.',
    ];
    const reply =
        `🛰️ **PSOBB Bot — Player Commands**\n` +
        lines.map((l) => `• ${l}`).join('\n') +
        `\n\nℹ️ Not linked yet? Sign in at https://psobb.io/login and link your Discord in your player dashboard, then run \`!sync\`.` +
        `\n💬 You can also **@mention me** or DM me to ask about your characters, stats, missions, or item drop rates.`;
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
            groups[label].push({ name, status });
        }
    }

    // Every role on the server (highest first) with the exact permissions it grants,
    // so an admin can review the full permission layout — not just the managed roles.
    const allRoles = [...guild.roles.cache.values()]
        .sort((a, b) => b.position - a.position)
        .map((r) => ({
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
        const line = entries.map((e) => `${icon[e.status]} ${e.name}`).join('  ');
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
        out += `\n• **${label}** [pos ${r.position}] — ${perms}`;
    }
    return out;
}

// Shared: DM a long report to the requesting admin, split on line boundaries so it
// stays under Discord's 2000-char limit and never breaks a line mid-word. Returns
// true on success; on failure it notifies the user in-channel and returns false.
async function dmAdminReport(message, fullText, commandName) {
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

    try {
        for (const c of chunks) await message.author.send(c);
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
        // Restrict to server administrators, since the audit exposes server config.
        if (!message.member || !message.member.permissions.has('Administrator')) {
            return await message.reply('🔒 `!roles` is for server admins only.');
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
                overwrites.push({ target, allow: ow.allow.toArray(), deny: ow.deny.toArray() });
            }
        }
        result.push({
            name: ch.name,
            type: channelTypeLabel(ch.type),
            isCategory: ch.type === ChannelType.GuildCategory,
            parent: ch.parent ? ch.parent.name : null,
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
            out += `\n\n📁 **${ch.name}** (category)`;
        } else {
            out += `\n\n#${ch.name} [${ch.type}]${ch.parent ? ` — in ${ch.parent}` : ''}`;
        }
        if (!ch.overwrites.length) {
            out += `\n   (no overwrites — inherits defaults)`;
            continue;
        }
        for (const ow of ch.overwrites) {
            out += `\n   ${ow.target}:`;
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
        if (!message.member || !message.member.permissions.has('Administrator')) {
            return await message.reply('🔒 `!channels` is for server admins only.');
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

module.exports = {
    startRoleSync,
    handleSyncCommand,
    handleSyncAllCommand,
    handleLockCommand,
    handleHelpCommand,
    handleRolesCommand,
    handleChannelsCommand,
    auditGuildRoles,
    auditGuildChannels,
    syncMember,
    selectProfile,
    computeTargetRoleNames,
    isStrippableRole,
    isLinked,
};
