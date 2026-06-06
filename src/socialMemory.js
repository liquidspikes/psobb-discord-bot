// Per-user long-term social memory, persisted as JSON under MEMORY_DIR.
const fs = require('fs');
const path = require('path');
const { MEMORY_DIR } = require('./config');

function getMemoryPath(discordId) {
    const safeId = discordId.replace(/[^0-9]/g, '');
    return path.join(MEMORY_DIR, `${safeId}.json`);
}

function loadSocialMemory(discordId) {
    try {
        const memPath = getMemoryPath(discordId);
        if (fs.existsSync(memPath)) {
            return JSON.parse(fs.readFileSync(memPath, 'utf8'));
        }
    } catch (e) { console.error(`Memory load error for ID ${discordId}:`, e.message); }
    return [];
}

function saveSocialMemory(discordId, memoryArray) {
    try {
        const memPath = getMemoryPath(discordId);
        fs.writeFileSync(memPath, JSON.stringify(memoryArray, null, 2));
    } catch (e) { console.error(`Memory save error for ID ${discordId}:`, e.message); }
}

module.exports = { getMemoryPath, loadSocialMemory, saveSocialMemory };
