// Per-user long-term social memory, persisted as JSON under MEMORY_DIR.
const path = require('path');
const { MEMORY_DIR } = require('./config');
const { readJsonFile, writeJsonFile } = require('./jsonStore');

function getMemoryPath(discordId) {
    const safeId = discordId.replace(/[^0-9]/g, '');
    return path.join(MEMORY_DIR, `${safeId}.json`);
}

function loadSocialMemory(discordId) {
    const data = readJsonFile(getMemoryPath(discordId), [], 'SOCIAL');
    return Array.isArray(data) ? data : [];
}

function saveSocialMemory(discordId, memoryArray) {
    writeJsonFile(getMemoryPath(discordId), memoryArray, 'SOCIAL');
}

module.exports = { getMemoryPath, loadSocialMemory, saveSocialMemory };
