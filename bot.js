const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const config = JSON.parse(fs.readFileSync('/psobb-bot/discord_config.json', 'utf8'));
const MEMORY_DIR = '/psobb-bot/memory';

const client = new Client({
    intents: 3276799,
    partials: Object.values(Partials).filter(x => typeof x === 'number'),
});

// Build Knowledge Base
let knowledgeBase = "";
const ragPath = '/psobb-bot/rag';
const mainKnowledgePath = '/psobb-bot/knowledge.md';

if (fs.existsSync(mainKnowledgePath)) {
    knowledgeBase += "=== CORE LORE & SERVER KNOWLEDGE ===\n";
    knowledgeBase += fs.readFileSync(mainKnowledgePath, 'utf8') + "\n\n";
}

try {
    if (fs.existsSync(ragPath)) {
        const files = fs.readdirSync(ragPath);
        knowledgeBase += "=== TECHNICAL DATA & DEEP DIVES ===\n";
        files.forEach(file => {
            if (file.endsWith('.md')) {
                const content = fs.readFileSync(`${ragPath}/${file}`, 'utf8');
                knowledgeBase += `\n--- SOURCE: ${file} ---\n${content}\n`;
            }
        });
        console.log(`[INIT] Loaded RAG content from ${files.length} files.`);
    }
} catch (e) {
    console.error("Error reading RAG directory:", e.message);
}

// Social Memory Helpers
function getMemoryPath(username) {
    const safeName = username.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return path.join(MEMORY_DIR, `${safeName}.json`);
}

function loadSocialMemory(username) {
    try {
        const memPath = getMemoryPath(username);
        if (fs.existsSync(memPath)) {
            return JSON.parse(fs.readFileSync(memPath, 'utf8'));
        }
    } catch (e) { console.error(`Memory load error for ${username}:`, e.message); }
    return [];
}

function saveSocialMemory(username, memoryArray) {
    try {
        const memPath = getMemoryPath(username);
        fs.writeFileSync(memPath, JSON.stringify(memoryArray, null, 2));
    } catch (e) { console.error(`Memory save error for ${username}:`, e.message); }
}

const genAI = new GoogleGenerativeAI(config.gemini_api_key);

// Tool Definitions
const tools = [
    {
        functionDeclarations: [
            {
                name: "get_player_info",
                description: "Retrieves detailed information about a player, including their characters, level, class, online status, team, and mission progress. Pass either a discord_id or a website username.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        discord_id: { type: "STRING", description: "The Discord ID of the player." },
                        username: { type: "STRING", description: "The website username of the player." }
                    }
                }
            },
            {
                name: "get_online_players",
                description: "Returns a list of all players currently connected to the server.",
            },
            {
                name: "get_server_events",
                description: "Returns a list of active community events and their progress.",
            },
            {
                name: "fetch_website_content",
                description: "Reads the text content of a specific page on the psobb.io website. Use this to look up rules, news, guides, or detailed mission/mod lists. Path should start with / (e.g., /about.php, /missions.php).",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        path: { type: "STRING", description: "The relative path of the page to fetch." }
                    },
                    required: ["path"]
                }
            },
            {
                name: "update_social_memory",
                description: "Updates the bot's long-term memory about a player or relationship. Use this to record friends, rivals, or personal notes.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        username: { type: "STRING", description: "The username the note is about." },
                        note: { type: "STRING", description: "The information to remember (e.g., 'Friends with user X', 'Obsessed with finding Sealed J-Sword')." }
                    },
                    required: ["username", "note"]
                }
            },
            {
                name: "get_social_memory",
                description: "Retrieves the bot's stored social notes about a specific user.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        username: { type: "STRING", description: "The username to look up." }
                    },
                    required: ["username"]
                }
            },
            {
                name: "get_active_vote_status",
                description: "Retrieves the current Mission Control Discord vote status (the options and the live tally of emoji reactions). Use this when players ask about the upcoming event or the current vote.",
            }
        ]
    }
];

const model = genAI.getGenerativeModel({ 
    model: "gemini-3.1-flash-lite-preview", 
    systemInstruction: config.system_prompt + "\n\n### STRATEGIC DIRECTIVE ###\nPrioritize local data from the KNOWLEDGE BASE and provided tools. Use get_player_info to check levels—be KIND to new players (Lvl 1-20), and SASSY to veterans (Lvl 100+). Use social memory tools to track and recall dynamics. Use get_active_vote_status to check the current Mission Control event vote tallies.\n\n### KNOWLEDGE BASE ###\n" + knowledgeBase,
    tools: tools
});

async function apiCall(action, params = {}) {
    try {
        let url = config.psobb_api_url + "&action=" + action;
        for (const [key, val] of Object.entries(params)) {
            if (val) url += `&${key}=${encodeURIComponent(val)}`;
        }
        const resp = await axios.get(url, {
            headers: { 'Authorization': "Bearer " + config.psobb_api_secret },
            timeout: 5000
        });
        return resp.data;
    } catch (e) {
        console.error(`[API ERROR] ${action}: ${e.message}`);
        return { error: "Service unavailable" };
    }
}

const toolHandlers = {
    get_player_info: async (args) => await apiCall("get_player", args),
    get_online_players: async () => await apiCall("get_online_players"),
    get_server_events: async () => await apiCall("get_events"),
    fetch_website_content: async (args) => {
        try {
            const path = args.path.startsWith('/') ? args.path : '/' + args.path;
            const url = "https://psobb.io" + path;
            const resp = await axios.get(url, { timeout: 10000 });
            let text = resp.data.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "");
            text = text.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, "");
            text = text.replace(/<[^>]*>?/gm, ' ');
            text = text.replace(/\s+/g, ' ').trim();
            return text.substring(0, 8000);
        } catch (e) { return { error: "Failed to read website: " + e.message }; }
    },
    update_social_memory: async (args) => {
        const memoryArray = loadSocialMemory(args.username);
        memoryArray.push({ date: new Date().toISOString(), note: args.note });
        if (memoryArray.length > 20) memoryArray.shift(); // Keep last 20 notes per user
        saveSocialMemory(args.username, memoryArray);
        return { success: true, message: `Recorded note for ${args.username}` };
    },
    get_social_memory: async (args) => {
        const memoryArray = loadSocialMemory(args.username);
        if (memoryArray.length === 0) return { info: "No prior social notes found for this user." };
        return memoryArray;
    },
    get_active_vote_status: async () => {
        try {
            const voteFile = '/home/alexzimmerman/gemini-psobb-scripts/current_vote.json';
            if (!fs.existsSync(voteFile)) return { error: "No active vote found." };
            
            const voteData = JSON.parse(fs.readFileSync(voteFile, 'utf8'));
            const channelId = config.channel_id;
            const messageId = voteData.message_id;
            
            const channel = await client.channels.fetch(channelId);
            if (!channel) return { error: "Could not access the voting channel." };
            
            const targetMessage = await channel.messages.fetch(messageId);
            if (!targetMessage) return { error: "Could not find the voting message." };
            
            const tally = {};
            targetMessage.reactions.cache.forEach(reaction => {
                tally[reaction.emoji.name] = reaction.count;
            });
            
            return {
                event_date: voteData.date,
                candidates: voteData.candidates,
                current_votes: tally
            };
        } catch (e) {
            return { error: "Failed to fetch vote status: " + e.message };
        }
    }
};

client.on("raw", async packet => {
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

client.once(Events.ClientReady, (c) => {
    console.log("[READY] Bot is live: " + c.user.tag);
});

const handledMessages = new Set();

client.on(Events.MessageCreate, async (message) => {
    if (!message || handledMessages.has(message.id)) return;
    handledMessages.add(message.id);
    if (handledMessages.size > 1000) handledMessages.clear();

    if (message.author && message.author.bot) return;

    const isDM = !message.guild;
    const isMentioned = message.mentions.has(client.user);
    const isCommand = message.content.startsWith('!');
    const isConfigChannel = message.channel.id === config.channel_id;

    if (!isDM && !isMentioned && !isCommand && !isConfigChannel) return;
    if (isCommand && !message.content.startsWith('!stats')) return;

    console.log("[MSG] From: " + message.author.tag + " | Content: " + message.content);

    try {
        if (message.channel.sendTyping) await message.channel.sendTyping().catch(() => {});

        const rawHistory = await message.channel.messages.fetch({ limit: 12 });
        const historyMsgs = Array.from(rawHistory.values()).reverse().filter(m => m.id !== message.id && !m.content.startsWith('!'));

        let historyForAI = [];
        for (const msg of historyMsgs) {
            historyForAI.push({
                role: msg.author.id === client.user.id ? 'model' : 'user',
                parts: [{ text: `[${msg.author.username}]: ${msg.content}` }]
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
                validHistory[validHistory.length - 1].parts[0].text += "\\n" + h.parts[0].text;
            } else {
                validHistory.push(h);
            }
        }

        const chat = model.startChat({ history: validHistory });

        let userMsg = message.content;
        
        let contextStr = "";
        contextStr += `(Current real-world time: ${new Date().toLocaleString()}.)`;
        
        userMsg = `${contextStr}\n${userMsg}`;

        let result = await chat.sendMessage(userMsg);
        let response = result.response;

        let toolIteration = 0;
        while (response.functionCalls() && toolIteration < 5) {
            toolIteration++;
            const toolResults = [];
            for (const call of response.functionCalls()) {
                console.log(`[TOOL] Calling ${call.name} with ${JSON.stringify(call.args)}`);
                const handler = toolHandlers[call.name];
                const data = handler ? await handler(call.args) : { error: "Tool not found" };
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
        if (responseText.length > 2000) {
            const chunks = responseText.match(/[\s\S]{1,2000}/g) || [];
            for (const chunk of chunks) await message.reply(chunk);
        } else if (responseText.trim()) {
            await message.reply(responseText);
        }
    } catch (e) {
        console.error("[AI ERROR]", e.message);
        await message.reply("📡 **Communication Interrupted:** Pioneer 2's link is experiencing interference.");
    }
});

client.login(config.bot_token);