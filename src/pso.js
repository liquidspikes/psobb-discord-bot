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
    if (sectionId && typeof sectionId === 'string') {
        let norm = sectionId.charAt(0).toUpperCase() + sectionId.slice(1).toLowerCase();
        // newserv spells this Section ID with a double-n; the rest of the site
        // (and the Discord role) uses the single-n form. Accept both.
        if (norm === 'Greennill') norm = 'Greenill';
        return SECTION_ID_NAMES.includes(norm) ? norm : null;
    }
    if (sectionId !== null && sectionId !== undefined) {
        const map = {
            0: 'Viridia', 1: 'Greenill', 2: 'Skyly', 3: 'Bluefull', 4: 'Purplenum',
            5: 'Pinkal', 6: 'Redria', 7: 'Oran', 8: 'Yellowboze', 9: 'Whitill'
        };
        return map[sectionId] || null;
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

module.exports = {
    SUBCLASS_TO_MAIN,
    CLASS_ID_MAP,
    SECTION_ID_NAMES,
    LEVEL_ROLE_NAMES,
    MANAGED_ROLE_NAMES,
    normalizeSectionId,
    normalizeClass,
    levelRoleName,
};
