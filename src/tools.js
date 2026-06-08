// Gemini function-calling tool declarations and their server-side handlers.
const fs = require('fs');
const axios = require('axios');
const { config } = require('./config');
const { client } = require('./discordClient');
const { apiCall, getDropsData } = require('./api');
const { loadSocialMemory, saveSocialMemory } = require('./socialMemory');

// Base directory the external Mission Control vote generator writes its state to
// (current_vote.json + the *.applied snapshots). This is exactly where the bot is
// currently set up to read the voting system from — kept as a single constant so
// the vote tools below and the startup health check both point at the same place.
const VOTE_SCRIPTS_DIR = '/home/alexzimmerman/gemini-psobb-scripts';

// Tool Definitions
const tools = [
    {
        functionDeclarations: [
            {
                name: "get_player_info",
                description: "Retrieves detailed information about a player, including their characters, level, class, online status, team, mission progress, and QuestProgress (detailing in-game quest completions and area warp unlocks across all characters and slots). Pass the Discord ID of the player.",
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
                description: "Reads the text content of a specific page on the psobb.io website. Use this to look up rules, news, guides, or detailed mission/mod lists. Path should start with / (e.g., /about, /missions).",
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
                name: "get_recent_votes",
                description: "Retrieves information about recent Mission Control votes, including the current active vote (with options and live reaction tallies) and the previously completed vote (with its candidates and the winning scenario details). Use this when players ask about past votes, recent votes, or previous winners."
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
            const voteFile = VOTE_SCRIPTS_DIR + '/current_vote.json';
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
    get_recent_votes: async () => {
        try {
            const results = {};

            // 1. Fetch current active vote (if exists)
            const voteFile = VOTE_SCRIPTS_DIR + '/current_vote.json';
            if (fs.existsSync(voteFile)) {
                try {
                    const voteData = JSON.parse(fs.readFileSync(voteFile, 'utf8'));
                    const channelId = config.channel_id;
                    const messageId = voteData.message_id;

                    const channel = await client.channels.fetch(channelId);
                    if (channel) {
                        const targetMessage = await channel.messages.fetch(messageId);
                        if (targetMessage) {
                            const tally = {};
                            targetMessage.reactions.cache.forEach(reaction => {
                                tally[reaction.emoji.name] = reaction.count;
                            });
                            results.active_vote = {
                                event_date: voteData.date,
                                candidates: voteData.candidates,
                                current_votes: tally
                            };
                        }
                    }
                } catch (e) {
                    console.error("Error loading active vote:", e.message);
                }
            }

            // 2. Fetch previously completed / applied vote
            const appliedVoteFile = VOTE_SCRIPTS_DIR + '/current_vote.json.applied';
            const appliedEventFile = VOTE_SCRIPTS_DIR + '/pending_event.json.applied';

            if (fs.existsSync(appliedVoteFile) && fs.existsSync(appliedEventFile)) {
                try {
                    const appliedVote = JSON.parse(fs.readFileSync(appliedVoteFile, 'utf8'));
                    const appliedEvent = JSON.parse(fs.readFileSync(appliedEventFile, 'utf8'));

                    results.previous_vote = {
                        event_date: appliedVote.date,
                        candidates: appliedVote.candidates,
                        winner: {
                            id: appliedEvent.scenario_id,
                            title: appliedEvent.title,
                            desc: appliedEvent.desc,
                            selection_method: appliedEvent.selection_method
                        }
                    };
                } catch (e) {
                    console.error("Error loading applied vote:", e.message);
                }
            }

            return results;
        } catch (e) {
            return { error: "Failed to retrieve recent votes: " + e.message };
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

module.exports = { tools, toolHandlers, VOTE_SCRIPTS_DIR };
