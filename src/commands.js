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
        logInfo('COMMAND', `guess by ${message.author.tag} (${message.author.id})`);
        const args = message.content.replace(/^[\/!]guess\s*/i, '').trim().split(/\s+/);
        const { processGuess } = require('./tekkerChallenge');
        return await processGuess(message, args);
    },
});

register({
    name: 'claim', audience: 'member',
    run: async (message, parts) => {
        logInfo('COMMAND', `!claim by ${message.author.tag} (${message.author.id})`);
        const tokenId = parts[1];
        if (!tokenId) return await message.reply("⚠️ Usage: `!claim <token_id>` (e.g. `!claim T-ABCD12`)");
        const { claimReward } = require('./tekkerChallenge');
        const res = await claimReward(message.author.id, tokenId.trim().toUpperCase());
        if (res.success) {
            return await message.reply(`✅ **Reward claimed!** ${res.message}`);
        } else if (res.pending) {
            return await message.reply(`🪙 ${res.message}`);
        } else {
            return await message.reply(`❌ **Claim failed**: ${res.error}`);
        }
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
    name: 'tokens', audience: 'member',
    run: async (message) => {
        logInfo('COMMAND', `!tokens by ${message.author.tag} (${message.author.id})`);
        const db = require('./tekkerDb');
        const tokens = await db.getUnclaimedTokens(message.author.id);
        if (tokens.length === 0) {
            return await message.reply("ℹ️ You have no unclaimed weapon tokens. Solve a `/guess` puzzle in the channel to earn one!");
        }
        const lines = tokens.map(t => `• \`${t.token_id}\` — **❓ SPECIAL WEAPON** (${t.stat_native}/${t.stat_abeast}/${t.stat_machine}/${t.stat_dark}/${t.stat_hit})`);
        return await message.reply(`🎁 **Your Saved Weapon Tokens**:\n${lines.join('\n')}\n\n*Your tokens are saved to your account. In-game claiming is coming soon — for now use \`!gift <token_id> @PlayerName\` to transfer one to a friend.*`);
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
            await announceDrop(drop);
            logInfo('TEKKER', `Manual drop rolled by admin ${message.author.tag}: stats ${drop.stat_native}/${drop.stat_abeast}/${drop.stat_machine}/${drop.stat_dark}/${drop.stat_hit}, hint ${drop.hint_attribute}=0%.`);
            return await message.reply(`🚨 **New Tekker Challenge puzzle rolled manually by admin!**`);
        } else if (sub === 'tokens' || sub === 'all') {
            // Admin oversight: every token earned across all players (real weapon
            // names shown — this is the admin view used to fulfil claims).
            if (!message.member || !message.member.permissions.has('Administrator')) {
                return await message.reply('🔒 `!tekker tokens` is for server admins only.');
            }
            const all = await db.getAllTokens();
            if (!all.length) {
                return await message.reply('ℹ️ No Tekker tokens have been earned yet.');
            }
            const unclaimed = all.filter(t => !t.is_claimed).length;
            const lines = all.map(t => {
                const stats = `${t.stat_native}/${t.stat_abeast}/${t.stat_machine}/${t.stat_dark}/${t.stat_hit}`;
                const status = t.is_claimed
                    ? `claimed by <@${t.claimed_by}> at ${t.claimed_at}`
                    : 'UNCLAIMED';
                return `• \`${t.token_id}\` — stats **${stats}** — owner <@${t.owner_id}> — ${status}`;
            });
            const report = `**Tekker Tokens — ${all.length} total · ${unclaimed} unclaimed · ${all.length - unclaimed} claimed**\n` + lines.join('\n');
            if (await dmAdminReport(message, report, '!tekker tokens')) {
                return await message.reply(`📬 Sent you all ${all.length} Tekker token(s) in a DM.`);
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
        } else if (sub === 'setclaimed') {
            if (!message.member || !message.member.permissions.has('Administrator')) {
                return await message.reply('🔒 `!tekker setclaimed` is for server admins only.');
            }
            const tokenId = (parts[2] || '').toUpperCase();
            const flag = (parts[3] || '').toLowerCase();
            const claimed = ['on', '1', 'true', 'yes'].includes(flag) ? 1 : (['off', '0', 'false', 'no'].includes(flag) ? 0 : null);
            if (!tokenId || claimed === null) return await message.reply('⚠️ Usage: `!tekker setclaimed <token_id> <on|off>`.');
            const tok = await db.getToken(tokenId);
            if (!tok) return await message.reply(`❌ Token \`${tokenId}\` not found.`);
            await db.setTokenClaimed(tokenId, claimed, message.author.id);
            logInfo('TEKKER', `Admin ${message.author.tag} set token ${tokenId} claimed=${claimed}`);
            return await message.reply(`✅ Token \`${tokenId}\` marked **${claimed ? 'claimed' : 'unclaimed'}**.`);
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
