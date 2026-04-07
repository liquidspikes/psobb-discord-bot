const { Client, GatewayIntentBits, Partials, ChannelType, Events } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const axios = require('axios');

const config = JSON.parse(fs.readFileSync('/psobb-bot/discord_config.json', 'utf8'));

const genAI = new GoogleGenerativeAI(config.gemini_api_key);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
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

async function linkAccount(discordId, username) {
    try {
        const params = new URLSearchParams();
        params.append('username', username);
        params.append('discord_id', discordId);
        
        const response = await axios.post(`${config.bot_api_url}?action=link`, params, {
            headers: { 'Authorization': `Bearer ${config.bot_api_secret}` }
        });
        return response.data;
    } catch (error) {
        return { error: 'API connection failed' };
    }
}

async function handleMessage(channel, author, content, messageObj) {
    if (author.bot) return;

    // Command: !link <username>
    if (content.startsWith('!link ')) {
        const username = content.split(' ')[1];
        const result = await linkAccount(author.id, username);
        if (result.success) {
            return messageObj.reply(`✅ **Pioneer 2 Uplink Established!** Your Discord ID is now linked to Hunter account: **${username}**.`);
        } else {
            return messageObj.reply(`❌ **Link Failed:** ${result.error || 'Check your website username and try again.'}`);
        }
    }

    // Command: !stats
    if (content.startsWith('!stats')) {
        const data = await getPlayerData(author.id);
        if (!data || data.error) {
            return messageObj.reply("❌ **Data Link Offline:** I don't have a player profile linked to your Discord. Use `!link <username>` first!");
        }
        
        const characters = data.Characters || [];
        let charInfo = characters.map(c => `🔹 **${c.Name}** (Lvl ${c.Level} ${c.Class})`).join('\n') || 'No characters found.';
        
        return messageObj.reply(`📊 **Hunter Profile: ${data.website_username}**\n\n${charInfo}\n\n*Keep pushing, Hunter! Your progress is being monitored from orbit.*`);
    }

    // Default: Gemini Chat
    try {
        await channel.sendTyping();
        
        // Fetch context if linked
        const playerData = await getPlayerData(author.id);
        let contextualPrompt = content;
        if (playerData && !playerData.error) {
            contextualPrompt = `Context: The user is Phantasy Star Online player "${playerData.website_username}". ` +
                               `Their characters are: ${JSON.stringify(playerData.Characters)}. ` +
                               `User Message: ${content}`;
        }

        const result = await model.generateContent(contextualPrompt);
        const response = await result.response;
        const text = response.text();

        if (text.length > 2000) {
            const chunks = text.match(/[\s\S]{1,2000}/g) || [];
            for (const chunk of chunks) {
                await messageObj.reply(chunk);
            }
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

client.login(config.bot_token);
