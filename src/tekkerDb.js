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

// Circuit-breaker for error logging: the scanner hits this on every message, so a
// down backend would otherwise emit one error per op per message. Instead we log
// once when the store first goes down, stay silent while it's down, and log once
// when it recovers. Successful ops never log.
let backendDown = false;

function noteFailure(detail) {
    if (!backendDown) {
        backendDown = true;
        logError('TEKKER', `tekker_db unreachable — suppressing further errors until it recovers: ${detail}`);
    }
}

function noteSuccess() {
    if (backendDown) {
        backendDown = false;
        logInfo('TEKKER', 'tekker_db recovered.');
    }
}

// One POST per op: { op, ...params } → { success, result } | { success:false, error }.
async function call(op, params = {}) {
    const url = TEKKER_DB_URL;
    try {
        const resp = await axios.post(url, { op, ...params }, {
            headers: { 'Authorization': "Bearer " + config.psobb_api_secret, 'Content-Type': 'application/json' },
            timeout: 8000,
        });
        if (resp.data && resp.data.success) {
            if (op !== 'ping') noteSuccess();
            return resp.data.result;
        }
        // 'ping' is a deliberate probe (healthcheck/initDb do their own logging) —
        // keep it out of the breaker so it stays silent and doesn't double-log.
        if (op !== 'ping') noteFailure(`${op} → ${(resp.data && resp.data.error) || 'unknown error'}`);
        return null;
    } catch (e) {
        const status = e.response ? e.response.status : null;
        if (op !== 'ping') noteFailure(`${op}${status ? ` [${status}]` : ''} → ${e.message}`);
        return null;
    }
}

// Connectivity check at boot (tables are auto-created by the website's db.php).
async function initDb() {
    const r = await call('ping');
    if (r && r.ok) logInfo('TEKKER', 'Storage ready (website API).');
    else logError('TEKKER', 'Storage backend unreachable at startup (tekker_db ping failed).');
}

// Lightweight reachability probe used at startup (initDb). Returns the raw ping
// result ({ ok: true }) or null on failure, without logging.
const ping = () => call('ping');

// Diagnostic probe for the dependency health check. Unlike ping(), it does NOT
// swallow the reason: it returns { ok, detail } where detail carries the HTTP
// status, response body, and the URL actually hit — so a failed !health report
// shows whether the endpoint 403'd, threw a schema/DB error, or the derived URL
// is wrong, instead of an opaque "ping failed".
async function pingDetailed() {
    const url = TEKKER_DB_URL;
    try {
        const resp = await axios.post(url, { op: 'ping' }, {
            headers: { 'Authorization': "Bearer " + config.psobb_api_secret, 'Content-Type': 'application/json' },
            timeout: 8000,
        });
        if (resp.data && resp.data.success && resp.data.result && resp.data.result.ok) {
            return { ok: true };
        }
        const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
        return { ok: false, detail: `HTTP ${resp.status} body=${(body || '').slice(0, 200)} url=${url}` };
    } catch (e) {
        const status = e.response ? e.response.status : null;
        let body = '';
        if (e.response && e.response.data) {
            body = typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data);
        }
        return { ok: false, detail: `${e.message}${status ? ` [HTTP ${status}]` : ''}${body ? ` body=${body.slice(0, 200)}` : ''} url=${url}` };
    }
}

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
    pingDetailed,
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
