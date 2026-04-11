const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const axios = require('axios');

const config = JSON.parse(fs.readFileSync('/psobb-bot/discord_config.json', 'utf8'));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User],
});

const genAI = new GoogleGenerativeAI(config.gemini_api_key);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite", systemInstruction: config.system_prompt });

client.once(Events.ClientReady, (c) => {
    console.log("[READY] Bot is live: " + c.user.tag);
});

function getClearObjective(type, target) {
    switch (type) {
        case 'MESETA': return "Hold at least " + Number(target).toLocaleString() + " Meseta in inventory";
        case 'LEVEL': return "Reach Level " + target;
        case 'PLAYTIME': return "Accumulate " + Math.floor(Number(target) / 3600).toLocaleString() + " hours of playtime";
        case 'ITEM': return "Find and hold the item: " + target;
        case 'TECHNIQUE': return "Learn the technique: " + target;
        case 'BATTLE_WINS': return "Achieve " + target + " 1st place Battle Mode wins";
        case 'CHALLENGE_STAGES': return "Complete " + target + " Challenge Mode stages";
        case 'MAT_HP': return "Consume a total of " + target + " HP Materials";
        case 'MAT_TP': return "Consume a total of " + target + " TP Materials";
        case 'MAT_POWER': return "Consume a total of " + target + " Power Materials";
        case 'MAT_DEF': return "Consume a total of " + target + " Def Materials";
        case 'MAT_MIND': return "Consume a total of " + target + " Mind Materials";
        case 'MAT_EVADE': return "Consume a total of " + target + " Evade Materials";
        case 'MAT_LUCK': return "Consume a total of " + target + " Luck Materials";
        case 'EXPLORATION': return "Explore Location Floor: " + target;
        case 'BOSS_ARENA': return "Defeat the boss at Floor: " + target;
        default: return type + ": " + target;
    }
}

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
    console.log("[GATEKEEPER] MessageCreate event fired. Author: " + (message.author ? message.author.tag : "Unknown"));
    if (message.author && message.author.bot) return;

    if (message.partial) {
        try { await message.fetch(); } catch (e) { console.error("[PARTIAL ERROR]", e.message); return; }
    }

    const isDM = !message.guild;
    const isMentioned = message.mentions.has(client.user);
    const isCommand = message.content.startsWith('!');
    const isConfigChannel = message.channel.id === config.channel_id;

    // Accept messages from everyone if: it's a DM, they mention the bot, it's a command, or they are in the bot channel
    if (!isDM && !isMentioned && !isCommand && !isConfigChannel) return;

    console.log("[MSG] from " + message.author.tag + " in " + (isDM ? "DM" : "Guild") + ": " + message.content);

    // Commands
    if (message.content.startsWith('!link')) {
        return message.reply("🔗 **Secure Link Required:** Please link your Discord directly on your player dashboard at **https://psobb.io/login** instead!");
    }

    if (message.content.startsWith('!stats')) {
        const data = await getPlayerData(message.author.id);
        if (data && data.website_username) {
            const characters = data.Characters || [];
            let charInfo = characters.map(c => "🔹 **" + c.Name + "** (Lvl " + c.Level + " | EXP: " + (c.EXP || 0) + ")").join('\n') || 'No characters found online.';
            return message.reply("📊 **Hunter Profile: " + data.website_username + "**\n" + 
                                 "📅 Logins: " + (data.website_stats?.total_login_days || 0) + "\n\n" + charInfo);
        }
        return message.reply("❌ **Not Linked:** Visit https://psobb.io to link your Discord!");
    }
    
    if (message.content.startsWith('!bounties') || message.content.startsWith('!quest')) {
        const data = await getPlayerData(message.author.id);
        if (!data || data.error) return message.reply("❌ **Data Link Offline:** No player profile linked! Check the website.");
        
        const missions = Array.isArray(data.website_stats?.missions) ? data.website_stats.missions : [];
        const activeMissions = missions.filter(m => m.status === 'in_progress');
        
        let responseText = "🎯 **Hunters Guild Bounty Board for " + data.website_username + "**\n\n";
        if (activeMissions.length > 0) {
            responseText += "✅ **Active Bounties:**\n";
            activeMissions.forEach(m => {
                responseText += "🔹 **" + m.title + "**\n   *" + m.description + "*\n   Goal: `" + getClearObjective(m.goal_type, m.goal_target) + "`\n\n";
            });
        } else {
            responseText += "🔹 *No active bounties. Missions are assigned automatically or via Server Events!*\n\n";
        }
        return message.reply(responseText);
    }

    // Prevent AI from replying to unknown commands
    if (isCommand) return;

    // AI Chat
    try {
        if (message.channel.sendTyping) await message.channel.sendTyping().catch(() => {});
        const playerData = await getPlayerData(message.author.id);
        let prompt = message.content;
        if (playerData && !playerData.error) {
            prompt = "Context: Player is " + playerData.website_username + ". Message: " + message.content;
        }
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
        if (e.message.includes("safety") || e.message.includes("overload") || e.message.includes("503")) {
            await message.reply("📡 **Communication Interrupted:** Pioneer 2's link is busy or blocked.");
        }
    }
});

client.login(config.bot_token);
