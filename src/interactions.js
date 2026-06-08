// =====================================================================
// INTERACTION LOG
// A persistent record of every server user with a boolean: have they ever
// commented or reacted in the server? Drives the nickname badge in role sync —
// a linked member who has never interacted gets the 👀 lurker badge instead of
// the 💠 linked badge, until their first message/reaction flips them to true.
// Stored as JSON in the bot's memory dir (like the roster / locks).
// =====================================================================
const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const { MEMORY_DIR } = require('./config');
const { logInfo, logError } = require('./actionLog');

const INTERACTIONS_PATH = path.join(MEMORY_DIR, 'interactions.json');

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

// Guild-level metadata persisted alongside the per-user map. `lastFullScanAt` is
// set the first time a full beginning-of-server history scan completes; it's how
// lurkerTier() knows it may assert the ❗ "never interacted at all" tier (without a
// full scan, an empty record only proves "not in the recent window", not "never").
let meta = { lastFullScanAt: 0 };

function load() {
    try {
        if (fs.existsSync(INTERACTIONS_PATH)) {
            const obj = JSON.parse(fs.readFileSync(INTERACTIONS_PATH, 'utf8'));
            if (obj && typeof obj === 'object') {
                // New wrapped format: { users: { id: ts }, meta: {...} }. The legacy
                // format was a flat { id: ts } map — detect it by the absence of a
                // `users` key (snowflake IDs are numeric, never literally "users").
                const usersObj = (obj.users && typeof obj.users === 'object') ? obj.users : obj;
                if (obj.meta && typeof obj.meta === 'object') meta = { lastFullScanAt: 0, ...obj.meta };
                return new Map(Object.entries(usersObj).map(([k, v]) => {
                    if (typeof v === 'number') return [k, v];
                    // Backwards compatibility for existing boolean flags
                    return [k, v === true ? Date.now() : 0];
                }));
            }
        }
    } catch (e) { logError('INTERACT', `Load error: ${e.message}`); }
    return new Map();
}
let log = load();
function save() {
    try {
        fs.writeFileSync(INTERACTIONS_PATH, JSON.stringify({ users: Object.fromEntries(log), meta }, null, 2));
    } catch (e) { logError('INTERACT', `Save error: ${e.message}`); }
}

function hasInteracted(id) {
    const val = log.get(String(id));
    if (!val) return false;
    // Check if within 2 weeks
    return (Date.now() - val) <= TWO_WEEKS_MS;
}

function isKnown(id) {
    return log.has(String(id));
}

// Classify a member into a lurker-escalation tier from their recorded last-interaction
// timestamp (messages back-filled by scanGuildHistory + live message/reaction tracking
// via markInteracted). Drives the tiered 👀 / ⚠️👀 / ❗👀 nickname badge in role sync:
//   'active' — interacted within 14 days                          → no badge
//   'eyes'   — last interaction 14–45 days ago                    → 👀
//   'warn'   — last interaction >45 days ago (but HAS interacted) → ⚠️👀
//   'never'  — never interacted at all                            → ❗👀
// 'never' is only asserted once a full beginning-of-server scan has completed
// (meta.lastFullScanAt set); until then a member with no record is capped at 'warn',
// since an empty 45-day scan can't prove they NEVER interacted — only a full scan can.
function lurkerTier(id) {
    const val = log.get(String(id)) || 0;
    if (val > 0) {
        const age = Date.now() - val;
        if (age <= TWO_WEEKS_MS) return 'active';
        if (age <= FORTY_FIVE_DAYS_MS) return 'eyes';
        return 'warn';
    }
    return meta.lastFullScanAt ? 'never' : 'warn';
}

// Flip a user to "interacted" on their first message/reaction, or refresh their timestamp.
// Throttle writes: only save to disk if state shifts (lurker -> active) or if the
// last timestamp update is older than 1 hour, preventing disk thrashing.
function markInteracted(id) {
    id = String(id);
    const now = Date.now();
    const prev = log.get(id);

    // If they already interacted and their timestamp is less than an hour old, skip writing
    if (typeof prev === 'number' && prev > 0) {
        const wasActive = (now - prev) <= TWO_WEEKS_MS;
        if (wasActive && (now - prev) < ONE_HOUR_MS) {
            return;
        }
    }

    log.set(id, now);
    save();
}

// Record an interaction at a SPECIFIC timestamp (used when back-filling from real
// message history). Keeps the most recent timestamp ever seen for the user. Unlike
// markInteracted() this does NOT write to disk on every call — the bulk history scan
// mutates the map and calls save() once at the end. Returns true if it changed state.
function recordInteractionAt(id, ts) {
    id = String(id);
    const prev = log.get(id) || 0;
    if (ts > prev) { log.set(id, ts); return true; }
    return false;
}

// Walk every readable text channel and back-fill the interaction log from real message
// history within the active window (default 2 weeks — messages older than that can't
// change anyone's active/lurker status anyway, so we stop paginating once we cross it).
// This is how `!interactions build` "recurses the entire Discord to verify a player
// hasn't interacted" BEFORE its lurker pass decides who gets a 👀/⚠️/❗ badge. Records
// each author's real last-message time so the window reflects their actual activity,
// not the moment of the scan. Returns { channelsScanned, messagesScanned, updated }.
// Pass `full: true` to scan to the very beginning of every channel (no time cutoff,
// no per-channel cap) — used by the on-demand deep scan that powers the ❗ "never
// interacted" tier. A full scan records meta.lastFullScanAt so lurkerTier() may then
// assert 'never'. NOTE: only MESSAGE history is back-fillable here — Discord exposes
// no practical way to page a user's historical reactions, so reactions only count
// from live tracking (markInteracted) going forward.
async function scanGuildHistory(guild, { sinceMs = TWO_WEEKS_MS, perChannelCap = 10000, full = false } = {}) {
    const cutoff = full ? -Infinity : Date.now() - sinceMs;
    const cap = full ? Infinity : perChannelCap;
    let channelsScanned = 0, messagesScanned = 0, updated = 0, changed = false;
    const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));

    const channels = [...guild.channels.cache.values()].filter(
        (ch) => ch && typeof ch.isTextBased === 'function' && ch.isTextBased() && typeof ch.messages?.fetch === 'function'
    );

    for (const ch of channels) {
        // Only scan channels the bot can actually read history in.
        if (me) {
            const perms = ch.permissionsFor(me);
            if (!perms || !perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.ReadMessageHistory)) continue;
        }
        channelsScanned++;
        let before;
        let fetchedHere = 0;
        try {
            // Paginate newest → oldest; stop at the cutoff, the per-channel cap, or the end.
            while (fetchedHere < cap) {
                const batch = await ch.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
                if (!batch || batch.size === 0) break;
                let reachedCutoff = false;
                for (const msg of batch.values()) {
                    messagesScanned++;
                    if (msg.createdTimestamp < cutoff) { reachedCutoff = true; continue; }
                    if (msg.author && !msg.author.bot && recordInteractionAt(msg.author.id, msg.createdTimestamp)) {
                        updated++; changed = true;
                    }
                }
                before = batch.last().id;
                fetchedHere += batch.size;
                if (reachedCutoff || batch.size < 100) break;
            }
        } catch (e) {
            logError('INTERACT', `History scan error in #${ch.name || ch.id}: ${e.message}`);
        }
    }
    if (full) meta.lastFullScanAt = Date.now();
    if (changed || full) save();
    logInfo('INTERACT', `History scan${full ? ' (FULL)' : ''}: ${channelsScanned} channel(s), ${messagesScanned} msg(s) read, ${updated} interaction timestamp(s) updated.`);
    return { channelsScanned, messagesScanned, updated, full };
}

// Admin "build the first log": ensure every current member has an entry. New
// members default to 0 (never interacted) so the census is complete; existing values
// are preserved. Returns { added, total, interacted }.
function buildLog(memberIds) {
    let added = 0;
    for (const id of memberIds) {
        const s = String(id);
        if (!log.has(s)) { log.set(s, 0); added++; }
    }
    if (added) save();
    const activeCount = [...log.keys()].filter(hasInteracted).length;
    return { added, total: log.size, interacted: activeCount };
}

function stats() {
    const activeCount = [...log.keys()].filter(hasInteracted).length;
    return { total: log.size, interacted: activeCount, lurkers: log.size - activeCount };
}

// Admin command: "!interactions [build|check @user]" — manage/inspect the log.
async function handleInteractionsCommand(message) {
    try {
        const parts = message.content.trim().split(/\s+/);
        const sub = (parts[1] || '').toLowerCase();
        logInfo('COMMAND', `!interactions ${sub || '(stats)'} by ${message.author.tag} (${message.author.id})`);
        if (!message.guild) {
            return await message.reply('⚠️ Run `!interactions` in the server (not DMs).');
        }
        const { canSupport, isAdmin } = require('./permissions');
        if (!canSupport(message.member)) {
            return await message.reply('🔒 `!interactions` is for server admins and Community Support only.');
        }

        if (sub === 'build') {
            // The history scan + census is heavy and mutates the log — admins only.
            if (!isAdmin(message.member)) {
                return await message.reply('🔒 `!interactions build` is for server admins only. Community Support can use `!interactions` and `!interactions check @user`.');
            }
            await message.guild.members.fetch();
            // The full lurker lifecycle lives here (separated from !sync, which only does
            // linked website players). Three steps: (1) back-fill REAL message history so
            // members who actually posted are recorded as active, (2) census the log so
            // every member has an entry, (3) apply the tiered 👀/⚠️/❗ badges to unlinked
            // lurkers. `deep` walks the FULL server history (enables the ❗ never tier);
            // the default scans the last 45 days (enough for the 👀 / ⚠️ tiers).
            const deep = /\bdeep\b/i.test(message.content);
            const status = await message.reply(deep
                ? '🔎 Deep-scanning the FULL server history (every channel, back to the beginning)… this can take several minutes on a large server.'
                : '🔎 Scanning the last 45 days of server history to verify who has actually interacted… this can take a moment.');
            const scan = await scanGuildHistory(message.guild, deep ? { full: true } : { sinceMs: FORTY_FIVE_DAYS_MS });
            const ids = message.guild.members.cache.filter((m) => !m.user.bot).map((m) => m.id);
            const res = buildLog(ids);

            // Apply the tiered eyes badges. Lazy require avoids a load-time cycle
            // (roleSync requires this module at top level); the nickname/badge machinery
            // stays in roleSync, this command just drives it.
            await status.edit(`👀 Tagging unlinked lurkers (scanned ${scan.messagesScanned} messages)…`).catch(() => {});
            const { runLurkerPass } = require('./roleSync');
            const lurk = await runLurkerPass(message.guild, async (s) => {
                await status.edit(`👀 Tagging unlinked lurkers… ${s.checked} checked (👀 ${s.eyes} · ⚠️ ${s.warn} · ❗ ${s.never})`).catch(() => {});
            });

            logInfo('INTERACT', `Log built${deep ? ' (DEEP)' : ''} by ${message.author.tag}: ${res.total} tracked, ${res.interacted} interacted, ${res.added} new; scanned ${scan.messagesScanned} msgs across ${scan.channelsScanned} channels; lurkers 👀 ${lurk.eyes}/⚠️ ${lurk.warn}/❗ ${lurk.never}/cleared ${lurk.cleared}/errors ${lurk.errors} of ${lurk.checked} checked.`);
            let summary = `🗒️ **Interaction log built${deep ? ' (deep)' : ''}.** Scanned **${scan.messagesScanned}** messages across **${scan.channelsScanned}** channels${deep ? ' (full history)' : ' (last 45 days)'}.\n`;
            summary += `Tracking **${res.total}** users — ✅ **${res.interacted}** active in the last 2 weeks (added **${res.added}** new entries).\n`;
            summary += `\n👀 **Lurker badges applied** — checked ${lurk.checked} unlinked member(s):\n`;
            summary += `• 👀 idle 14–45d: **${lurk.eyes}**\n`;
            summary += `• ⚠️👀 idle 45d+: **${lurk.warn}**\n`;
            summary += `• ❗👀 never interacted: **${lurk.never}**${deep ? '' : ' _(run `!interactions build deep` to detect this tier)_'}\n`;
            if (lurk.cleared) summary += `• ✨ Cleared (now active): **${lurk.cleared}**\n`;
            if (lurk.errors) summary += `• Couldn't rename: **${lurk.errors}** (often admins/owner — Discord blocks bot renames)\n`;
            return await status.edit(summary).catch(() => message.reply('🗒️ Interaction log built.'));
        }

        if (sub === 'check') {
            const target = message.mentions.users.first();
            if (!target) return await message.reply('⚠️ Usage: `!interactions check @user`.');
            const known = isKnown(target.id);
            const val = log.get(String(target.id));
            const tier = lurkerTier(target.id);
            const agoDays = val > 0 ? ((Date.now() - val) / (24 * 60 * 60 * 1000)).toFixed(1) : null;
            let state;
            if (!known) {
                state = `ℹ️ not in the log yet (run \`!interactions build\`)`;
            } else if (tier === 'active') {
                const daysLeft = ((TWO_WEEKS_MS - (Date.now() - val)) / (24 * 60 * 60 * 1000)).toFixed(1);
                state = `✅ is active (last interaction ${agoDays} days ago; 👀 in ${daysLeft} days if idle)`;
            } else if (tier === 'eyes') {
                state = `👀 idle for ${agoDays} days (14–45d tier)`;
            } else if (tier === 'warn') {
                state = val > 0
                    ? `⚠️👀 idle for ${agoDays} days (45d+ tier)`
                    : `⚠️👀 no interaction found in the last 45 days (run \`!interactions build deep\` to confirm ❗ never-interacted)`;
            } else { // never
                state = `❗👀 has NEVER interacted (confirmed by full-history scan)`;
            }
            return await message.reply(`<@${target.id}> — ${state}.`);
        }

        const s = stats();
        return await message.reply(
            `🗒️ **Interaction log** — ${s.total} users tracked: ✅ ${s.interacted} active · 👀 ${s.lurkers} lurkers.\n` +
            `Use \`!interactions build\` to (re)census all members, or \`!interactions check @user\`.`
        );
    } catch (e) {
        logError('INTERACT', `!interactions error: ${e.message}`);
        return await message.reply('📡 Could not read the interaction log. Try again shortly.');
    }
}

module.exports = {
    hasInteracted,
    isKnown,
    lurkerTier,
    markInteracted,
    recordInteractionAt,
    scanGuildHistory,
    buildLog,
    stats,
    handleInteractionsCommand,
    INTERACTIONS_PATH,
};
