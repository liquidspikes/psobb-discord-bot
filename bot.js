const { Client, GatewayIntentBits, Partials, ChannelType, Events } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const axios = require('axios');

const config = JSON.parse(fs.readFileSync('/psobb-bot/discord_config.json', 'utf8'));

const genAI = new GoogleGenerativeAI(config.gemini_api_key);
// VERIFIED 2026 MODEL
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    systemInstruction: config.system_prompt 
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User],
});

client.once(Events.ClientReady, (c) => {
    console.log(`[READY] Operational as ${c.user.tag}`);
});

async function getPlayerData(discordId) {
    try {
        const response = await axios.get(`${config.bot_api_url}?action=get_player&discord_id=${discordId}`, {
            headers: { 'Authorization': `Bearer ${config.bot_api_secret}` }
        });
        return response.data;
    } catch (error) {
        return null;
    }
}

async function handleMessage(channel, author, content, messageObj) {
    if (author.bot) return;
    if (author.id !== config.user_id) return;

    console.log(`[ACTION] Processing message from ${author.id}`);

    // Commands
    if (content.startsWith('!link')) {
        return messageObj.reply(`🔗 **Secure Link Required:** Please link your Discord directly on your player dashboard at **https://psobb.io/login** instead!`);
    }

    if (content.startsWith('!stats')) {
        const data = await getPlayerData(author.id);
        if (!data || data.error) {
            return messageObj.reply("❌ **Data Link Offline:** No player profile linked! Check the website.");
        }
        const characters = data.Characters || [];
        let charInfo = characters.map(c => `🔹 **${c.Name}** (Lvl ${c.Level} ${c.Class})`).join('\n') || 'No characters found.';
        return messageObj.reply(`📊 **Hunter Profile: ${data.website_username}**\n\n${charInfo}`);
    }

    // Default Chat
    try {
        await channel.sendTyping();
        const playerData = await getPlayerData(author.id);
        let prompt = content;
        if (playerData && !playerData.error) {
            prompt = `Context: User is player "${playerData.website_username}" with characters: ${JSON.stringify(playerData.Characters)}. Message: ${content}`;
        }

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        if (text.length > 2000) {
            const chunks = text.match(/[\s\S]{1,2000}/g) || [];
            for (const chunk of chunks) await messageObj.reply(chunk);
        } else {
            await messageObj.reply(text);
        }
    } catch (error) {
        console.error('[ERROR]', error);
    }
}

client.on(Events.MessageCreate, async (message) => {
    if (message.partial) await message.fetch().catch(() => {});
    if (message.channel.type === ChannelType.DM || !message.guild) {
        handleMessage(message.channel, message.author, message.content, message);
    }
});

// RAW Fallback for environments where messageCreate is suppressed for DMs
client.on('raw', async (packet) => {
    if (packet.t === 'MESSAGE_CREATE') {
        const data = packet.d;
        if (data.author.id === client.user.id || data.author.id !== config.user_id) return;

        setTimeout(async () => {
            const channel = await client.channels.fetch(data.channel_id).catch(() => null);
            if (!channel || (channel.lastMessageId === data.id && channel.lastMessage?.author.id === client.user.id)) return;
            handleMessage(channel, data.author, data.content, channel);
        }, 1000);
    }
});

client.login(config.bot_token);
