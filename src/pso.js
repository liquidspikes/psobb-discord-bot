// PSOBB game-data constants and value normalizers shared across modules
// (session detection + role sync). Pure functions/data, no side effects.

// Canonical role names. The 12 subclasses map to their 3 main classes.
const SUBCLASS_TO_MAIN = {
    HUmar: 'Hunter', HUnewearl: 'Hunter', HUcast: 'Hunter', HUcaseal: 'Hunter',
    RAmar: 'Ranger', RAmarl: 'Ranger', RAcast: 'Ranger', RAcaseal: 'Ranger',
    FOmar: 'Force', FOmarl: 'Force', FOnewm: 'Force', FOnewearl: 'Force'
};

// PSOBB numeric class IDs (class2) -> canonical subclass name.
// Verified against newserv StaticGameData.cc / api/bot_api.php $CLASS_MAP.
const CLASS_ID_MAP = {
    0: 'HUmar', 1: 'HUnewearl', 2: 'HUcast', 3: 'RAmar', 4: 'RAcast',
    5: 'RAcaseal', 6: 'FOmarl', 7: 'FOnewm', 8: 'FOnewearl', 9: 'HUcaseal',
    10: 'FOmar', 11: 'RAmarl'
};

const SECTION_ID_NAMES = ['Viridia', 'Greenill', 'Skyly', 'Bluefull', 'Purplenum', 'Pinkal', 'Redria', 'Oran', 'Yellowboze', 'Whitill'];

// Shared Tekker Challenge / weapon attribute constants.
const WEAPON_ATTR_CATEGORIES = ['Native', 'A.Beast', 'Machine', 'Dark', 'Hit'];
const WEAPON_ATTR_EMOJIS = {
    Native: '🗡️',
    'A.Beast': '🐾',
    Machine: '🤖',
    Dark: '👻',
    Hit: '🎯'
};
const TEKKER_MASKED_WEAPON = '❓ SPECIAL WEAPON';

// Build the full set of role names the bot is allowed to manage (lowercased).
// NOTE: these must match the role names that exist on the server exactly
// (matching is case-insensitive). The PSOBB.IO server uses "Rookie" + "LVL10".."LVL200".
const LEVEL_ROLE_NAMES = ['Rookie'];
for (let l = 10; l <= 200; l += 10) LEVEL_ROLE_NAMES.push('LVL' + l);
const MANAGED_ROLE_NAMES = new Set(
    [...Object.values(SUBCLASS_TO_MAIN), ...Object.keys(SUBCLASS_TO_MAIN), ...SECTION_ID_NAMES, ...LEVEL_ROLE_NAMES]
        .map((n) => n.toLowerCase())
);

function normalizeSectionId(sectionId) {
    if (sectionId === null || sectionId === undefined) return null;
    if (typeof sectionId === 'number' || /^\d+$/.test(String(sectionId).trim())) {
        return SECTION_ID_NAMES[Number(String(sectionId).trim())] || null;
    }
    if (typeof sectionId === 'string') {
        const cleaned = sectionId.trim();
        if (!cleaned) return null;
        let norm = cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
        // newserv spells this Section ID with a double-n; the rest of the site
        // (and the Discord role) uses the single-n form. Accept both.
        if (norm === 'Greennill') norm = 'Greenill';
        return SECTION_ID_NAMES.includes(norm) ? norm : null;
    }
    return null;
}

function normalizeClass(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number' || /^\d+$/.test(String(raw).trim())) {
        return CLASS_ID_MAP[parseInt(raw)] || null;
    }
    const cleaned = String(raw).trim().toLowerCase();
    for (const name of Object.keys(SUBCLASS_TO_MAIN)) {
        if (name.toLowerCase() === cleaned) return name;
    }
    return null;
}

function levelRoleName(level) {
    const lvl = parseInt(level) || 0;
    if (lvl < 10) return 'Rookie';
    return 'LVL' + Math.min(200, Math.floor(lvl / 10) * 10);
}

/**
 * Resolves a Discord Role from a guild cache by snowflake ID or case-insensitive name.
 */
function resolveGuildRole(guild, idOrName) {
    if (!guild || !guild.roles || !guild.roles.cache || !idOrName) return null;
    const key = String(idOrName).trim();
    if (!key) return null;
    return guild.roles.cache.get(key)
        || guild.roles.cache.find((r) => r.name.toLowerCase() === key.toLowerCase())
        || null;
}

module.exports = {
    SUBCLASS_TO_MAIN,
    CLASS_ID_MAP,
    SECTION_ID_NAMES,
    LEVEL_ROLE_NAMES,
    MANAGED_ROLE_NAMES,
    WEAPON_ATTR_CATEGORIES,
    WEAPON_ATTR_EMOJIS,
    TEKKER_MASKED_WEAPON,
    normalizeSectionId,
    normalizeClass,
    levelRoleName,
    resolveGuildRole,
};
