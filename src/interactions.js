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
const ONE_HOUR_MS = 60 * 60 * 1000;

function load() {
    try {
        if (fs.existsSync(INTERACTIONS_PATH)) {
            const obj = JSON.parse(fs.readFileSync(INTERACTIONS_PATH, 'utf8'));
            if (obj && typeof obj === 'object') {
                return new Map(Object.entries(obj).map(([k, v]) => {
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
        fs.writeFileSync(INTERACTIONS_PATH, JSON.stringify(Object.fromEntries(log), null, 2));
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
// This is how `!sync all` "recurses the entire Discord to verify a player hasn't
// interacted" BEFORE the badge pass decides who gets the 👀 lurker badge. Records each
// author's real last-message time so the 2-week window reflects their actual activity,
// not the moment of the scan. Returns { channelsScanned, messagesScanned, updated }.
async function scanGuildHistory(guild, { sinceMs = TWO_WEEKS_MS, perChannelCap = 10000 } = {}) {
    const cutoff = Date.now() - sinceMs;
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
            while (fetchedHere < perChannelCap) {
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
    if (changed) save();
    logInfo('INTERACT', `History scan: ${channelsScanned} channel(s), ${messagesScanned} msg(s) read, ${updated} interaction timestamp(s) updated.`);
    return { channelsScanned, messagesScanned, updated };
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
            // Back-fill from REAL message history first so members who have actually
            // posted in the last 2 weeks are recorded as active before the census
            // seeds the rest as never-interacted lurkers.
            const status = await message.reply('🔎 Scanning server history to verify who has actually interacted… this can take a moment.');
            const scan = await scanGuildHistory(message.guild);
            const ids = message.guild.members.cache.filter((m) => !m.user.bot).map((m) => m.id);
            const res = buildLog(ids);
            logInfo('INTERACT', `Log built by ${message.author.tag}: ${res.total} tracked, ${res.interacted} interacted, ${res.added} new; scanned ${scan.messagesScanned} msgs across ${scan.channelsScanned} channels.`);
            return await status.edit(
                `🗒️ **Interaction log built.** Scanned **${scan.messagesScanned}** messages across **${scan.channelsScanned}** channels.\n` +
                `Tracking **${res.total}** users — ✅ **${res.interacted}** are active, 👀 **${res.total - res.interacted}** are lurkers (added **${res.added}** new entries).\n` +
                `Unlinked members who haven't interacted within 2 weeks show the 👀 badge until their next message/reaction.`
            ).catch(() => message.reply('🗒️ Interaction log built.'));
        }

        if (sub === 'check') {
            const target = message.mentions.users.first();
            if (!target) return await message.reply('⚠️ Usage: `!interactions check @user`.');
            const known = isKnown(target.id);
            const active = hasInteracted(target.id);
            const val = log.get(target.id);
            let state;
            if (active) {
                const daysLeft = ((TWO_WEEKS_MS - (Date.now() - val)) / (24 * 60 * 60 * 1000)).toFixed(1);
                state = `✅ is active (last interaction recorded, expires in ${daysLeft} days)`;
            } else if (known && val > 0) {
                const ago = ((Date.now() - val) / (24 * 60 * 60 * 1000)).toFixed(1);
                state = `👀 has NOT interacted for ${ago} days (marked as lurker)`;
            } else if (known) {
                state = `👀 has NEVER interacted (marked as lurker)`;
            } else {
                state = `ℹ️ not in the log yet (run \`!interactions build\`)`;
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
    markInteracted,
    recordInteractionAt,
    scanGuildHistory,
    buildLog,
    stats,
    handleInteractionsCommand,
    INTERACTIONS_PATH,
};
