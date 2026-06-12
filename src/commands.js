// =====================================================================
// COMMAND ROUTER
// The single entry point for every "!"/"/" prefixed command. messageHandler
// delegates here: dispatch() applies the website-dependency health gate, finds
// the first registered command whose matcher accepts the message, and runs it.
//
// Each registry entry:
//   { name, aliases, prefixes, match, audience, passthrough, run }
//   • name / aliases / prefixes — used to build the default matcher.
//   • match(content)  — predicate. Defaults to a startsWith test built from
//                       prefixes × (name + aliases), which preserves the exact
//                       semantics (and shadowing!) of the original if-chain —
//                       e.g. "!quests" is caught by the "!quest" entry. Custom
//                       matchers handle the irregular cases: "!sync all" must
//                       win over "!sync", and "!nickname" matches via regex.
//   • audience        — descriptive tier label ('admin'|'support'|'member')
//                       for documentation. NOT enforced here: each handler
//                       keeps its own permission check so its tailored refusal
//                       message is preserved. Order of entries is what matters
//                       for routing, not this field.
//   • passthrough     — true for commands that intentionally fall through to
//                       the AI conversation handler (!stats, !quests, …): they
//                       log and let dispatch() return false.
//   • run(message, parts) — does the work. `parts` is the whitespace-split
//                       token list (parts[0] is the command word).
//
// dispatch() returns true when the message was consumed — handled, blocked by
// the health gate, or an unrecognized command that should be ignored — so the
// caller stops. It returns false only for passthrough commands, telling
// messageHandler to continue into the AI flow.
// =====================================================================
const { logInfo, logWarn, handleLogCommand } = require('./actionLog');
const { gateCommand, handleHealthCommand } = require('./healthcheck');
const {
    handleSyncCommand,
    handleSyncAllCommand,
    handleLockCommand,
    handleNicknameCommand,
    handleHelpCommand,
    handleRolesCommand,
    handleChannelsCommand,
    dmAdminReport,
} = require('./roleSync');
const { handleRestartCommand, handlePullCommand } = require('./system');
const { handleClearCommand } = require('./moderation');

// --- Registry -------------------------------------------------------------
const registry = [];

// Build the default matcher: startsWith over every prefix × word combination,
// matching the original if-chain's case-sensitive startsWith checks.
function defaultMatch(entry) {
    const prefixes = entry.prefixes || ['!'];
    const words = [entry.name, ...(entry.aliases || [])];
    const tokens = [];
    for (const p of prefixes) for (const w of words) tokens.push(p + w);
    return (content) => tokens.some((t) => content.startsWith(t));
}

function register(entry) {
    if (!entry.match) entry.match = defaultMatch(entry);
    registry.push(entry);
    return entry;
}

// Shared handler for passthrough commands: log, then let the message continue
// to the AI conversation handler (dispatch returns false).
async function passthroughRun(message) {
    logInfo('COMMAND', `${message.content.split(/\s+/)[0]} by ${message.author.tag} (${message.author.id})`);
}

// --- Command definitions (ORDER MATTERS — first matching entry wins) -------

register({
    name: 'health', audience: 'support',
    run: (message) => handleHealthCommand(message),
});

register({
    name: 'guess', prefixes: ['/', '!'], audience: 'member',
    run: async (message) => {
        const reply = await message.reply(
            "🎮 **Don't type that as a message — use the `/guess` slash command.**\n" +
            "Type `/` in the message box and **pick `guess` from the popup menu**, then fill in the five numbers (Native · A.Beast · Machine · Dark · Hit). That sends the real command so I can score it.\n" +
            "*If `/guess` doesn't appear in the popup, it may still be syncing (global commands can take a little while), and note it only works in the server — not in DMs.*"
        );
        if (message.guild) {
            setTimeout(() => {
                message.delete().catch(() => {});
                reply.delete().catch(() => {});
            }, 5000);
        }
    },
});

register({
    name: 'claim', audience: 'member',
    run: async (message) => {
        logInfo('COMMAND', `!claim by ${message.author.tag} (${message.author.id})`);
        // Claiming is a website action: it requires you to be logged in (Discord
        // linked) AND online in-game so the weapon can drop at your feet. The bot
        // can't do that on your behalf, so point you to the redemption flow.
        return await message.reply(
            `🪙 **Claim your tokens on the website.**\n` +
            `Log in at https://psobb.io/ with your Discord linked, hop online in-game, then redeem your weapon tokens from your dashboard — you can combine up to **3 tokens** into one weapon (higher tiers unlock with more tokens).\n` +
            `Use \`!tokens\` to see what you're holding, or \`!trade @player <your_token> <their_token>\` to swap with someone.`
        );
    },
});

register({
    name: 'gift', audience: 'member',
    run: async (message, parts) => {
        logInfo('COMMAND', `!gift by ${message.author.tag} (${message.author.id})`);
        const tokenId = parts[1];
        const targetUser = message.mentions.users.first() || (parts[2] ? { id: parts[2] } : null);
        if (!tokenId || !targetUser) {
            return await message.reply("⚠️ Usage: `!gift <token_id> @PlayerName` (e.g. `!gift T-ABCD12 @Friend`)");
        }
        const { giftReward } = require('./tekkerChallenge');
        const res = await giftReward(message.author.id, tokenId.trim().toUpperCase(), targetUser.id);
        if (res.success) {
            return await message.reply(`🎁 **Gifted successfully!** Transferred token \`${tokenId.trim().toUpperCase()}\` (❓ SPECIAL WEAPON ${res.token.stat_native}/${res.token.stat_abeast}/${res.token.stat_machine}/${res.token.stat_dark}/${res.token.stat_hit}) to <@${targetUser.id}>.`);
        } else {
            return await message.reply(`❌ **Gift failed**: ${res.error}`);
        }
    },
});

register({
    name: 'trade', audience: 'member',
    run: async (message, parts) => {
        logInfo('COMMAND', `!trade by ${message.author.tag} (${message.author.id})`);
        if (!message.guild) {
            return await message.reply('⚠️ Trades must be started in a server channel so the other player can confirm.');
        }

        const target = message.mentions.users.first();
        // Token ids look like `T-XXXXXX`; pull them out in order, ignoring the @mention.
        const tokenIds = parts.slice(1).filter(p => /^T-/i.test(p)).map(p => p.trim().toUpperCase());

        if (!target || tokenIds.length !== 2) {
            return await message.reply('⚠️ Usage: `!trade @player <your_token> <their_token>` (e.g. `!trade @Friend T-ABC123 T-XYZ789`). You offer the first token; they give you the second.');
        }
        if (target.id === message.author.id) {
            return await message.reply("⚠️ You can't trade with yourself.");
        }
        if (target.bot) {
            return await message.reply("⚠️ You can't trade with a bot.");
        }

        const [myToken, theirToken] = tokenIds;
        if (myToken === theirToken) {
            return await message.reply('⚠️ Those are the same token — pick one token from each side.');
        }

        const db = require('./tekkerDb');
        const mine = await db.getToken(myToken);
        const theirs = await db.getToken(theirToken);

        if (!mine || String(mine.owner_id) !== message.author.id) {
            return await message.reply(`❌ You don't own \`${myToken}\` (or it no longer exists).`);
        }
        if (!theirs || String(theirs.owner_id) !== target.id) {
            return await message.reply(`❌ <@${target.id}> doesn't own \`${theirToken}\` (or it no longer exists).`);
        }

        const fmt = (t) => `${t.stat_native}/${t.stat_abeast}/${t.stat_machine}/${t.stat_dark}/${t.stat_hit}`;

        const offer = await message.channel.send({
            content:
                `🤝 **Trade offer** — <@${target.id}>, <@${message.author.id}> wants to swap tokens:\n` +
                `• You receive: \`${myToken}\` (❓ SPECIAL WEAPON ${fmt(mine)})\n` +
                `• You give: \`${theirToken}\` (❓ SPECIAL WEAPON ${fmt(theirs)})\n\n` +
                `<@${target.id}> react ✅ to accept or ❌ to decline within 60s.`,
            allowedMentions: { users: [target.id, message.author.id] },
        });

        try {
            await offer.react('✅');
            await offer.react('❌');
        } catch (e) {
            logWarn('COMMAND', `!trade could not add reactions: ${e.message}`);
        }

        const filter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && user.id === target.id;
        let collected;
        try {
            collected = await offer.awaitReactions({ filter, max: 1, time: 60000, errors: ['time'] });
        } catch (e) {
            offer.reactions.removeAll().catch(() => {});
            return await message.channel.send(`⌛ Trade offer to <@${target.id}> expired with no response.`);
        }

        offer.reactions.removeAll().catch(() => {});

        if (collected.first().emoji.name === '❌') {
            return await message.channel.send(`❌ <@${target.id}> declined the trade.`);
        }

        // Re-validate ownership at acceptance time: either token may have been gifted,
        // traded, or claimed away during the 60s window.
        const mineNow = await db.getToken(myToken);
        const theirsNow = await db.getToken(theirToken);
        if (!mineNow || String(mineNow.owner_id) !== message.author.id ||
            !theirsNow || String(theirsNow.owner_id) !== target.id) {
            return await message.channel.send('⚠️ Trade aborted — one of the tokens changed hands or was claimed before both sides confirmed. Please start a new trade.');
        }

        await db.transferToken(myToken, target.id);
        await db.transferToken(theirToken, message.author.id);
        logInfo('TEKKER', `Trade: ${message.author.tag} (${message.author.id}) ↔ ${target.tag} (${target.id}); ${myToken}→${target.id}, ${theirToken}→${message.author.id}`);

        return await message.channel.send(
            `✅ **Trade complete!**\n` +
            `• <@${message.author.id}> now owns \`${theirToken}\`.\n` +
            `• <@${target.id}> now owns \`${myToken}\`.`
        );
    },
});

register({
    name: 'tokens', audience: 'member',
    run: async (message) => {
        logInfo('COMMAND', `!tokens by ${message.author.tag} (${message.author.id})`);
        const db = require('./tekkerDb');
        const tokens = await db.getUnclaimedTokens(message.author.id);
        if (tokens.length === 0) {
            return await message.reply("ℹ️ You have no unclaimed weapon tokens. Solve a `/guess` puzzle in the channel to earn one!");
        }
        const lines = tokens.map(t => `• \`${t.token_id}\` — **❓ SPECIAL WEAPON** (${t.stat_native}/${t.stat_abeast}/${t.stat_machine}/${t.stat_dark}/${t.stat_hit})`);
        return await message.reply(`🎁 **Your Saved Weapon Tokens**:\n${lines.join('\n')}\n\n*Redeem these on https://psobb.io/ while logged in (Discord linked) and online in-game — you can combine up to 3 into one weapon. Or \`!gift <token_id> @player\` to give one away, or \`!trade @player <your_token> <their_token>\` to swap.*`);
    },
});

register({
    name: 'tekker', audience: 'member', // status is open; admin subcommands self-gate inside
    run: async (message, parts) => {
        const sub = (parts[1] || '').toLowerCase();
        logInfo('COMMAND', `!tekker ${sub || '(status)'} by ${message.author.tag} (${message.author.id})`);

        const db = require('./tekkerDb');

        if (sub === 'roll' || sub === 'start') {
            if (!message.member || !message.member.permissions.has('Administrator')) {
                return await message.reply('🔒 `!tekker roll` is for server admins only.');
            }
            const { generateDrop, announceDrop } = require('./tekkerChallenge');
            await db.clearActiveUsers();
            const drop = await generateDrop();
            // generateDrop returns null when the storage backend can't create the
            // drop (e.g. the live website endpoint is out of date). Surface that to
            // the admin instead of throwing on a null drop and replying nothing.
            if (!drop) {
                return await message.reply(
                    '⚠️ **Could not start a puzzle.** The Tekker storage backend rejected the new drop — the live website `bot_tekker_db.php` endpoint is likely out of date. ' +
                    'Run `!health` to check, deploy the website update, or start the bot with `TEKKER_LOCAL_MODE=1` to play against the local test store.'
                );
            }
            await announceDrop(drop);
            logInfo('TEKKER', `Manual drop rolled by admin ${message.author.tag}: stats ${drop.stat_native}/${drop.stat_abeast}/${drop.stat_machine}/${drop.stat_dark}/${drop.stat_hit}, hint ${drop.hint_attribute}=0%.`);
            return await message.reply(`🚨 **New Tekker Challenge puzzle rolled manually by admin!**`);
        } else if (sub === 'tokens' || sub === 'all') {
            // Admin oversight. Two distinct stores now: outstanding tokens still live
            // in tekker_tokens (claimed ones are DELETED on redemption), while the
            // record of what was claimed lives in the consolidated tekker_claim_log.
            // Show both: outstanding (unclaimed) tokens + the claimed-rewards history.
            if (!message.member || !message.member.permissions.has('Administrator')) {
                return await message.reply('🔒 `!tekker tokens` is for server admins only.');
            }
            // tekker_tokens only holds outstanding tokens (claims delete the row), but
            // filter defensively in case any legacy is_claimed=1 rows linger.
            const unclaimed = (await db.getAllTokens()).filter(t => !t.is_claimed);
            const claims = await db.getClaimLog(100);

            const sections = [];

            if (unclaimed.length) {
                const lines = unclaimed.map(t => {
                    const stats = `${t.stat_native}/${t.stat_abeast}/${t.stat_machine}/${t.stat_dark}/${t.stat_hit}`;
                    return `• \`${t.token_id}\` — stats **${stats}** — owner <@${t.owner_id}>`;
                });
                sections.push(`**🎁 Unclaimed Tokens (${unclaimed.length})**\n` + lines.join('\n'));
            } else {
                sections.push(`**🎁 Unclaimed Tokens (0)**\n_None outstanding._`);
            }

            if (claims.length) {
                const lines = claims.map(c => {
                    const stats = `${c.stat_native}/${c.stat_abeast}/${c.stat_machine}/${c.stat_dark}/${c.stat_hit}`;
                    let ids;
                    try { ids = JSON.parse(c.token_ids); } catch (e) { ids = null; }
                    const idStr = Array.isArray(ids) ? ids.join(', ') : String(c.token_ids || '');
                    const who = c.discord_id ? `<@${c.discord_id}>` : `account #${c.account_id}`;
                    return `• ${who} → **${c.weapon_name}** (${stats}) — ${c.token_count} token(s) [${idStr}] — ${c.claimed_at}`;
                });
                sections.push(`**🏆 Claimed Rewards (${claims.length})**\n` + lines.join('\n'));
            } else {
                sections.push(`**🏆 Claimed Rewards (0)**\n_No rewards claimed yet._`);
            }

            const report = sections.join('\n\n');
            if (await dmAdminReport(message, report, '!tekker tokens')) {
                return await message.reply(`📬 Sent you the Tekker report in a DM — **${unclaimed.length}** unclaimed token(s) · **${claims.length}** claimed reward(s).`);
            }
            return;
        } else if (sub === 'grant') {
            if (!message.member || !message.member.permissions.has('Administrator')) {
                return await message.reply('🔒 `!tekker grant` is for server admins only.');
            }
            const target = message.mentions.users.first();
            const nums = parts.slice(2).filter(p => /^\d+$/.test(p)).map(Number);
            if (!target || nums.length !== 5) {
                return await message.reply('⚠️ Usage: `!tekker grant @user <Native> <A.Beast> <Machine> <Dark> <Hit>` (e.g. `!tekker grant @User 0 90 0 55 20`).');
            }
            const { adminGrantToken } = require('./tekkerChallenge');
            const gres = await adminGrantToken(target.id, nums);
            if (gres.error) return await message.reply(`❌ ${gres.error}`);
            logInfo('TEKKER', `Admin ${message.author.tag} granted token ${gres.tokenId} (${nums.join('/')}) to ${target.id}`);
            return await message.reply(`✅ Granted token \`${gres.tokenId}\` (stats **${nums.join('/')}**) to <@${target.id}>.`);
        } else if (sub === 'revoke' || sub === 'delete') {
            if (!message.member || !message.member.permissions.has('Administrator')) {
                return await message.reply('🔒 `!tekker revoke` is for server admins only.');
            }
            const tokenId = (parts[2] || '').toUpperCase();
            if (!tokenId) return await message.reply('⚠️ Usage: `!tekker revoke <token_id>`.');
            const tok = await db.getToken(tokenId);
            if (!tok) return await message.reply(`❌ Token \`${tokenId}\` not found.`);
            await db.deleteToken(tokenId);
            logInfo('TEKKER', `Admin ${message.author.tag} revoked token ${tokenId} (was owner ${tok.owner_id})`);
            return await message.reply(`🗑️ Revoked token \`${tokenId}\` (was owned by <@${tok.owner_id}>).`);
        } else if (sub === 'give' || sub === 'setowner') {
            if (!message.member || !message.member.permissions.has('Administrator')) {
                return await message.reply('🔒 `!tekker give` is for server admins only.');
            }
            const tokenId = (parts[2] || '').toUpperCase();
            const target = message.mentions.users.first();
            if (!tokenId || !target) return await message.reply('⚠️ Usage: `!tekker give <token_id> @user`.');
            const tok = await db.getToken(tokenId);
            if (!tok) return await message.reply(`❌ Token \`${tokenId}\` not found.`);
            await db.transferToken(tokenId, target.id);
            logInfo('TEKKER', `Admin ${message.author.tag} reassigned token ${tokenId} → ${target.id}`);
            return await message.reply(`🔁 Reassigned token \`${tokenId}\` to <@${target.id}>.`);
        } else if (sub === 'threshold') {
            if (!message.member || !message.member.permissions.has('Administrator')) {
                return await message.reply('🔒 `!tekker threshold` is for server admins only.');
            }
            if (parts[2] === undefined) {
                const cur = await db.getTriggerThreshold();
                return await message.reply(`🎚️ Current trigger threshold: **${cur}** unique linked contributors.`);
            }
            const v = parseInt(parts[2], 10);
            if (Number.isNaN(v) || v < 1) return await message.reply('⚠️ Usage: `!tekker threshold <positive number>`.');
            await db.setTriggerThreshold(v);
            logInfo('TEKKER', `Admin ${message.author.tag} set trigger threshold to ${v}`);
            return await message.reply(`🎚️ Trigger threshold set to **${v}**.`);
        } else {
            const drop = await db.getActiveDrop();
            const uniqueUsers = await db.getActiveUserCount();
            const threshold = await db.getTriggerThreshold();

            if (drop) {
                const EMOJIS = { "Native": "🗡️", "A.Beast": "🐾", "Machine": "🤖", "Dark": "👻", "Hit": "🎯" };
                return await message.reply(
                    `🎮 **Tekker Challenge Status**\n` +
                    `• Active Drop: **[❓ SPECIAL WEAPON]**\n` +
                    `• Scanner Hint: **${EMOJIS[drop.hint_attribute]} ${drop.hint_attribute}** is **0%**.\n\n` +
                    `*Use \`/guess [Native] [A.Beast] [Machine] [Dark] [Hit]\` to claim it!*`
                );
            } else {
                const P = Math.min(100, (uniqueUsers / threshold) * 100);
                return await message.reply(
                    `📡 **Tekker Challenge Status**\n` +
                    `• No active drop detected.\n` +
                    `• Active users pool: **${uniqueUsers}/${threshold}** unique linked contributors.\n` +
                    `• Next drop chance: **${P.toFixed(1)}%** on subsequent linked user interactions.\n\n` +
                    `*Chat, react, or hang out in voice channels to trigger the scanner!*`
                );
            }
        }
    },
});

register({
    name: 'quest', prefixes: ['!', '$'], audience: 'member',
    run: async (message) => {
        logInfo('COMMAND', `!quest (deprecated) by ${message.author.tag}`);
        return await message.reply("📡 **Notice:** The manual `!quest` command has been deprecated. Mission Command now monitors your progress automatically! You will receive random bounties directly to your Guild Card while playing on the server.");
    },
});

register({
    name: 'log', audience: 'support',
    run: (message) => handleLogCommand(message),
});

register({
    name: 'interactions', audience: 'support',
    run: (message) => {
        const { handleInteractionsCommand } = require('./interactions');
        return handleInteractionsCommand(message);
    },
});

register({
    name: 'restart', audience: 'admin',
    run: (message) => handleRestartCommand(message),
});

register({
    name: 'pull', aliases: ['gitpull', 'update'], audience: 'admin',
    run: (message) => handlePullCommand(message),
});

register({
    name: 'clear', aliases: ['purge'], audience: 'admin',
    run: (message) => handleClearCommand(message),
});

register({
    name: 'roles', audience: 'support',
    run: (message) => handleRolesCommand(message),
});

register({
    name: 'channels', audience: 'support',
    run: (message) => handleChannelsCommand(message),
});

register({
    name: 'commands', aliases: ['help'], audience: 'member',
    run: (message) => handleHelpCommand(message),
});

register({
    name: 'lock', aliases: ['unlock'], audience: 'support',
    run: (message) => handleLockCommand(message),
});

register({
    name: 'nickname', aliases: ['nick'], audience: 'support',
    match: (c) => /^!(nickname|nick)\b/i.test(c),
    run: (message) => handleNicknameCommand(message),
});

// "!sync all" must be tested before the plain "!sync" entry below.
register({
    name: 'sync-all', audience: 'support',
    match: (c) => /^!sync\s+all\b/i.test(c),
    run: (message) => handleSyncAllCommand(message),
});

register({
    name: 'notify', audience: 'member',
    run: async (message, parts) => {
        const { getPrefs, setPref } = require('./notificationPrefs');
        const userId = message.author.id;
        
        const typeInput = parts[1];
        const actionInput = parts[2];
        
        if (!typeInput) {
            const p = getPrefs(userId);
            return await message.reply(
                `🔔 **Notification Preferences**\n` +
                `• DMs (Direct Messages): ${p.DM ? '✅ Enabled (push notifications)' : '🔕 Silent (by default)'}\n` +
                `• LFG Announcements: ${p.LFG ? '✅ Enabled (push notifications)' : '🔕 Silent (by default)'}\n` +
                `• Party Voice Rooms (VC): ${p.VC ? '✅ Enabled (push notifications)' : '🔕 Silent (by default)'}\n\n` +
                `*Usage: \`!notify <DM|LFG|VC> <on|off|enable|disable>\` (e.g. \`!notify DM on\` or \`!notify LFG off\`)*`
            );
        }
        
        const type = typeInput.toUpperCase();
        if (type !== 'DM' && type !== 'LFG' && type !== 'VC') {
            return await message.reply('⚠️ Invalid notification type. Choose `DM`, `LFG`, or `VC`.');
        }
        
        if (!actionInput) {
            const p = getPrefs(userId);
            const val = p[type];
            return await message.reply(`🔔 **${type} Notifications** are currently: ${val ? '✅ Enabled (push)' : '🔕 Silent (default)'}.`);
        }
        
        const action = actionInput.toLowerCase();
        if (action !== 'on' && action !== 'off' && action !== 'enable' && action !== 'disable') {
            return await message.reply('⚠️ Invalid action. Use `on`, `off`, `enable`, or `disable`.');
        }
        
        const value = (action === 'on' || action === 'enable');
        setPref(userId, type, value);
        
        return await message.reply(`✅ Updated! **${type}** push notifications are now **${value ? 'ENABLED' : 'DISABLED (silent)'}**.`);
    }
});

register({
    name: 'sync', audience: 'member',
    run: (message) => handleSyncCommand(message),
});

// Passthrough: log, then fall through to the AI conversation handler.
register({ name: 'stats', audience: 'member', passthrough: true, run: passthroughRun });
register({ name: 'quests', audience: 'member', passthrough: true, run: passthroughRun });
register({ name: 'progress', audience: 'member', passthrough: true, run: passthroughRun });
register({ name: 'progression', audience: 'member', passthrough: true, run: passthroughRun });

// --- Dispatch -------------------------------------------------------------
// Returns true when the message was consumed and the caller should stop;
// false only for passthrough commands that should continue to the AI flow.
async function dispatch(message) {
    // Block commands whose website backend failed the startup health check,
    // replying to the invoker with a notice instead of running dead code.
    if (await gateCommand(message)) return true;

    const content = message.content || '';
    const parts = content.trim().split(/\s+/);

    for (const entry of registry) {
        if (!entry.match(content)) continue;
        if (entry.passthrough) {
            await entry.run(message, parts);
            return false; // let messageHandler continue into the AI flow
        }
        try {
            await entry.run(message, parts);
        } catch (e) {
            logWarn('COMMAND', `Handler for "${entry.name}" threw: ${e.message}`);
        }
        return true;
    }

    // Unrecognized "!"/"/" command: ignore it (the original chain returned here).
    return true;
}

module.exports = { register, dispatch, registry };
