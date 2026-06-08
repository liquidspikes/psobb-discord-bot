// =====================================================================
// STARTUP DEPENDENCY HEALTH CHECK
// On boot the bot probes every website/server dependency it relies on. Each
// dependency gates one or more FEATURES; if a dependency is unreachable the
// correlated feature is disabled for the session:
//   - background features (role-sync tick, LFG watcher, party rooms, the
//     voice-activity tekker trigger) are simply not started (see bot.js),
//   - command features (!sync, !nickname, /guess, !tekker, !tokens, !claim,
//     !gift) reply to the invoker with a "temporarily unavailable" notice,
//   - AI tools (search_drops, get_server_stats, get_decryption_status) return
//     an error the model relays to the user.
// Results are logged under the HEALTH category and surfaced in the admin
// startup DM. Admins can re-run the probes at any time with "!health" (so a
// feature can be re-enabled after the website is fixed, without a restart).
// =====================================================================
const fs = require('fs');
const axios = require('axios');
const { apiCall, getDropsData } = require('./api');
const { VOTE_SCRIPTS_DIR } = require('./tools');
const tekkerDb = require('./tekkerDb');
const { logInfo, logWarn } = require('./actionLog');

// --- Dependencies: key -> { label, probe() -> {ok, detail} } -------------
// A probe returns ok:true when the dependency is PRESENT and responding in a
// recognized way. "Upstream game server briefly offline" still counts as
// present (the endpoint exists) — we only disable on a missing/broken endpoint.
const DEPENDENCIES = {
    bot_api: {
        label: 'Player & roster API (bot_api.php)',
        probe: async () => {
            const r = await apiCall('get_online_players');
            if (Array.isArray(r) || (r && (Array.isArray(r.players) || Array.isArray(r.data)))) return { ok: true };
            return { ok: false, detail: 'get_online_players unreachable or unexpected response' };
        },
    },
    lfg_api: {
        label: 'LFG feed (bot_api.php?action=get_lfg)',
        probe: async () => {
            const r = await apiCall('get_lfg', {});
            if (r && r.success === true) return { ok: true };
            return { ok: false, detail: 'get_lfg did not return {success:true}' };
        },
    },
    parties_api: {
        label: 'Party feed (bot_api.php?action=get_parties)',
        probe: async () => {
            const r = await apiCall('get_parties');
            // Present if it returns the JSON envelope, even when newserv is offline.
            if (r && typeof r === 'object' && r.error !== 'Service unavailable' && ('parties' in r || 'success' in r)) return { ok: true };
            return { ok: false, detail: 'get_parties endpoint unreachable' };
        },
    },
    tekker_db: {
        label: 'Tekker store (bot_tekker_db.php)',
        probe: async () => {
            const r = await tekkerDb.ping();
            return r && r.ok ? { ok: true } : { ok: false, detail: 'ping failed' };
        },
    },
    drops_api: {
        label: 'Drop tables (get_drops.php)',
        probe: async () => {
            const d = await getDropsData();
            return Array.isArray(d) ? { ok: true } : { ok: false, detail: 'no drop array returned' };
        },
    },
    summary_api: {
        label: 'Live server stats (api/summary)',
        probe: async () => {
            const resp = await axios.get('https://psobb.io/api/summary', { timeout: 10000 });
            return resp.data && (resp.data.Server || resp.data.Clients) ? { ok: true } : { ok: false, detail: 'unexpected summary shape' };
        },
    },
    agent_state: {
        label: 'Decryption status (api/agent_state.json)',
        probe: async () => {
            const resp = await axios.get('https://psobb.io/api/agent_state.json', { timeout: 10000 });
            return resp.data && typeof resp.data === 'object' ? { ok: true } : { ok: false, detail: 'not a JSON object' };
        },
    },
    vote_integration: {
        label: 'Mission Control vote files (gemini-psobb-scripts dir)',
        // Probe the DIRECTORY the external vote generator writes to — NOT
        // current_vote.json itself, because "no vote running" is a normal state
        // (an absent vote file). A missing/unreadable directory means the voting
        // integration is misconfigured/offline, which is the real failure to gate.
        probe: async () => {
            try {
                fs.accessSync(VOTE_SCRIPTS_DIR, fs.constants.R_OK);
                return { ok: true };
            } catch (e) {
                return { ok: false, detail: `${VOTE_SCRIPTS_DIR} missing or unreadable by the bot user` };
            }
        },
    },
};

// --- Features: key -> { label, deps[], (commands|tool|background) } -------
const FEATURES = {
    role_sync:    { label: 'Role & nickname sync',  deps: ['bot_api'],     commands: ['!sync', '!nickname'] },
    lfg:          { label: 'LFG announcer',          deps: ['lfg_api'],     background: true },
    party_rooms:  { label: 'Party voice rooms',      deps: ['parties_api'], background: true },
    tekker:       { label: 'Tekker Challenge',       deps: ['tekker_db'],   commands: ['/guess', '!tekker', '!tokens', '!claim', '!gift'] },
    drops:        { label: 'Drop search',            deps: ['drops_api'],   tool: 'search_drops' },
    server_stats: { label: 'Live server stats',      deps: ['summary_api'], tool: 'get_server_stats' },
    decryption:   { label: 'Decryption status',      deps: ['agent_state'], tool: 'get_decryption_status' },
    vote:         { label: 'Server event voting',    deps: ['vote_integration'], tools: ['get_active_vote_status', 'get_recent_votes'] },
};

// depKey -> { ok, detail, checkedAt }. Empty until runStartupChecks() runs, so
// every feature is treated as UP before the first probe (fail-open at boot).
const depStatus = {};

function downDeps(featureKey) {
    const f = FEATURES[featureKey];
    if (!f) return [];
    return f.deps.filter((k) => depStatus[k] && depStatus[k].ok === false);
}

// A feature is up unless one of its deps has been probed AND failed.
function isFeatureUp(featureKey) {
    const f = FEATURES[featureKey];
    if (!f) return true;
    return f.deps.every((k) => !depStatus[k] || depStatus[k].ok !== false);
}

function featureForTool(toolName) {
    for (const [fk, f] of Object.entries(FEATURES)) {
        if (f.tool === toolName) return fk;                                       // single-tool features
        if (Array.isArray(f.tools) && f.tools.includes(toolName)) return fk;      // multi-tool features (e.g. vote)
    }
    return null;
}

// Run every probe in parallel, record + log results, then log disabled features.
// Returns a short summary string for the admin startup DM.
async function runStartupChecks() {
    await Promise.all(Object.entries(DEPENDENCIES).map(async ([key, d]) => {
        try {
            const r = await d.probe();
            depStatus[key] = { ok: !!(r && r.ok), detail: (r && r.detail) || '', checkedAt: Date.now() };
        } catch (e) {
            depStatus[key] = { ok: false, detail: e.message, checkedAt: Date.now() };
        }
        const s = depStatus[key];
        if (s.ok) logInfo('HEALTH', `OK — ${d.label}`);
        else logWarn('HEALTH', `UNAVAILABLE — ${d.label}${s.detail ? ` (${s.detail})` : ''}`);
    }));

    for (const [fk, f] of Object.entries(FEATURES)) {
        if (!isFeatureUp(fk)) {
            const miss = downDeps(fk).map((k) => DEPENDENCIES[k].label).join(', ');
            logWarn('HEALTH', `Feature DISABLED: ${f.label} — missing dependency: ${miss}`);
        }
    }
    return summaryText();
}

function summaryText() {
    const down = Object.keys(FEATURES).filter((fk) => !isFeatureUp(fk));
    if (!down.length) return '🩺 Dependency check: all website dependencies OK — every feature enabled.';
    const lines = down.map((fk) => `   ⛔ ${FEATURES[fk].label} (needs: ${downDeps(fk).map((k) => DEPENDENCIES[k].label).join(', ')})`);
    return `🩺 Dependency check: ${down.length} feature(s) disabled until the website dependency returns:\n${lines.join('\n')}`;
}

// Long report for the !health admin command.
function detailedReport() {
    let out = '🩺 **Website Dependency Health**\n';
    for (const [k, d] of Object.entries(DEPENDENCIES)) {
        const s = depStatus[k];
        if (!s) { out += `• ⏳ ${d.label} — not checked yet\n`; continue; }
        out += `• ${s.ok ? '✅' : '❌'} ${d.label}${!s.ok && s.detail ? ` — ${s.detail}` : ''}\n`;
    }
    out += '\n**Features**\n';
    for (const [fk, f] of Object.entries(FEATURES)) {
        const up = isFeatureUp(fk);
        out += `• ${up ? '✅ enabled ' : '⛔ disabled'} — ${f.label}`;
        if (!up) out += ` (needs: ${downDeps(fk).map((k) => DEPENDENCIES[k].label).join(', ')})`;
        out += '\n';
    }
    return out.slice(0, 1990);
}

// User-facing notice when a command-feature is down. Also logs the block.
async function gateReply(message, featureKey) {
    const f = FEATURES[featureKey];
    const miss = downDeps(featureKey).map((k) => DEPENDENCIES[k].label).join(', ');
    logWarn('HEALTH', `Blocked a ${featureKey} command from ${message.author && message.author.tag} — dependency down${miss ? `: ${miss}` : ''}.`);
    try {
        await message.reply(
            `🛰️ **${f ? f.label : 'This feature'} is temporarily unavailable.** ` +
            `A required website dependency isn't responding right now${miss ? ` (${miss})` : ''}. ` +
            `The outage has been logged for the admins — please try again later.`
        );
    } catch (e) { /* ignore reply failures */ }
}

// Command-prefix -> feature map. Called at the top of the command router; if the
// matched feature is disabled it replies with a notice and returns true (blocked).
const COMMAND_FEATURE = [
    { test: (c) => /^[\/!]guess\b/i.test(c), feature: 'tekker' },
    { test: (c) => /^!tekker\b/i.test(c), feature: 'tekker' },
    { test: (c) => /^!tokens\b/i.test(c), feature: 'tekker' },
    { test: (c) => /^!claim\b/i.test(c), feature: 'tekker' },
    { test: (c) => /^!gift\b/i.test(c), feature: 'tekker' },
    { test: (c) => /^!sync\b/i.test(c), feature: 'role_sync' },          // !sync and !sync all
    { test: (c) => /^!(nickname|nick)\b/i.test(c), feature: 'role_sync' },
];
async function gateCommand(message) {
    const c = message.content || '';
    for (const m of COMMAND_FEATURE) {
        if (m.test(c)) {
            if (!isFeatureUp(m.feature)) { await gateReply(message, m.feature); return true; }
            return false;
        }
    }
    return false;
}

// Result handed to the model when an AI tool's feature is disabled, so the model
// tells the user instead of silently failing.
function toolDownResult(toolName) {
    const fk = featureForTool(toolName);
    const f = fk ? FEATURES[fk] : null;
    const miss = fk ? downDeps(fk).map((k) => DEPENDENCIES[k].label).join(', ') : '';
    return {
        error: `The ${f ? f.label : toolName} feature is temporarily unavailable because a required server dependency is not responding` +
            `${miss ? ` (${miss})` : ''}. Tell the user this data source is down right now and to try again later.`,
    };
}

// Admin command: "!health" — re-probe all dependencies and report status.
async function handleHealthCommand(message) {
    try {
        if (!message.guild) return await message.reply('⚠️ Run `!health` in the server (not DMs).');
        const { canSupport } = require('./permissions');
        if (!canSupport(message.member)) {
            return await message.reply('🔒 `!health` is for server admins and Community Support only.');
        }
        logInfo('COMMAND', `!health by ${message.author.tag} (${message.author.id})`);
        await message.reply('🔄 Re-checking website dependencies…');
        await runStartupChecks();
        return await message.reply(detailedReport());
    } catch (e) {
        logWarn('HEALTH', `!health error: ${e.message}`);
        return await message.reply('📡 Could not run the health check. Try again shortly.');
    }
}

module.exports = {
    runStartupChecks,
    isFeatureUp,
    featureForTool,
    toolDownResult,
    gateCommand,
    handleHealthCommand,
    summaryText,
    detailedReport,
};
