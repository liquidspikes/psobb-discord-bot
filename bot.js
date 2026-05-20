const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const config = JSON.parse(fs.readFileSync('/psobb-bot/discord_config.json', 'utf8'));
const MEMORY_DIR = '/psobb-bot/memory';

// Drops Cache Variables & Helper
let cachedDrops = null;
let lastDropsFetch = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

async function getDropsData() {
    const now = Date.now();
    if (cachedDrops && (now - lastDropsFetch < CACHE_DURATION)) {
        return cachedDrops;
    }
    console.log("[DROPS] Fetching fresh drop data from server...");
    const url = "https://psobb.io/api/get_drops.php";
    const resp = await axios.get(url, { timeout: 15000 });
    if (resp.data && resp.data.success && resp.data.data) {
        cachedDrops = resp.data.data;
        lastDropsFetch = now;
        return cachedDrops;
    }
    if (cachedDrops) {
        console.warn("[DROPS] Fetch failed, using expired cache");
        return cachedDrops;
    }
    throw new Error("Failed to load drop data from server");
}

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
function getMemoryPath(discordId) {
    const safeId = discordId.replace(/[^0-9]/g, '');
    return path.join(MEMORY_DIR, `${safeId}.json`);
}

function loadSocialMemory(discordId) {
    try {
        const memPath = getMemoryPath(discordId);
        if (fs.existsSync(memPath)) {
            return JSON.parse(fs.readFileSync(memPath, 'utf8'));
        }
    } catch (e) { console.error(`Memory load error for ID ${discordId}:`, e.message); }
    return [];
}

function saveSocialMemory(discordId, memoryArray) {
    try {
        const memPath = getMemoryPath(discordId);
        fs.writeFileSync(memPath, JSON.stringify(memoryArray, null, 2));
    } catch (e) { console.error(`Memory save error for ID ${discordId}:`, e.message); }
}

const genAI = new GoogleGenerativeAI(config.gemini_api_key);

// Tool Definitions
const tools = [
    {
        functionDeclarations: [
            {
                name: "get_player_info",
                description: "Retrieves detailed information about a player, including their characters, level, class, online status, team, and mission progress. Pass the Discord ID of the player.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        discord_id: { type: "STRING", description: "The Discord ID of the player." }
                    },
                    required: ["discord_id"]
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
                        discord_id: { type: "STRING", description: "The Discord ID of the player the note is about." },
                        note: { type: "STRING", description: "The information to remember (e.g., 'Friends with user X', 'Obsessed with finding Sealed J-Sword')." }
                    },
                    required: ["discord_id", "note"]
                }
            },
            {
                name: "get_social_memory",
                description: "Retrieves the bot's stored social notes about a specific user by their Discord ID.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        discord_id: { type: "STRING", description: "The Discord ID of the user to look up." }
                    },
                    required: ["discord_id"]
                }
            },
            {
                name: "get_active_vote_status",
                description: "Retrieves the current Mission Control Discord vote status (the options and the live tally of emoji reactions). Use this when players ask about the upcoming event or the current vote.",
            },
            {
                name: "get_decryption_status",
                description: "Retrieves the live Agent Decryption Matrix status from the server, including current decryption percent progress, active AI model, current status phase, and estimated time remaining (ETA).",
            },
            {
                name: "search_drops",
                description: "Searches the PSOBB server drop tables for specific items or drops based on user criteria. You can search by item name, monster name, difficulty, section ID, and/or episode.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        item: { type: "STRING", description: "The name of the item to search for (case-insensitive substring, e.g. 'Red Coat', 'Sealed J-Sword')." },
                        monster: { type: "STRING", description: "Filter drops by specific monster name (case-insensitive substring, e.g. 'Desert2 Box', 'Astark')." },
                        difficulty: { type: "STRING", description: "Filter by game difficulty: 'Normal', 'Hard', 'Very Hard', 'Ultimate'." },
                        section_id: { type: "STRING", description: "Filter by player Section ID: 'Viridia', 'Greenill', 'Skyly', 'Bluefull', 'Purplenum', 'Pinkal', 'Redria', 'Oran', 'Yellowboze', 'Whitill'." },
                        episode: { type: "STRING", description: "Filter by Episode: '1', '2', '4'." }
                    }
                }
            },
            {
                name: "get_server_stats",
                description: "Retrieves live server telemetry from psobb.io, including server name, uptime, online client count, active games count, global experience multiplier, server global drop rate multiplier, lists of online players (with name, level, class, and Section ID), and lists of active games (with name, mode, episode, difficulty, player count, and password status)."
            }
        ]
    }
];

const model = genAI.getGenerativeModel({ 
    model: "gemini-3.1-flash-lite-preview", 
    systemInstruction: config.system_prompt + "\n\n### STRATEGIC DIRECTIVE ###\nPrioritize local data from the KNOWLEDGE BASE and provided tools. Use get_player_info to check levels—be KIND to new players (Lvl 1-20), and SASSY to veterans (Lvl 100+). You MUST use the update_social_memory tool to record any new facts, preferences, or relationships about a player whenever they interact with you. Use get_active_vote_status to check the current Mission Control event vote tallies. NEVER say the bounty system doesn't exist; ALWAYS use fetch_website_content with path '/missions.php' to check active bounties and missions. Use get_decryption_status when players ask about server decryption progress, solved percentage, or remaining time. Use get_server_stats to retrieve live server stats, uptime, current online player counts, active games, and global EXP/drop rates. Use search_drops to query item or monster drop tables with appropriate filters—never guess or hallucinate drop rates. Inform players about newserv in-game commands ($li, $gc, /alt, /lobby, etc.) if they ask.\n\n### KNOWLEDGE BASE ###\n" + knowledgeBase,
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
        const memoryArray = loadSocialMemory(args.discord_id);
        memoryArray.push({ date: new Date().toISOString(), note: args.note });
        if (memoryArray.length > 20) memoryArray.shift(); // Keep last 20 notes per user
        saveSocialMemory(args.discord_id, memoryArray);
        return { success: true, message: `Recorded note for ID ${args.discord_id}` };
    },
    get_social_memory: async (args) => {
        const memoryArray = loadSocialMemory(args.discord_id);
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
    },
    get_decryption_status: async () => {
        try {
            const url = "https://psobb.io/api/agent_state.json";
            const resp = await axios.get(url, { timeout: 10000 });
            const state = resp.data;
            
            // Calculate solved percentage
            let unknownFnsCount = parseInt(String(state.unknown_fns).replace(/,/g, ''));
            let totalFnsCount = parseInt(String(state.total_fns || "19362").replace(/,/g, ''));
            
            let unknownVarsCount = parseInt(String(state.unknown_vars).replace(/,/g, ''));
            let totalVarsCount = parseInt(String(state.total_vars || "0").replace(/,/g, ''));
            
            let percentStr = "0.00%";
            if (!isNaN(unknownFnsCount) && !isNaN(totalFnsCount) && totalFnsCount > 0) {
                let solvedFns = Math.max(0, totalFnsCount - unknownFnsCount);
                let solvedVars = 0;
                let totalItems = totalFnsCount;
                
                if (!isNaN(unknownVarsCount) && !isNaN(totalVarsCount) && totalVarsCount > 0) {
                    solvedVars = Math.max(0, totalVarsCount - unknownVarsCount);
                    totalItems += totalVarsCount;
                }
                
                let totalSolved = solvedFns + solvedVars;
                let percent = Math.min(100, Math.max(0, (totalSolved / totalItems) * 100));
                percentStr = percent.toFixed(2) + "%";
            }
            
            return {
                status: state.status,
                model: state.model,
                eta: state.eta || "Calculating...",
                percent_solved: percentStr,
                unknown_functions: state.unknown_fns,
                total_functions: state.total_fns,
                unknown_variables: state.unknown_vars,
                total_variables: state.total_vars,
                pipeline_phase: state.pipeline_phase,
                recompiler_status: state.recompiler_status,
                recompiler_attempts: state.recompiler_attempts,
                compile_errors: state.compile_errors,
                total_mods_all_time: state.total_mods_all_time,
                recent_impacts: state.modifications ? state.modifications.slice(0, 5) : []
            };
        } catch (e) {
            return { error: "Failed to read decryption status: " + e.message };
        }
    },
    search_drops: async (args) => {
        try {
            const data = await getDropsData();
            
            // Filter drops dynamically
            const filtered = data.filter(drop => {
                // Item filter
                if (args.item) {
                    const itemTerm = args.item.toLowerCase();
                    if (!drop.item || !drop.item.toLowerCase().includes(itemTerm)) return false;
                }
                // Monster filter
                if (args.monster) {
                    const monsterTerm = args.monster.toLowerCase();
                    if (!drop.monster || !drop.monster.toLowerCase().includes(monsterTerm)) return false;
                }
                // Difficulty filter
                if (args.difficulty) {
                    if (drop.difficulty !== args.difficulty) return false;
                }
                // Section ID filter
                if (args.section_id) {
                    if (drop.section_id.toLowerCase() !== args.section_id.toLowerCase()) return false;
                }
                // Episode filter
                if (args.episode) {
                    if (drop.episode.toString() !== args.episode.toString()) return false;
                }
                return true;
            });
            
            // Limit results to 40 items to avoid overwhelming Gemini context
            const limit = 40;
            const results = filtered.slice(0, limit);
            
            return {
                results: results,
                total_matches: filtered.length,
                limit_reached: filtered.length > limit,
                limit: limit
            };
        } catch (e) {
            return { error: "Failed to search drop charts: " + e.message };
        }
    },
    get_server_stats: async () => {
        try {
            const url = "https://psobb.io/api/summary";
            const resp = await axios.get(url, { timeout: 10000 });
            const data = resp.data || {};
            
            const server = data.Server || {};
            const clients = (data.Clients || []).map(c => ({
                name: c.Name || "Unknown",
                level: c.Level || 1,
                class: c.Class || "Unknown",
                section_id: c.SectionID || "Unknown"
            }));
            const games = (data.Games || []).map(g => ({
                name: g.Name || "Unnamed Lobby",
                mode: g.Mode || "Normal",
                episode: g.Episode || "Episode 1",
                difficulty: g.Difficulty || "Normal",
                players: g.Players || 1,
                has_password: !!g.HasPassword
            }));

            return {
                server_name: server.ServerName || "psobb.io",
                uptime: server.Uptime || "Unknown",
                client_count: server.ClientCount || 0,
                game_count: server.GameCount || 0,
                exp_multiplier: server.BBGlobalEXPMultiplier || 1,
                drop_multiplier: server.ServerGlobalDropRateMultiplier || 1,
                online_players: clients,
                active_games: games
            };
        } catch (e) {
            return { error: "Failed to fetch live server stats: " + e.message };
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

function extractActiveSession(playerInfo) {
    if (!playerInfo || !playerInfo.is_online) return null;
    
    // Check if there is an explicit session object
    const session = playerInfo.session || playerInfo.online_session || {};
    
    // Extract difficulty and episode
    let difficulty = session.difficulty || session.Difficulty || playerInfo.difficulty || playerInfo.Difficulty || null;
    let episode = session.episode || session.Episode || playerInfo.episode || playerInfo.Episode || null;
    
    // Extract character details
    let activeChar = null;
    const chars = playerInfo.Characters || playerInfo.characters || [];
    
    // Try matching by LastPlayerName
    const lastPlayerName = playerInfo.LastPlayerName || playerInfo.last_player_name || session.character_name || session.CharacterName;
    if (lastPlayerName && chars.length > 0) {
        activeChar = chars.find(c => {
            const cName = c.name || c.Name || c.character_name || c.CharacterName;
            return cName && cName.toLowerCase() === lastPlayerName.toLowerCase();
        });
    }
    
    // If not found, try finding one marked active, or default to the first character
    if (!activeChar && chars.length > 0) {
        activeChar = chars.find(c => c.is_active || c.isActive || c.active || c.Active) || chars[0];
    }
    
    // Extract section ID from active character or session or root
    let sectionId = null;
    if (activeChar) {
        sectionId = activeChar.section_id || activeChar.SectionID || activeChar.sectionId || activeChar.Section_ID || activeChar.section || activeChar.Section;
    }
    if (!sectionId) {
        sectionId = session.section_id || session.SectionID || session.sectionId || playerInfo.section_id || playerInfo.SectionID || playerInfo.sectionId;
    }
    
    // Extract other char info
    const charName = activeChar ? (activeChar.name || activeChar.Name) : lastPlayerName;
    const charClass = activeChar ? (activeChar.class || activeChar.Class) : null;
    const charLevel = activeChar ? (activeChar.level || activeChar.Level) : null;
    
    // Normalize Section ID
    if (sectionId && typeof sectionId === 'string') {
        sectionId = sectionId.charAt(0).toUpperCase() + sectionId.slice(1).toLowerCase();
        const validSectionIds = ['Viridia', 'Greenill', 'Skyly', 'Bluefull', 'Purplenum', 'Pinkal', 'Redria', 'Oran', 'Yellowboze', 'Whitill'];
        if (!validSectionIds.includes(sectionId)) {
            sectionId = null;
        }
    } else if (sectionId !== null && sectionId !== undefined) {
        const sectionIdMap = {
            0: 'Viridia', 1: 'Greenill', 2: 'Skyly', 3: 'Bluefull', 4: 'Purplenum',
            5: 'Pinkal', 6: 'Redria', 7: 'Oran', 8: 'Yellowboze', 9: 'Whitill'
        };
        sectionId = sectionIdMap[sectionId] || null;
    }
    
    // Normalize Difficulty
    if (difficulty && typeof difficulty === 'string') {
        difficulty = difficulty.charAt(0).toUpperCase() + difficulty.slice(1).toLowerCase();
        if (difficulty === 'Vhard' || difficulty === 'Veryhard') difficulty = 'Very Hard';
        const validDiffs = ['Normal', 'Hard', 'Very Hard', 'Ultimate'];
        if (!validDiffs.includes(difficulty)) {
            difficulty = null;
        }
    } else if (difficulty !== null && difficulty !== undefined) {
        const diffMap = { 0: 'Normal', 1: 'Hard', 2: 'Very Hard', 3: 'Ultimate' };
        difficulty = diffMap[difficulty] || null;
    }
    
    // Normalize Episode
    if (episode !== null && episode !== undefined) {
        const epStr = String(episode).replace(/[^0-9]/g, '');
        if (['1', '2', '4'].includes(epStr)) {
            episode = epStr;
        } else {
            episode = null;
        }
    }
    
    return {
        is_online: true,
        difficulty,
        episode,
        sectionId,
        charName,
        charClass,
        charLevel
    };
}

async function getCurrentPlayerSession(discordId) {
    try {
        const playerInfo = await apiCall("get_player", { discord_id: discordId });
        if (playerInfo && playerInfo.is_online) {
            return extractActiveSession(playerInfo);
        }
    } catch (e) {
        console.error("[SESSION CHECK ERROR]", e.message);
    }
    return null;
}

const handledMessages = new Set();

client.on(Events.MessageCreate, async (message) => {
    if (!message || message.system || handledMessages.has(message.id)) return;
    handledMessages.add(message.id);
    if (handledMessages.size > 1000) handledMessages.clear();

    if (message.author && message.author.bot) return;

    const isDM = !message.guild;
    const isMentioned = message.mentions.has(client.user);
    const isCommand = message.content.startsWith('!');
    const isConfigChannel = message.channel.id === config.channel_id;

    if (!isDM && !isMentioned && !isCommand && !isConfigChannel) return;
    if (isCommand) {
        if (message.content.startsWith('!quest') || message.content.startsWith('$quest')) {
            return await message.reply("📡 **Notice:** The manual `!quest` command has been deprecated. Mission Command now monitors your progress automatically! You will receive random bounties directly to your Guild Card while playing on the server.");
        }
        if (!message.content.startsWith('!stats')) return;
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
            console.log(`[DROPS-DETECTED] User ${message.author.tag} asked about drops. Fetching online status...`);
            session = await getCurrentPlayerSession(message.author.id);
        }

        const socialMemory = loadSocialMemory(message.author.id);

        let contextStr = "";
        contextStr += `(Current real-world time: ${new Date().toLocaleString()}.)\n`;
        contextStr += `(Active User details - Discord Username: "${message.author.username}", Discord ID: "${message.author.id}")\n`;
        contextStr += `(To look up this user's character stats, missions, or online status, you MUST call get_player_info with discord_id: "${message.author.id}". Do not attempt to search by username, as the server API requires a discord_id.)\n`;
        contextStr += `(CRITICAL DIRECTIVE: NEVER reveal or output the user's Discord ID in your responses under any circumstances. It is an internal identifier. If the user asks for their card, stats, or account details, only report their Guild Card ID, which is the "account_id" returned by get_player_info.)\n`;
        
        if (socialMemory && socialMemory.length > 0) {
            contextStr += `\n### PRIOR SOCIAL MEMORY (INSTANT RECALL) ###\n`;
            contextStr += `You have the following stored memories and observations about this Hunter:\n`;
            socialMemory.forEach(mem => {
                contextStr += `- [Memory recorded on ${new Date(mem.date).toLocaleDateString()}]: ${mem.note}\n`;
            });
            contextStr += `Use these details to recognize and personalize your interaction with them instantly. Do not call get_social_memory tool for this user, as it is already provided here.\n`;
        }
        
        if (session) {
            console.log(`[ONLINE-SESSION] User ${message.author.tag} is online with character: ${session.charName}, ID: ${session.sectionId}, Episode: ${session.episode}, Difficulty: ${session.difficulty}`);
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

client.login(config.bot_token);