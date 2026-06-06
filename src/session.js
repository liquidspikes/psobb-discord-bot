// Detects a linked player's *current* in-game session (active character, Section ID,
// episode, difficulty) from a get_player API response. Used to bias drop searches.
const { apiCall } = require('./api');
const { normalizeSectionId } = require('./pso');
const { logError } = require('./actionLog');

function extractActiveSession(playerInfo) {
    if (!playerInfo || !playerInfo.is_online) return null;

    // Check if there is an explicit session object
    const session = playerInfo.session || playerInfo.online_session || {};

    // Extract difficulty and episode
    let difficulty = session.difficulty || session.Difficulty || playerInfo.difficulty || playerInfo.Difficulty || null;
    let episode = session.episode || session.Episode || playerInfo.episode || playerInfo.Episode || null;

    // Extract character details
    let activeChar = null;
    const chars = playerInfo.Characters || playerInfo.characters || [];

    // Try matching by LastPlayerName
    const lastPlayerName = playerInfo.LastPlayerName || playerInfo.last_player_name || session.character_name || session.CharacterName;
    if (lastPlayerName && chars.length > 0) {
        activeChar = chars.find(c => {
            const cName = c.name || c.Name || c.character_name || c.CharacterName;
            return cName && cName.toLowerCase() === lastPlayerName.toLowerCase();
        });
    }

    // If not found, try finding one marked active, or default to the first character
    if (!activeChar && chars.length > 0) {
        activeChar = chars.find(c => c.is_active || c.isActive || c.active || c.Active) || chars[0];
    }

    // Extract section ID from active character or session or root
    let sectionId = null;
    if (activeChar) {
        sectionId = activeChar.section_id || activeChar.SectionID || activeChar.sectionId || activeChar.Section_ID || activeChar.section || activeChar.Section;
    }
    if (!sectionId) {
        sectionId = session.section_id || session.SectionID || session.sectionId || playerInfo.section_id || playerInfo.SectionID || playerInfo.sectionId;
    }

    // Extract other char info
    const charName = activeChar ? (activeChar.name || activeChar.Name) : lastPlayerName;
    const charClass = activeChar ? (activeChar.class || activeChar.Class) : null;
    const charLevel = activeChar ? (activeChar.level || activeChar.Level) : null;

    // Normalize Section ID
    sectionId = normalizeSectionId(sectionId);

    // Normalize Difficulty
    if (difficulty && typeof difficulty === 'string') {
        difficulty = difficulty.charAt(0).toUpperCase() + difficulty.slice(1).toLowerCase();
        if (difficulty === 'Vhard' || difficulty === 'Veryhard') difficulty = 'Very Hard';
        const validDiffs = ['Normal', 'Hard', 'Very Hard', 'Ultimate'];
        if (!validDiffs.includes(difficulty)) {
            difficulty = null;
        }
    } else if (difficulty !== null && difficulty !== undefined) {
        const diffMap = { 0: 'Normal', 1: 'Hard', 2: 'Very Hard', 3: 'Ultimate' };
        difficulty = diffMap[difficulty] || null;
    }

    // Normalize Episode
    if (episode !== null && episode !== undefined) {
        const epStr = String(episode).replace(/[^0-9]/g, '');
        if (['1', '2', '4'].includes(epStr)) {
            episode = epStr;
        } else {
            episode = null;
        }
    }

    return {
        is_online: true,
        difficulty,
        episode,
        sectionId,
        charName,
        charClass,
        charLevel
    };
}

async function getCurrentPlayerSession(discordId) {
    try {
        const playerInfo = await apiCall("get_player", { discord_id: discordId });
        if (playerInfo && playerInfo.is_online) {
            return extractActiveSession(playerInfo);
        }
    } catch (e) {
        logError('SESSION', `Session check failed for ${discordId}: ${e.message}`);
    }
    return null;
}

module.exports = { extractActiveSession, getCurrentPlayerSession };
