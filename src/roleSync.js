// =====================================================================
// ROLE & NICKNAME SYNC SYSTEM
// Mirrors a linked player's in-game identity (class / subclass / level /
// Section ID) into Discord roles, and appends their live level to their
// nickname. Assign-existing-only: an admin must pre-create the roles;
// the bot never creates or recolors roles, it only adds/removes them.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { config, MEMORY_DIR } = require('./config');
const { apiCall } = require('./api');
const {
    SUBCLASS_TO_MAIN,
    MANAGED_ROLE_NAMES,
    normalizeSectionId,
    normalizeClass,
    levelRoleName,
} = require('./pso');

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
        console.warn(`[ROLE-SYNC] Missing role "${name}" in "${guild.name}" — create it so the bot can assign it.`);
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

// Skip redundant Discord API calls when nothing changed since last sync.
const lastSyncSignature = new Map();

async function syncMember(member, playerInfo) {
    if (!member || !isLinked(playerInfo)) return false;
    const profile = selectProfile(playerInfo);
    if (!profile) return false;

    const targets = computeTargetRoleNames(profile);
    const level = profile.charLevel || 0;
    const sig = [targets.classRole, targets.subRole, targets.levelRole, targets.sectionRole, level].join('|');
    if (lastSyncSignature.get(member.id) === sig) return false;

    const guild = member.guild;
    const targetRoleNames = [targets.classRole, targets.subRole, targets.levelRole, targets.sectionRole].filter(Boolean);
    const targetRoles = targetRoleNames.map((n) => findGuildRole(guild, n)).filter(Boolean);

    // Final role set = the member's existing roles MINUS every strippable cosmetic
    // role (any zero-permission / managed identity role) PLUS the target roles.
    // This wipes whatever permission-less roles were previously assigned (old class /
    // subclass / level / Section ID) and reapplies the correct ones in one API call,
    // so a character swap fully overwrites the prior identity.
    const finalRoleIds = new Set();
    member.roles.cache.forEach((r) => {
        if (r.id === guild.id) return; // @everyone is implicit, never in the role list
        if (!isStrippableRole(r)) finalRoleIds.add(r.id);
    });
    targetRoles.forEach((r) => finalRoleIds.add(r.id));

    const currentIds = new Set(member.roles.cache.map((r) => r.id));
    const rolesChanged = finalRoleIds.size !== currentIds.size || [...finalRoleIds].some((id) => !currentIds.has(id));

    try {
        if (rolesChanged) await member.roles.set([...finalRoleIds], 'PSOBB role sync');
    } catch (e) {
        console.warn(`[ROLE-SYNC] Could not set roles for ${member.user.tag}: ${e.message}`);
    }

    if ((config.role_sync || {}).nickname_level !== false && level > 0) {
        try {
            const baseName = (member.nickname || member.user.username).replace(/\s*\[\d+\]\s*$/, '').trim();
            const newNick = `${baseName} [${level}]`.substring(0, 32);
            if (member.nickname !== newNick) await member.setNickname(newNick, 'PSOBB level sync');
        } catch (e) {
            console.warn(`[ROLE-SYNC] Could not set nickname for ${member.user.tag}: ${e.message}`);
        }
    }

    lastSyncSignature.set(member.id, sig);
    console.log(`[ROLE-SYNC] Synced ${member.user.tag}: [${targetRoleNames.join(', ') || 'no roles matched'}] Lvl ${level}`);
    return true;
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
    } catch (e) { console.error('[ROLE-SYNC] Roster load error:', e.message); }
    return new Set();
}
let linkedRoster = loadRoster();
function addToRoster(id) {
    id = String(id);
    if (linkedRoster.has(id)) return;
    linkedRoster.add(id);
    try {
        fs.writeFileSync(ROSTER_PATH, JSON.stringify([...linkedRoster], null, 2));
    } catch (e) { console.error('[ROLE-SYNC] Roster save error:', e.message); }
}

function getDiscordIdFromEntry(entry) {
    return entry && (entry.discord_id || entry.DiscordID || entry.discord || entry.discordId) || null;
}

async function runRoleSyncTick(guild) {
    try {
        const seen = new Set();

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
                if (member) await syncMember(member, info);
            }
            await delay(400);
        }

        // Path B: poll the persisted roster and sync anyone currently online.
        for (const id of linkedRoster) {
            if (seen.has(id)) continue;
            const info = await apiCall('get_player', { discord_id: id });
            if (isLinked(info) && info.is_online) {
                const member = await guild.members.fetch(id).catch(() => null);
                if (member) await syncMember(member, info);
            }
            await delay(400);
        }
    } catch (e) {
        console.error('[ROLE-SYNC] Tick error:', e.message);
    }
}

let roleSyncTimer = null;
async function startRoleSync(guild) {
    const cfg = config.role_sync || {};
    if (cfg.enabled === false) {
        console.log('[ROLE-SYNC] Disabled via config.');
        return;
    }
    const intervalMs = Math.max(1, cfg.interval_minutes || 5) * 60 * 1000;
    await guild.roles.fetch().catch(() => {});
    console.log(`[ROLE-SYNC] Active in "${guild.name}". Interval: ${intervalMs / 60000} min. Roster: ${linkedRoster.size} linked. Protected roles: ${PROTECTED_ROLES.size}.`);
    runRoleSyncTick(guild);
    roleSyncTimer = setInterval(() => runRoleSyncTick(guild), intervalMs);
}

// Manual on-demand sync via "!sync".
async function handleSyncCommand(message) {
    try {
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
        const targets = computeTargetRoleNames(profile);
        await syncMember(member, info);
        const applied = [targets.classRole, targets.subRole, targets.levelRole, targets.sectionRole].filter(Boolean);
        let reply = `✅ **Synced!** Character: **${profile.charName || 'Unknown'}** (Lvl ${profile.charLevel || '?'})\n`;
        reply += applied.length ? `Roles: ${applied.join(', ')}` : 'No matching roles were found to assign — ask an admin to create them.';
        return await message.reply(reply);
    } catch (e) {
        console.error('[ROLE-SYNC] !sync error:', e.message);
        return await message.reply('📡 Sync failed due to interference. Try again shortly.');
    }
}

module.exports = {
    startRoleSync,
    handleSyncCommand,
    syncMember,
    selectProfile,
    computeTargetRoleNames,
    isStrippableRole,
    isLinked,
};
