// Atomic JSON file persistence helpers shared across bot modules.
const fs = require('fs');
const path = require('path');
const { logWarn, logError } = require('./actionLog');

function cloneFallback(defaultValue) {
    if (typeof defaultValue === 'function') return defaultValue();
    if (defaultValue === undefined || defaultValue === null) return defaultValue;
    if (typeof defaultValue === 'object') return JSON.parse(JSON.stringify(defaultValue));
    return defaultValue;
}

/**
 * Reads and parses a JSON file from disk, returning a cloned fallback if the file
 * does not exist or cannot be parsed.
 */
function readJsonFile(filePath, defaultValue = null, label = 'JSONStore') {
    try {
        if (!fs.existsSync(filePath)) {
            return cloneFallback(defaultValue);
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw.trim()) {
            return cloneFallback(defaultValue);
        }
        return JSON.parse(raw);
    } catch (e) {
        logWarn(label, `JSON load error (${filePath}): ${e.message}`);
        return cloneFallback(defaultValue);
    }
}

/**
 * Serializes data as pretty-printed JSON and writes it atomically via a temp file rename.
 */
function writeJsonFile(filePath, data, label = 'JSONStore') {
    const tmpPath = `${filePath}.tmp`;
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
        fs.renameSync(tmpPath, filePath);
        return true;
    } catch (e) {
        logError(label, `JSON save error (${filePath}): ${e.message}`);
        try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch (_) { /* ignore cleanup failure */ }
        return false;
    }
}

module.exports = { readJsonFile, writeJsonFile };
