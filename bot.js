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
        GatewayIntentBits.GuildMessages,
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

    console.log(`[ACTION] Processing message from ${author.id} (${author.username})`);

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
        let charInfo = characters.map(c => `🔹 **${c.Name}** (Lvl ${c.Level} ${c.Class}) - ${c.Meseta} Meseta | Playtime: ${c.PlayTimeSeconds}s`).join('\n') || 'No characters found online.';
        
        const loginDays = data.website_stats?.total_login_days || 0;
        const missions = data.website_stats?.missions || [];
        const missionInfo = missions.length ? '\n📜 **Missions:** ' + missions.map(m => `${m.title} (${m.status})`).join(', ') : '';
        
        return messageObj.reply(`📊 **Hunter Profile: ${data.website_username}**\n🟢 Online: ${data.is_online ? 'Yes' : 'No'}\n📅 Logins: ${loginDays}${missionInfo}\n\n${charInfo}`);
    }

    // Default Chat
    try {
        if (typeof channel.sendTyping === 'function') {
            await channel.sendTyping();
        }
        
        const playerData = await getPlayerData(author.id);
        const cleanContent = content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
        if (!cleanContent) return;

        let prompt = cleanContent;
        if (playerData && !playerData.error) {
            prompt = `Context: User is player "${playerData.website_username}". Currently online: ${playerData.is_online}. Total login days: ${playerData.website_stats?.total_login_days || 0}. Missions: ${JSON.stringify(playerData.website_stats?.missions || [])}. Characters: ${JSON.stringify(playerData.Characters)}. Message from user: ${cleanContent}`;
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
    if (message.author.bot) return;

    const isDM = message.channel.type === ChannelType.DM || !message.guild;
    const isMentioned = message.mentions.has(client.user) && !message.mentions.everyone;

    if (isDM || isMentioned) {
        handleMessage(message.channel, message.author, message.content, message);
    }
client.login(config.bot_token);
