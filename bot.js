const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const axios = require('axios');

const config = JSON.parse(fs.readFileSync('/psobb-bot/discord_config.json', 'utf8'));

const client = new Client({
    intents: 3276799,
    partials: Object.values(Partials).filter(x => typeof x === 'number'),
});

let fullPrompt = config.system_prompt;
try {
    if (fs.existsSync('/psobb-bot/knowledge.md')) {
        const knowledge = fs.readFileSync('/psobb-bot/knowledge.md', 'utf8');
        fullPrompt += "\n\n### REFERENCE KNOWLEDGE BASE ###\n" + knowledge;
    }
} catch (e) {
    console.error("Error reading knowledge.md:", e.message);
}

const genAI = new GoogleGenerativeAI(config.gemini_api_key);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite", systemInstruction: fullPrompt });

client.once(Events.ClientReady, (c) => {
    console.log("[READY] Bot is live: " + c.user.tag);
    console.log("[READY] Intents bitfield: " + c.options.intents);
});

const handledMessages = new Set();

client.on('raw', async packet => {
    if (packet.t === 'MESSAGE_CREATE') {
        console.log("[RAW EVENT] MESSAGE_CREATE from " + packet.d.author.id + " in channel " + packet.d.channel_id);
        
        if (!packet.d.guild_id) {
            try {
                const channel = await client.channels.fetch(packet.d.channel_id);
                const message = await channel.messages.fetch(packet.d.id);
                
                if (message && !handledMessages.has(message.id)) {
                    client.emit(Events.MessageCreate, message);
                }
            } catch (e) {
                console.error("[RAW RECOVERY ERROR]", e.message);
            }
        }
    }
});

async function getPlayerData(discordId) {
    try {
        const url = config.psobb_api_url + "&action=get_player&discord_id=" + discordId;
        const resp = await axios.get(url, {
            headers: { 'Authorization': "Bearer " + config.psobb_api_secret },
            timeout: 5000
        });
        return resp.data;
    } catch (e) {
        console.error("[API ERROR] " + e.message);
        return null;
    }
}

client.on(Events.MessageCreate, async (message) => {
    if (!message || handledMessages.has(message.id)) return;
    handledMessages.add(message.id);
    if (handledMessages.size > 1000) handledMessages.clear();

    console.log("[GATEKEEPER] Received message from: " + (message.author ? message.author.tag : "UNKNOWN"));
    
    if (message.author && message.author.bot) return;

    if (message.partial) {
        console.log("[DEBUG] Message is partial, fetching...");
        try { await message.fetch(); } catch (e) { console.error("[PARTIAL ERROR]", e.message); return; }
    }

    const isDM = !message.guild;
    const isMentioned = message.mentions.has(client.user);
    const isCommand = message.content.startsWith('!');
    const isConfigChannel = message.channel.id === config.channel_id;

    console.log("[DEBUG] isDM: " + isDM + " | isMentioned: " + isMentioned + " | isCommand: " + isCommand + " | isConfigChannel: " + isConfigChannel);

    if (!isDM && !isMentioned && !isCommand && !isConfigChannel) {
        console.log("[DEBUG] Ignoring message - did not meet criteria.");
        return;
    }

    console.log("[MSG] Content: " + message.content);

    if (message.content.startsWith('!stats')) {
        const data = await getPlayerData(message.author.id);
        if (data && data.website_username) {
            const characters = data.Characters || [];
            let charInfo = characters.map(c => "🔹 **" + c.Name + "** (Lvl " + c.Level + " | EXP: " + (c.EXP || 0) + ")").join('\n') || 'No characters found online.';
            return message.reply("📊 **Hunter Profile: " + data.website_username + "**\n📅 Logins: " + (data.website_stats?.total_login_days || 0) + "\n\n" + charInfo);
        }
        return message.reply("❌ **Not Linked:** Visit https://psobb.io to link your Discord!");
    }

    if (isCommand) return; // Only process AI chat if it's not a known command
    // AI Chat
    try {
        if (message.channel.sendTyping) await message.channel.sendTyping().catch(() => {});
        const playerData = await getPlayerData(message.author.id);

        const rawHistory = await message.channel.messages.fetch({ limit: 12 });
        const historyMsgs = Array.from(rawHistory.values()).reverse().filter(m => m.id !== message.id && !m.content.startsWith('!'));

        let prompt = "";
        if (playerData && !playerData.error) {
            prompt += "Context: You are talking to player " + playerData.website_username + ".\n\n";
        }

        if (historyMsgs.length > 0) {
            prompt += "Recent Conversation History:\n";
            for (const msg of historyMsgs) {
                prompt += `[${msg.author.username === client.user.username ? 'Mission Command' : msg.author.username}]: ${msg.content}\n`;
            }
            prompt += "\n";
        }
        
        prompt += `[${message.author.username}]: ${message.content}\n[Mission Command]: `;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        if (responseText.length > 2000) {
            const chunks = responseText.match(/[\s\S]{1,2000}/g) || [];
            for (const chunk of chunks) await message.reply(chunk);
        } else {
            await message.reply(responseText);
        }
    } catch (e) {
        console.error("[AI ERROR]", e.message);
        await message.reply("📡 **Communication Interrupted:** Pioneer 2's link is busy or blocked.");
    }
});

client.login(config.bot_token);
