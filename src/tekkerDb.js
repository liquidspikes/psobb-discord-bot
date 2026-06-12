// Storage layer for the Discord Tekker Challenge — backed by the website's PHP
// API (bot_api.php action=tekker_db), NOT a local database. This keeps the bot
// free of any native (sqlite3) dependency; the website's SQLite DB is the single
// store. The exported function surface matches the original local-DB module, so
// callers (tekkerChallenge.js, messageHandler.js) are unchanged.
const axios = require('axios');
const { config } = require('./config');
const { logInfo, logError } = require('./actionLog');

// The tekker store is a dedicated endpoint (api/bot_tekker_db.php), derived from
// the configured bot_api URL by swapping the bot_api path segment. Handles BOTH
// the extensionless pretty URL (".../bot_api?key=...", which the site's .htaccess
// rewrites to bot_api.php) and the explicit ".../bot_api.php?key=..." form, keeping
// whichever style the config uses. Allows an explicit override via tekker_db_url.
const TEKKER_DB_URL = config.tekker_db_url
    || String(config.psobb_api_url || '').replace(/bot_api(\.php)?(\?|$)/, 'bot_tekker_db$1$2');

// LOCAL TEST MODE — serve every tekker op from an in-process JSON store instead
// of the website endpoint, so the full /guess game (incl. ops the deployed site
// doesn't have yet) can be tested before the website PR is merged. Off by
// default; enable with env TEKKER_LOCAL_MODE=1 or config.tekker.local_mode:true.
const LOCAL_MODE_FLAG = String(
    process.env.TEKKER_LOCAL_MODE || ((config.tekker || {}).local_mode) || ''
).toLowerCase();
const USE_LOCAL = ['1', 'true', 'yes', 'on'].includes(LOCAL_MODE_FLAG);
const localStore = USE_LOCAL ? require('./tekkerLocalStore') : null;
if (USE_LOCAL) {
    logInfo('TEKKER', 'LOCAL TEST MODE ON — tekker ops served from MEMORY_DIR/tekker_local.json; website endpoint bypassed.');
}

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
    // Test mode: dispatch synchronously to the in-process store, no HTTP.
    if (USE_LOCAL) {
        try { return localStore.dispatch(op, params); }
        catch (e) { logError('TEKKER', `local store op ${op} failed: ${e.message}`); return null; }
    }
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
    if (r && r.ok) logInfo('TEKKER', USE_LOCAL ? 'Storage ready (LOCAL test store).' : 'Storage ready (website API).');
    else logError('TEKKER', 'Storage backend unreachable at startup (tekker_db ping failed).');
}

// Lightweight reachability probe used at startup (initDb). Returns the raw ping
// result ({ ok: true }) or null on failure, without logging.
const ping = () => call('ping');

// Diagnostic probe for the dependency health check. Unlike ping(), it does NOT
// swallow the reason: it returns { ok, detail } where detail carries the HTTP
// status, response body, and the endpoint PATH — so a failed !health report shows
// whether the endpoint 403'd, threw a schema/DB error, or the derived path is
// wrong, instead of an opaque "ping failed".
// SECURITY: never log the full URL — psobb_api_url carries the API secret in its
// "?key=..." query string. We log only the scheme+host+path (query stripped).
async function pingDetailed() {
    // Test mode is always "up" — the store is in-process, so the tekker feature
    // stays enabled and the health report shows it as the local backend.
    if (USE_LOCAL) return { ok: true };
    const url = TEKKER_DB_URL;
    // Redact any query string (and therefore the secret) before it can be logged.
    let safeUrl = url;
    try { const u = new URL(url); safeUrl = `${u.origin}${u.pathname}`; }
    catch (e) { safeUrl = String(url).split('?')[0]; }
    try {
        const resp = await axios.post(url, { op: 'ping' }, {
            headers: { 'Authorization': "Bearer " + config.psobb_api_secret, 'Content-Type': 'application/json' },
            timeout: 8000,
        });
        if (resp.data && resp.data.success && resp.data.result && resp.data.result.ok) {
            return { ok: true };
        }
        const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
        return { ok: false, detail: `HTTP ${resp.status} body=${(body || '').slice(0, 200)} path=${safeUrl}` };
    } catch (e) {
        const status = e.response ? e.response.status : null;
        let body = '';
        if (e.response && e.response.data) {
            body = typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data);
        }
        return { ok: false, detail: `${e.message}${status ? ` [HTTP ${status}]` : ''}${body ? ` body=${body.slice(0, 200)}` : ''} path=${safeUrl}` };
    }
}

// Active drops
const getActiveDrop = () => call('getActiveDrop');
const createDrop = (drop) => call('createDrop', drop);
const deactivateDrop = (dropId) => call('deactivateDrop', { dropId });
const shiftActiveDropStats = (dropId) => call('shiftActiveDropStats', { dropId });
const incrementDropGuesses = (dropId) => call('incrementDropGuesses', { dropId });
const discoverSecondZero = (dropId) => call('discoverSecondZero', { dropId });
const pulseDespawnTime = (dropId) => call('pulseDespawnTime', { dropId });

// Player attempts
const getPlayerState = (userId, dropId) => call('getPlayerState', { userId, dropId });
const upsertPlayerState = (userId, dropId, attemptsUsed, maxAttempts, lifetimeAttempts, attemptsRemaining, lastGuessAt) =>
    call('upsertPlayerState', { userId, dropId, attemptsUsed, maxAttempts, lifetimeAttempts, attemptsRemaining, lastGuessAt });

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
// Consolidated claim history (who claimed which tokens for what item). Tokens are
// deleted from the live store on claim, so this log is the record of claimed rewards.
async function getClaimLog(limit) { const r = await call('getClaimLog', limit ? { limit } : {}); return Array.isArray(r) ? r : []; }
const transferToken = (tokenId, newOwnerId) => call('transferToken', { tokenId, newOwnerId });
const markTokenClaimed = (tokenId, claimerId) => call('markTokenClaimed', { tokenId, claimerId });
// Admin DB adjustments
const deleteToken = (tokenId) => call('deleteToken', { tokenId });

module.exports = {
    // True when serving from the in-process test store (no website). Consumers
    // (e.g. tekkerChallenge) use this to warn players that won tokens are local
    // test tokens, not real rewards, until the website is brought up to date.
    LOCAL_MODE: USE_LOCAL,
    initDb,
    ping,
    pingDetailed,
    getActiveDrop,
    createDrop,
    deactivateDrop,
    shiftActiveDropStats,
    incrementDropGuesses,
    discoverSecondZero,
    pulseDespawnTime,
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
    getClaimLog,
    transferToken,
    markTokenClaimed,
    deleteToken,
};
