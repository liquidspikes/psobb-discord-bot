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
        if (!message.member || !message.member.permissions.has('Administrator')) {
            return await message.reply('🔒 `!interactions` is for server admins only.');
        }

        if (sub === 'build') {
            await message.guild.members.fetch();
            const ids = message.guild.members.cache.filter((m) => !m.user.bot).map((m) => m.id);
            const res = buildLog(ids);
            logInfo('INTERACT', `Log built by ${message.author.tag}: ${res.total} tracked, ${res.interacted} interacted, ${res.added} new.`);
            return await message.reply(
                `🗒️ **Interaction log built.** Tracking **${res.total}** users — ✅ **${res.interacted}** are active, 👀 **${res.total - res.interacted}** are lurkers (added **${res.added}** new entries).\n` +
                `Linked members who haven't interacted within 2 weeks show the 👀 badge until their next message/reaction.`
            );
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
    buildLog,
    stats,
    handleInteractionsCommand,
    INTERACTIONS_PATH,
};
