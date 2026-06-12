// =====================================================================
// LOCAL TEKKER STORE — in-process test-mode backend.
//
// A faithful JS port of every op in the website's api/bot_tekker_db.php,
// backed by a JSON file (MEMORY_DIR/tekker_local.json) instead of the site's
// SQLite DB. It exists so the FULL Tekker game (slash /guess mechanics: stat
// shifts, second-zero discovery, despawn pulsing, plus the token lifecycle)
// can be exercised locally BEFORE the website PR that adds those ops is merged
// and deployed.
//
// Enabled only when tekkerDb is in local mode (config.tekker.local_mode or
// env TEKKER_LOCAL_MODE=1). Default OFF — production always talks to the site.
//
// Limitation: weapon REDEMPTION (combining tokens into an item) happens on the
// website player dashboard (api/claim_tekker_drop.php), which the bot can't
// replicate — so `getClaimLog` stays empty here. This mode covers everything
// the bot drives: drops, guessing, shifts, and tokens (mint/gift/trade/grant).
// =====================================================================
const fs = require('fs');
const path = require('path');
const { MEMORY_DIR } = require('./config');
const { logInfo, logError } = require('./actionLog');

const STORE_PATH = path.join(MEMORY_DIR, 'tekker_local.json');
const CATEGORIES = ['Native', 'A.Beast', 'Machine', 'Dark', 'Hit'];
const VARIANCES = [-10, -5, 0, 5, 10];

// Mirrors the website schema's working set. drops/tokens/etc. are arrays so the
// SQL "ORDER BY ... DESC" semantics are easy to replicate.
let data = {
    seq: 0,
    drops: [],
    playerState: [],
    telemetry: [],
    activeUsers: [],
    settings: {},
    tokens: [],
    claimLog: [],
};

function load() {
    try {
        if (fs.existsSync(STORE_PATH)) {
            const obj = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
            if (obj && typeof obj === 'object') {
                data = Object.assign(data, obj);
            }
        }
    } catch (e) {
        logError('TEKKER', `Local store load error (${STORE_PATH}): ${e.message}`);
    }
}

function save() {
    try {
        fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
        logError('TEKKER', `Local store save error: ${e.message}`);
    }
}

load();

// --- helpers (match the PHP rand/clamp/date semantics) -------------------
const rint = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a; // inclusive, like PHP rand()
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const clean = (s) => String(s == null ? '' : s).trim();
const slug = (cat) => cat.toLowerCase().replace(/\./g, ''); // "A.Beast" -> "abeast"

// 'YYYY-MM-DD HH:MM:SS' local time — same format PHP's date() produces, so the
// bot code that parses spawn/despawn (new Date(...)) behaves identically.
function fmt(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Re-roll active stats from base ±variance, clamped 0–90 (90 = backend ceiling).
function reroll(drop) {
    const out = {};
    for (const cat of CATEGORIES) {
        const base = toInt(drop[`base_${slug(cat)}`]);
        out[cat] = base > 0 ? clamp(base + pick(VARIANCES), 0, 90) : 0;
    }
    drop.stat_native = out['Native'];
    drop.stat_abeast = out['A.Beast'];
    drop.stat_machine = out['Machine'];
    drop.stat_dark = out['Dark'];
    drop.stat_hit = out['Hit'];
    drop.guesses_since_shift = 0;
    return out;
}

const findDrop = (id) => data.drops.find((d) => d.drop_id === id) || null;

// --- ops -----------------------------------------------------------------
const ops = {
    ping: () => ({ ok: true }),

    getActiveDrop: () => {
        const d = data.drops.find((x) => x.is_active === 1);
        return d ? { ...d } : null;
    },

    createDrop: () => {
        data.drops.forEach((d) => { if (d.is_active === 1) d.is_active = 0; });
        // Two random locked zeros; one of them is the public hint.
        const i1 = rint(0, 4);
        let i2 = rint(0, 4); while (i2 === i1) i2 = rint(0, 4);
        const locked1 = CATEGORIES[i1], locked2 = CATEGORIES[i2];
        const hintAttr = rint(0, 1) === 0 ? locked1 : locked2;

        const base = {}, active = {};
        for (const cat of CATEGORIES) {
            if (cat === locked1 || cat === locked2) { base[cat] = 0; active[cat] = 0; }
            else { const b = rint(3, 16) * 5; base[cat] = b; active[cat] = clamp(b + pick(VARIANCES), 0, 90); }
        }

        const now = new Date();
        const row = {
            drop_id: `d-${Date.now()}`, is_active: 1,
            stat_native: active['Native'], stat_abeast: active['A.Beast'], stat_machine: active['Machine'], stat_dark: active['Dark'], stat_hit: active['Hit'],
            hint_attribute: hintAttr,
            base_native: base['Native'], base_abeast: base['A.Beast'], base_machine: base['Machine'], base_dark: base['Dark'], base_hit: base['Hit'],
            spawn_time: fmt(now), despawn_time: fmt(new Date(now.getTime() + 7200 * 1000)), // +2h
            guesses_since_shift: 0, second_zero_discovered: 0,
        };
        data.drops.push(row);
        save();
        return { ...row };
    },

    deactivateDrop: (p) => { const d = findDrop(p.dropId); if (d) d.is_active = 0; save(); return { ok: true }; },

    getPlayerState: (p) => {
        const r = data.playerState.find((x) => x.user_id === String(p.userId) && x.drop_id === p.dropId);
        return r ? { ...r } : null;
    },

    upsertPlayerState: (p) => {
        let row = data.playerState.find((x) => x.user_id === String(p.userId) && x.drop_id === p.dropId);
        if (!row) { row = { user_id: String(p.userId), drop_id: p.dropId }; data.playerState.push(row); }
        row.attempts_used = toInt(p.attemptsUsed);
        row.max_attempts = toInt(p.maxAttempts);
        row.lifetime_attempts = toInt(p.lifetimeAttempts);
        row.attempts_remaining = toInt(p.attemptsRemaining);
        row.last_guess_at = p.lastGuessAt != null ? p.lastGuessAt : null;
        save();
        return { ok: true };
    },

    addTelemetryLog: (p) => {
        data.telemetry.push({ user_id: String(p.userId), drop_id: p.dropId, guess_array: JSON.stringify(p.guessArray || []), result_state: p.resultState || '', logged_at: new Date().toISOString() });
        save();
        return { ok: true };
    },

    addActiveUser: (p) => { const u = String(p.userId); if (!data.activeUsers.includes(u)) data.activeUsers.push(u); save(); return { ok: true }; },
    getActiveUserCount: () => data.activeUsers.length,
    clearActiveUsers: () => { data.activeUsers = []; save(); return { ok: true }; },

    getTriggerThreshold: () => {
        const v = data.settings.trigger_threshold;
        return v !== undefined && v !== null ? toInt(v) : 30;
    },
    setTriggerThreshold: (p) => { data.settings.trigger_threshold = toInt(p.value); save(); return { ok: true }; },

    createToken: (p) => {
        data.tokens.push({
            _seq: ++data.seq,
            token_id: clean(p.token_id), owner_id: clean(p.owner_id),
            stat_native: toInt(p.stat_native), stat_abeast: toInt(p.stat_abeast), stat_machine: toInt(p.stat_machine), stat_dark: toInt(p.stat_dark), stat_hit: toInt(p.stat_hit),
            is_claimed: 0, claimed_by: null, claimed_at: null, created_at: new Date().toISOString(),
        });
        save();
        return { ok: true };
    },

    getToken: (p) => {
        const t = data.tokens.find((x) => clean(x.token_id) === clean(p.tokenId));
        return t ? { ...t, token_id: clean(t.token_id), owner_id: clean(t.owner_id) } : null;
    },

    getUnclaimedTokens: (p) => data.tokens
        .filter((t) => clean(t.owner_id) === clean(p.ownerId) && !t.is_claimed)
        .sort((a, b) => b._seq - a._seq)
        .map((t) => ({ ...t, token_id: clean(t.token_id), owner_id: clean(t.owner_id) })),

    getAllTokens: () => data.tokens
        .slice()
        .sort((a, b) => b._seq - a._seq)
        .map((t) => ({ ...t, token_id: clean(t.token_id), owner_id: clean(t.owner_id) })),

    transferToken: (p) => { const t = data.tokens.find((x) => clean(x.token_id) === clean(p.tokenId)); if (t) t.owner_id = clean(p.newOwnerId); save(); return { ok: true }; },

    markTokenClaimed: (p) => {
        const t = data.tokens.find((x) => clean(x.token_id) === clean(p.tokenId));
        if (t) { t.is_claimed = 1; t.claimed_by = clean(p.claimerId); t.claimed_at = new Date().toISOString(); }
        save();
        return { ok: true };
    },

    deleteToken: (p) => {
        const before = data.tokens.length;
        data.tokens = data.tokens.filter((x) => clean(x.token_id) !== clean(p.tokenId));
        save();
        return { ok: true, deleted: before - data.tokens.length };
    },

    // Bot never writes the claim log locally (redemption is a website action), so
    // this is empty in test mode — kept for op-surface parity with the website.
    getClaimLog: (p) => {
        const limit = p && p.limit ? clamp(toInt(p.limit), 1, 500) : 100;
        return data.claimLog.slice().reverse().slice(0, limit);
    },

    shiftActiveDropStats: (p) => {
        const d = findDrop(p.dropId);
        if (!d) return { ok: false, error: 'Drop not found' };
        const out = reroll(d);
        save();
        return { ok: true, stat_native: out['Native'], stat_abeast: out['A.Beast'], stat_machine: out['Machine'], stat_dark: out['Dark'], stat_hit: out['Hit'] };
    },

    incrementDropGuesses: (p) => {
        const d = findDrop(p.dropId);
        if (!d) return { ok: true, count: 0, shift_triggered: false };
        d.guesses_since_shift = toInt(d.guesses_since_shift) + 1;
        const count = d.guesses_since_shift;
        let shift_triggered = false;
        if (count >= 12) { reroll(d); shift_triggered = true; } // reroll resets the counter to 0
        save();
        return { ok: true, count, shift_triggered };
    },

    discoverSecondZero: (p) => { const d = findDrop(p.dropId); if (d) d.second_zero_discovered = 1; save(); return { ok: true }; },

    pulseDespawnTime: (p) => {
        const d = findDrop(p.dropId);
        if (!d) return { ok: false, error: 'Drop not found' };
        const spawn = Date.parse(d.spawn_time);
        const despawn = Date.parse(d.despawn_time);
        let next = despawn + 1800 * 1000;            // +30m per guess
        const hardCap = spawn + 28800 * 1000;        // +8h cap from spawn
        if (next > hardCap) next = hardCap;
        d.despawn_time = fmt(new Date(next));
        save();
        return { ok: true, despawn_time: d.despawn_time };
    },
};

// Synchronous dispatch mirroring bot_tekker_db.php's switch($op). Returns the
// same `result` value the HTTP path returns (so tekkerDb's wrappers are happy).
function dispatch(op, params = {}) {
    const handler = ops[op];
    if (!handler) throw new Error(`Unknown local tekker op: ${op}`);
    return handler(params);
}

logInfo('TEKKER', `Local tekker store ready (${STORE_PATH}).`);

module.exports = { dispatch };
