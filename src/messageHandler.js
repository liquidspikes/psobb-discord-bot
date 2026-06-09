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
const { logInfo, logWarn } = require('./actionLog');
const { isFeatureUp, featureForTool, toolDownResult } = require('./healthcheck');
const commands = require('./commands');

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
            // Skip the tekker scanner when the feature is disabled (dependency
            // down) — otherwise every reaction spams failed tekker_db calls.
            if (isFeatureUp('tekker')) {
                const { trackActivity } = require('./tekkerChallenge');
                await trackActivity(user.id, reaction.message.guild, 'reaction');
            }
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
            // Skip the tekker scanner when the feature is disabled (dependency
            // down) — otherwise every chat message spams failed tekker_db calls.
            if (!message.content.startsWith('!') && !message.content.startsWith('/') && isFeatureUp('tekker')) {
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
            // Route every command through the central router. It returns true when
            // the message was consumed (handled, health-gated, or an unknown
            // command to ignore); false only for passthrough commands (!stats,
            // !quests, !progress, !progression) that continue into the AI flow.
            if (await commands.dispatch(message)) return;
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
