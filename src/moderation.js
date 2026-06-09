// Channel moderation admin commands.
const { logInfo, logWarn, logError } = require('./actionLog');

// Hard cap so a typo can't wipe a whole channel. Discord also only lets bulkDelete
// remove messages newer than 14 days, in batches of up to 100.
const MAX_CLEAR = 500;

// Above this many messages, require an explicit react-to-confirm before deleting.
const CONFIRM_THRESHOLD = 100;
const CONFIRM_TIMEOUT_MS = 30000;

// Admin command: "!clear <count>" — bulk-delete the last <count> messages in the
// channel it's run in. Irreversible, so it requires an explicit positive count and
// the Administrator permission, and it logs who cleared how many where.
async function handleClearCommand(message) {
    try {
        logInfo('COMMAND', `!clear by ${message.author.tag} (${message.author.id}) in #${message.channel && message.channel.name}`);
        if (!message.guild) {
            return await message.reply('⚠️ Run `!clear` in a server channel (not DMs).');
        }
        if (!message.member || !message.member.permissions.has('Administrator')) {
            return await message.reply('🔒 `!clear` is for server admins only.');
        }

        // The bot itself needs Manage Messages in THIS channel to delete messages.
        const me = message.guild.members.me || (await message.guild.members.fetchMe().catch(() => null));
        const myPerms = me && message.channel.permissionsFor(me);
        if (!myPerms || !myPerms.has('ManageMessages')) {
            return await message.reply('🚫 I need the **Manage Messages** permission in this channel to clear it.');
        }

        // Parse "<count>" plus an optional "skip <n>". Accepts any order and ignores a
        // stray "clear" word, so all of these work: `!clear 50`, `!clear 4 skip 2`,
        // `!clear skip 2 clear 4`. `skip` preserves the N most-recent messages and then
        // deletes the next <count> below them.
        const tokens = message.content.trim().split(/\s+/).slice(1);
        let skip = 0;
        let count = null;
        for (let i = 0; i < tokens.length; i++) {
            const tok = tokens[i].toLowerCase();
            if (tok === 'skip') {
                const n = parseInt(tokens[i + 1], 10);
                if (!Number.isNaN(n)) { skip = Math.max(0, n); i++; }
                continue;
            }
            if (tok === 'clear') continue; // allow the "skip 2 clear 4" phrasing
            const n = parseInt(tok, 10);
            if (!Number.isNaN(n) && count === null) count = n;
        }
        if (count === null || count <= 0) {
            return await message.reply(`⚠️ Usage: \`!clear <count> [skip <n>]\` — e.g. \`!clear 50\` or \`!clear 4 skip 2\` (skip the 2 newest, then clear 4). Count must be a positive number (max ${MAX_CLEAR}).`);
        }
        const target = Math.min(count, MAX_CLEAR);
        // Skip works within Discord's 100-message fetch window; warn if it can't reach.
        if (skip > 0 && skip + target > 100) {
            await message.reply(`⚠️ With \`skip\`, I can only reach the most recent 100 messages — skipping ${skip} leaves room to clear up to ${Math.max(0, 100 - skip)}. I'll clear what I can.`).catch(() => {});
        }

        // Large clears are extra destructive — require an explicit react-to-confirm.
        if (target > CONFIRM_THRESHOLD) {
            const who = (message.member && message.member.displayName) || message.author.username;
            const prompt = await message.channel.send({
                content:
                    `⚠️ **Confirm clearing up to ${target} messages** in this channel (requested by ${who}).\n` +
                    `React ✅ within ${CONFIRM_TIMEOUT_MS / 1000}s to proceed, or ❌ to cancel. This cannot be undone.`,
                allowedMentions: { parse: [] },
            });
            await prompt.react('✅').catch(() => {});
            await prompt.react('❌').catch(() => {});

            // Only the admin who issued the command may confirm.
            const filter = (reaction, user) =>
                user.id === message.author.id && ['✅', '❌'].includes(reaction.emoji.name);
            const collected = await prompt.awaitReactions({ filter, max: 1, time: CONFIRM_TIMEOUT_MS }).catch(() => null);
            const choice = collected && collected.first();

            await prompt.delete().catch(() => {});
            if (!choice || choice.emoji.name !== '✅') {
                logInfo('MOD', `!clear of ${target} cancelled/timed out for ${message.author.tag} in #${message.channel.name}`);
                const cancel = await message.channel.send('🚫 Clear cancelled.').catch(() => null);
                if (cancel) setTimeout(() => cancel.delete().catch(() => {}), 5000);
                return;
            }
        }

        // Remove the command message first so it isn't left behind.
        await message.delete().catch(() => {});

        let deleted = 0;
        if (skip > 0) {
            // Skip mode: fetch a window covering the skipped + targeted messages (Discord
            // caps a fetch at 100), drop the `skip` most-recent, then bulk-delete the
            // next `target`. Single batch, so it's bounded to the recent-100 window.
            const windowSize = Math.min(100, skip + target);
            const fetched = await message.channel.messages.fetch({ limit: windowSize }).catch((e) => {
                logWarn('MOD', `fetch for skip-clear failed in #${message.channel.name}: ${e.message}`);
                return null;
            });
            if (fetched) {
                const ordered = [...fetched.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
                const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000; // bulkDelete can't touch >14d
                const toDelete = ordered.slice(skip, skip + target).filter((m) => m.createdTimestamp > cutoff);
                if (toDelete.length) {
                    const res = await message.channel.bulkDelete(toDelete, true).catch((e) => {
                        logWarn('MOD', `bulkDelete (skip) failed in #${message.channel.name}: ${e.message}`);
                        return null;
                    });
                    deleted = res ? res.size : 0;
                }
            }
        } else {
            let remaining = target;
            while (remaining > 0) {
                const batch = Math.min(remaining, 100);
                // bulkDelete(n, true): the `true` filters out messages older than 14 days,
                // which Discord refuses to bulk-delete (would otherwise throw).
                const res = await message.channel.bulkDelete(batch, true).catch((e) => {
                    logWarn('MOD', `bulkDelete failed in #${message.channel.name}: ${e.message}`);
                    return null;
                });
                const n = res ? res.size : 0;
                deleted += n;
                remaining -= batch;
                if (n < batch) break; // nothing left that's recent enough to delete
            }
        }

        logInfo('MOD', `Cleared ${deleted} message(s) in #${message.channel.name} by ${message.author.tag}`);

        // Post a short confirmation that self-deletes so it doesn't reclutter the channel.
        const tooOld = deleted < target;
        const note = await message.channel
            .send(`🧹 Cleared **${deleted}** message(s).${tooOld ? ' (Messages older than 14 days can\'t be bulk-deleted.)' : ''}`)
            .catch(() => null);
        if (note) setTimeout(() => note.delete().catch(() => {}), 6000);
    } catch (e) {
        logError('MOD', `!clear error: ${e.message}`);
        try { await message.channel.send('📡 Clear failed. Try again shortly.'); } catch (_) {}
    }
}

module.exports = { handleClearCommand };
