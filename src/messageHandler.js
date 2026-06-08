// Discord message handling: the raw-packet DM relay and the main MessageCreate
// handler (commands, AI conversation, tool-calling loop, reply chunking).
const fs = require('fs');
const path = require('path');
const { Events } = require('discord.js');
const { config, MEMORY_DIR } = require('./config');
const { client } = require('./discordClient');
const { model } = require('./model');
const { toolHandlers } = require('./tools');
const { loadSocialMemory } = require('./socialMemory');
const { getCurrentPlayerSession } = require('./session');
const { handleSyncCommand, handleSyncAllCommand, handleLockCommand, handleNicknameCommand, handleHelpCommand, handleRolesCommand, handleChannelsCommand, dmAdminReport } = require('./roleSync');
const { handleLogCommand, logInfo, logWarn } = require('./actionLog');
const { handleRestartCommand, handlePullCommand } = require('./system');
const { handleClearCommand } = require('./moderation');
const { gateCommand, isFeatureUp, featureForTool, toolDownResult, handleHealthCommand } = require('./healthcheck');

const handledMessages = new Set();

function registerMessageHandlers() {
    client.on("raw", async (packet) => {
        if (packet.t === "MESSAGE_CREATE") {
            if (!packet.d.guild_id) {
                try {
                    const channel = await client.channels.fetch(packet.d.channel_id);
                    const message = await channel.messages.fetch(packet.d.id);
                    if (message && !handledMessages.has(message.id)) {
                        client.emit(Events.MessageCreate, message);
                    }
                } catch (e) {}
            }
        }
    });

    // Listen to reactions to track unique active users for the tekker challenge
    client.on(Events.MessageReactionAdd, async (reaction, user) => {
        if (!user || user.bot) return;
        if (!reaction.message.guild) return;
        try {
            const { markInteracted } = require('./interactions');
            markInteracted(user.id);
            const { trackActivity } = require('./tekkerChallenge');
            await trackActivity(user.id, reaction.message.guild, 'reaction');
        } catch (e) {}
    });

    client.on(Events.MessageCreate, async (message) => {
        if (!message || message.system || handledMessages.has(message.id)) return;
        handledMessages.add(message.id);
        if (handledMessages.size > 1000) handledMessages.clear();

        if (message.author && message.author.bot) return;

        // Mark user as having interacted and feed activity to the tekker scanner
        if (message.guild && message.author && !message.author.bot) {
            const { markInteracted } = require('./interactions');
            markInteracted(message.author.id);
            if (!message.content.startsWith('!') && !message.content.startsWith('/')) {
                const { trackActivity } = require('./tekkerChallenge');
                trackActivity(message.author.id, message.guild, 'message').catch(() => {});
            }
        }

        const isDM = !message.guild;
        const isMentioned = message.mentions.has(client.user);
        const isCommand = message.content.startsWith('!') || message.content.startsWith('/');
        const isConfigChannel = message.channel.id === config.channel_id;

        if (!isDM && !isMentioned && !isCommand && !isConfigChannel) return;
        if (isCommand) {
            // Block commands whose website backend failed the startup health check,
            // replying to the invoker with a notice instead of running dead code.
            if (await gateCommand(message)) return;
            if (message.content.startsWith('!health')) {
                return await handleHealthCommand(message);
            }
            if (message.content.startsWith('/guess') || message.content.startsWith('!guess')) {
                logInfo('COMMAND', `guess by ${message.author.tag} (${message.author.id})`);
                const args = message.content.replace(/^[\/!]guess\s*/i, '').trim().split(/\s+/);
                const { processGuess } = require('./tekkerChallenge');
                return await processGuess(message, args);
            }
            if (message.content.startsWith('!claim')) {
                logInfo('COMMAND', `!claim by ${message.author.tag} (${message.author.id})`);
                const parts = message.content.trim().split(/\s+/);
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
            }
            if (message.content.startsWith('!gift')) {
                logInfo('COMMAND', `!gift by ${message.author.tag} (${message.author.id})`);
                const parts = message.content.trim().split(/\s+/);
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
            }
            if (message.content.startsWith('!tokens')) {
                logInfo('COMMAND', `!tokens by ${message.author.tag} (${message.author.id})`);
                const db = require('./tekkerDb');
                const tokens = await db.getUnclaimedTokens(message.author.id);
                if (tokens.length === 0) {
                    return await message.reply("ℹ️ You have no unclaimed weapon tokens. Solve a `/guess` puzzle in the channel to earn one!");
                }
                const lines = tokens.map(t => `• \`${t.token_id}\` — **❓ SPECIAL WEAPON** (${t.stat_native}/${t.stat_abeast}/${t.stat_machine}/${t.stat_dark}/${t.stat_hit})`);
                return await message.reply(`🎁 **Your Saved Weapon Tokens**:\n${lines.join('\n')}\n\n*Your tokens are saved to your account. In-game claiming is coming soon — for now use \`!gift <token_id> @PlayerName\` to transfer one to a friend.*`);
            }
            if (message.content.startsWith('!tekker')) {
                const parts = message.content.trim().split(/\s+/);
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
            }
            if (message.content.startsWith('!quest') || message.content.startsWith('$quest')) {
                logInfo('COMMAND', `!quest (deprecated) by ${message.author.tag}`);
                return await message.reply("📡 **Notice:** The manual `!quest` command has been deprecated. Mission Command now monitors your progress automatically! You will receive random bounties directly to your Guild Card while playing on the server.");
            }
            if (message.content.startsWith('!log')) {
                return await handleLogCommand(message);
            }
            if (message.content.startsWith('!interactions')) {
                const { handleInteractionsCommand } = require('./interactions');
                return await handleInteractionsCommand(message);
            }
            if (message.content.startsWith('!restart')) {
                return await handleRestartCommand(message);
            }
            if (message.content.startsWith('!pull') || message.content.startsWith('!gitpull') || message.content.startsWith('!update')) {
                return await handlePullCommand(message);
            }
            if (message.content.startsWith('!clear') || message.content.startsWith('!purge')) {
                return await handleClearCommand(message);
            }
            if (message.content.startsWith('!roles')) {
                return await handleRolesCommand(message);
            }
            if (message.content.startsWith('!channels')) {
                return await handleChannelsCommand(message);
            }
            if (message.content.startsWith('!commands') || message.content.startsWith('!help')) {
                return await handleHelpCommand(message);
            }
            if (message.content.startsWith('!lock') || message.content.startsWith('!unlock')) {
                return await handleLockCommand(message);
            }
            if (/^!(nickname|nick)\b/i.test(message.content)) {
                return await handleNicknameCommand(message);
            }
            if (/^!sync\s+all\b/i.test(message.content)) {
                return await handleSyncAllCommand(message);
            }
            if (message.content.startsWith('!sync')) {
                return await handleSyncCommand(message);
            }
            if (!message.content.startsWith('!stats') && !message.content.startsWith('!quests') && !message.content.startsWith('!progress') && !message.content.startsWith('!progression')) return;
            logInfo('COMMAND', `${message.content.split(/\s+/)[0]} by ${message.author.tag} (${message.author.id})`);
        }

        console.log("[MSG] From: " + message.author.tag + " | Content: " + message.content);

        try {
            const logLine = `[${new Date().toISOString()}] ${message.author.tag}: ${message.content}\n`;
            fs.appendFileSync(path.join(MEMORY_DIR, 'questions.log'), logLine);
        } catch (e) {
            console.error("Failed to append to questions.log:", e.message);
        }

        try {
            if (message.channel.sendTyping) await message.channel.sendTyping().catch(() => {});

            const rawHistory = await message.channel.messages.fetch({ limit: 50 });
            let historyMsgs = Array.from(rawHistory.values()).reverse().filter(m => m.id !== message.id && !m.content.startsWith('!'));

            if (message.guild) {
                // Isolate public channel history by user
                historyMsgs = historyMsgs.filter(m => {
                    if (m.author.id === message.author.id) return true;
                    if (m.author.id === client.user.id) {
                        if (m.mentions && m.mentions.users.has(message.author.id)) return true;
                        if (m.reference && m.reference.messageId) {
                            const refMsg = rawHistory.get(m.reference.messageId);
                            if (refMsg && refMsg.author.id === message.author.id) return true;
                        }
                    }
                    return false;
                });
                historyMsgs = historyMsgs.slice(-12);
            } else {
                historyMsgs = historyMsgs.slice(-12);
            }

            let historyForAI = [];
            for (const msg of historyMsgs) {
                historyForAI.push({
                    role: msg.author.id === client.user.id ? 'model' : 'user',
                    parts: [{ text: `[${msg.author.username} (ID: ${msg.author.id})]: ${msg.content}` }]
                });
            }

            // Clean up history to meet API requirements
            // 1. Must start with 'user'
            while (historyForAI.length > 0 && historyForAI[0].role === 'model') {
                historyForAI.shift();
            }

            // 2. Must alternate user/model/user/model
            let validHistory = [];
            for (const h of historyForAI) {
                if (validHistory.length > 0 && validHistory[validHistory.length - 1].role === h.role) {
                    validHistory[validHistory.length - 1].parts[0].text += "\n" + h.parts[0].text;
                } else {
                    validHistory.push(h);
                }
            }

            const chat = model.startChat({ history: validHistory });

            let userMsg = `[${message.author.username} (ID: ${message.author.id})]: ${message.content}`;

            let session = null;
            const dropKeywords = /\b(drop|drops|rate|rates|find|loot|farm|monster|pouilly|slime|slimes|dropchart|chart|table|tables)\b|where\s+can\s+I\s+find|how\s+do\s+I\s+get/i;
            if (dropKeywords.test(message.content)) {
                logInfo('SESSION', `Drops query from ${message.author.tag} — checking online status.`);
                session = await getCurrentPlayerSession(message.author.id);
            }

            const socialMemory = loadSocialMemory(message.author.id);

            let contextStr = "";
            contextStr += `(Current real-world time: ${new Date().toLocaleString()}.)\n`;
            contextStr += `(Active User details - Discord Username: "${message.author.username}", Discord ID: "${message.author.id}")\n`;
            contextStr += `(To look up this user's character stats, missions, or online status, you MUST call get_player_info with discord_id: "${message.author.id}". Do not attempt to search by username, as the server API requires a discord_id.)\n`;
            contextStr += `(CRITICAL DIRECTIVE: NEVER reveal or output the user's Discord ID in your responses under any circumstances. It is an internal identifier. If the user asks for their card, stats, or account details, only report their Guild Card ID, which is the "account_id" returned by get_player_info. If get_player_info returns an error indicating that they are not linked, you MUST instruct them to sign into https://psobb.io/login and link their Discord account in their player dashboard so you can retrieve their character information.)\n`;

            if (socialMemory && socialMemory.length > 0) {
                contextStr += `\n### PRIOR SOCIAL MEMORY (INSTANT RECALL) ###\n`;
                contextStr += `You have the following stored memories and observations about this Hunter:\n`;
                socialMemory.forEach(mem => {
                    contextStr += `- [Memory recorded on ${new Date(mem.date).toLocaleDateString()}]: ${mem.note}\n`;
                });
                contextStr += `Use these details to recognize and personalize your interaction with them instantly. Do not call get_social_memory tool for this user, as it is already provided here.\n`;
            }

            if (session) {
                logInfo('SESSION', `${message.author.tag} online as ${session.charName} (ID: ${session.sectionId}, Ep: ${session.episode}, Diff: ${session.difficulty})`);
                contextStr += `\n### CURRENT GAMEPLAY CONTEXT (ONLINE NOW) ###\n`;
                contextStr += `The player is currently online and playing on the server!\n`;
                contextStr += `- Active Character: "${session.charName}"${session.charLevel ? ` (Level ${session.charLevel} ${session.charClass || ''})` : ''}\n`;
                if (session.sectionId) contextStr += `- Section ID: "${session.sectionId}"\n`;
                if (session.episode) contextStr += `- Current Episode: "${session.episode}"\n`;
                if (session.difficulty) contextStr += `- Current Difficulty: "${session.difficulty}"\n`;
                contextStr += `\n### DIRECTIVE FOR DROPS SEARCH ###\n`;
                contextStr += `Since the player is currently online, you MUST use their active gameplay parameters (Section ID: "${session.sectionId || 'None'}", Episode: "${session.episode || 'None'}", Difficulty: "${session.difficulty || 'None'}") as the starting point and default search filters when querying drop tables via the "search_drops" tool. ONLY override these defaults if the user explicitly specifies a different section ID, episode, difficulty, or asks a specific question about a specific item/monster drop rate in general.\n`;
            }

            userMsg = `${contextStr}\n${userMsg}`;

            let result = await chat.sendMessage(userMsg);
            let response = result.response;

            let toolIteration = 0;
            while (response.functionCalls() && toolIteration < 5) {
                toolIteration++;
                const toolResults = [];
                for (const call of response.functionCalls()) {
                    logInfo('TOOL', `${call.name}(${JSON.stringify(call.args)}) for ${message.author.tag}`);
                    // If this tool's feature was disabled by the startup health check,
                    // return an error the model relays to the user instead of calling
                    // a handler that hits a missing/broken website endpoint.
                    const gatedFeature = featureForTool(call.name);
                    let data;
                    if (gatedFeature && !isFeatureUp(gatedFeature)) {
                        data = toolDownResult(call.name);
                        logWarn('TOOL', `Skipped ${call.name} — feature "${gatedFeature}" disabled by failed health check.`);
                    } else {
                        const handler = toolHandlers[call.name];
                        data = handler ? await handler(call.args) : { error: "Tool not found" };
                        if (!handler) logWarn('TOOL', `Unknown tool requested: ${call.name}`);
                    }
                    toolResults.push({
                        functionResponse: {
                            name: call.name,
                            response: { content: data }
                        }
                    });
                }
                result = await chat.sendMessage(toolResults);
                response = result.response;
            }

            const responseText = response.text();
            const splitText = (text, maxLength) => {
                if (text.length <= maxLength) return [text];
                const chunks = [];
                let currentText = text;
                while (currentText.length > maxLength) {
                    let splitIndex = currentText.lastIndexOf('\n', maxLength);
                    if (splitIndex === -1) splitIndex = currentText.lastIndexOf(' ', maxLength);
                    if (splitIndex === -1) splitIndex = maxLength;
                    chunks.push(currentText.substring(0, splitIndex));
                    currentText = currentText.substring(splitIndex).trimStart();
                }
                chunks.push(currentText);
                return chunks;
            };

            if (responseText.length > 2000) {
                const chunks = splitText(responseText, 1950);
                for (const chunk of chunks) await message.reply(chunk);
            } else if (responseText.trim()) {
                await message.reply(responseText);
            }
        } catch (e) {
            console.error("[AI ERROR]", e.message);
            await message.reply("📡 **Communication Interrupted:** Pioneer 2's link is experiencing interference.");
        }
    });
}

module.exports = { registerMessageHandlers };
