// Storage layer for the Discord Tekker Challenge — backed by the website's PHP
// API (bot_api.php action=tekker_db), NOT a local database. This keeps the bot
// free of any native (sqlite3) dependency; the website's SQLite DB is the single
// store. The exported function surface matches the original local-DB module, so
// callers (tekkerChallenge.js, messageHandler.js) are unchanged.
const axios = require('axios');
const { config } = require('./config');
const { logInfo, logError } = require('./actionLog');

// The tekker store is a dedicated endpoint (api/bot_tekker_db.php), derived from
// the configured bot_api.php URL. Allows an explicit override via tekker_db_url.
const TEKKER_DB_URL = config.tekker_db_url
    || String(config.psobb_api_url || '').replace('bot_api.php', 'bot_tekker_db.php');

// One POST per op: { op, ...params } → { success, result } | { success:false, error }.
async function call(op, params = {}) {
    const url = TEKKER_DB_URL;
    try {
        const resp = await axios.post(url, { op, ...params }, {
            headers: { 'Authorization': "Bearer " + config.psobb_api_secret, 'Content-Type': 'application/json' },
            timeout: 8000,
        });
        if (resp.data && resp.data.success) return resp.data.result;
        logError('TEKKER', `tekker_db ${op} → ${(resp.data && resp.data.error) || 'unknown error'}`);
        return null;
    } catch (e) {
        const status = e.response ? e.response.status : null;
        logError('TEKKER', `tekker_db ${op}${status ? ` [${status}]` : ''} → ${e.message}`);
        return null;
    }
}

// Connectivity check at boot (tables are auto-created by the website's db.php).
async function initDb() {
    const r = await call('ping');
    if (r && r.ok) logInfo('TEKKER', 'Storage ready (website API).');
    else logError('TEKKER', 'Storage backend unreachable at startup (tekker_db ping failed).');
}

// Lightweight reachability probe used by the dependency health check. Returns
// the raw ping result ({ ok: true }) or null on failure, without logging.
const ping = () => call('ping');

// Active drops
const getActiveDrop = () => call('getActiveDrop');
const createDrop = (drop) => call('createDrop', drop);
const deactivateDrop = (dropId) => call('deactivateDrop', { dropId });

// Player attempts
const getPlayerState = (userId, dropId) => call('getPlayerState', { userId, dropId });
const upsertPlayerState = (userId, dropId, attemptsUsed, maxAttempts) =>
    call('upsertPlayerState', { userId, dropId, attemptsUsed, maxAttempts });

// Telemetry
const addTelemetryLog = (userId, dropId, guessArray, resultState) =>
    call('addTelemetryLog', { userId, dropId, guessArray, resultState });

// Unique activity tracking
const addActiveUser = (userId) => call('addActiveUser', { userId });
async function getActiveUserCount() { const r = await call('getActiveUserCount'); return Number.isFinite(r) ? r : 0; }
const clearActiveUsers = () => call('clearActiveUsers');
async function getTriggerThreshold() { const r = await call('getTriggerThreshold'); return Number.isFinite(r) ? r : 30; }
const setTriggerThreshold = (value) => call('setTriggerThreshold', { value });

// Reward tokens
const createToken = (token) => call('createToken', token);
const getToken = (tokenId) => call('getToken', { tokenId });
async function getUnclaimedTokens(ownerId) { const r = await call('getUnclaimedTokens', { ownerId }); return Array.isArray(r) ? r : []; }
async function getAllTokens() { const r = await call('getAllTokens'); return Array.isArray(r) ? r : []; }
const transferToken = (tokenId, newOwnerId) => call('transferToken', { tokenId, newOwnerId });
const markTokenClaimed = (tokenId, claimerId) => call('markTokenClaimed', { tokenId, claimerId });
// Admin DB adjustments
const deleteToken = (tokenId) => call('deleteToken', { tokenId });
const setTokenClaimed = (tokenId, claimed, claimerId) => call('setTokenClaimed', { tokenId, claimed: claimed ? 1 : 0, claimerId });

module.exports = {
    initDb,
    ping,
    getActiveDrop,
    createDrop,
    deactivateDrop,
    getPlayerState,
    upsertPlayerState,
    addTelemetryLog,
    addActiveUser,
    getActiveUserCount,
    clearActiveUsers,
    getTriggerThreshold,
    setTriggerThreshold,
    createToken,
    getToken,
    getUnclaimedTokens,
    getAllTokens,
    transferToken,
    markTokenClaimed,
    deleteToken,
    setTokenClaimed,
};
