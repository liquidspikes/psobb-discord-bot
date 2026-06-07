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

function load() {
    try {
        if (fs.existsSync(INTERACTIONS_PATH)) {
            const obj = JSON.parse(fs.readFileSync(INTERACTIONS_PATH, 'utf8'));
            if (obj && typeof obj === 'object') return new Map(Object.entries(obj).map(([k, v]) => [k, !!v]));
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

function hasInteracted(id) { return log.get(String(id)) === true; }
function isKnown(id) { return log.has(String(id)); }

// Flip a user to "interacted" on their first message/reaction. Only writes on a
// real state change, so steady-state activity costs nothing.
function markInteracted(id) {
    id = String(id);
    if (log.get(id) === true) return;
    log.set(id, true);
    save();
}

// Admin "build the first log": ensure every current member has an entry. New
// members default to false (lurker) so the census is complete; existing values
// (especially true) are preserved. Returns { added, total, interacted }.
function buildLog(memberIds) {
    let added = 0;
    for (const id of memberIds) {
        const s = String(id);
        if (!log.has(s)) { log.set(s, false); added++; }
    }
    if (added) save();
    return { added, total: log.size, interacted: [...log.values()].filter(Boolean).length };
}

function stats() {
    const interacted = [...log.values()].filter(Boolean).length;
    return { total: log.size, interacted, lurkers: log.size - interacted };
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
                `🗒️ **Interaction log built.** Tracking **${res.total}** users — ✅ **${res.interacted}** have interacted, 👀 **${res.total - res.interacted}** haven't (added **${res.added}** new entries).\n` +
                `Linked members who haven't interacted show the 👀 badge until their first message/reaction.`
            );
        }

        if (sub === 'check') {
            const target = message.mentions.users.first();
            if (!target) return await message.reply('⚠️ Usage: `!interactions check @user`.');
            const known = isKnown(target.id);
            const state = hasInteracted(target.id) ? '✅ has interacted' : (known ? '👀 has NOT interacted yet' : 'ℹ️ not in the log yet (run `!interactions build`)');
            return await message.reply(`<@${target.id}> — ${state}.`);
        }

        const s = stats();
        return await message.reply(
            `🗒️ **Interaction log** — ${s.total} users tracked: ✅ ${s.interacted} interacted · 👀 ${s.lurkers} not yet.\n` +
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
