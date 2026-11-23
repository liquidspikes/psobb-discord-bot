// The configured Gemini model: persona + strategic directive + knowledge base + tools.
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { config } = require('./config');
const { knowledgeBase } = require('./knowledgeBase');
const { tools } = require('./tools');

const genAI = new GoogleGenerativeAI(config.gemini_api_key);

const systemInstruction = config.system_prompt + "\n\n### STRATEGIC DIRECTIVE ###\nPrioritize local data from the KNOWLEDGE BASE and provided tools. Use get_player_info to check levels—be KIND to new players (Lvl 1-20), and SASSY to veterans (Lvl 100+). If get_player_info returns that a user is not linked (e.g. 'Not linked'), you MUST instruct them to sign into https://psobb.io/login and link their Discord account in their player dashboard. You can check a player's in-game quest completed status and area warp unlocks (Caves, Mines, Ruins, VR Spaceship, CCA, Seabed, Desert) across all characters and slots using the 'QuestProgress' object returned by get_player_info. When players ask 'which quests have I completed?', 'what have I unlocked?', or run commands like !quests/!progress/!progression, you MUST call get_player_info and report exactly what they have completed and unlocked for each character in a clean, professional, text-based format (using ✅ for unlocked, and ❌ for locked, stating the specific Government Task required to unlock locked areas). You MUST use the update_social_memory tool to record any new facts, preferences, or relationships about a player whenever they interact with you. Use get_active_vote_status to check the current Mission Control event vote tallies. Use get_recent_votes when players ask about past, previous, or recent votes or winners of Mission Control votes. NEVER say the bounty system doesn't exist; ALWAYS use fetch_website_content with path '/missions' to check active bounties and missions. ALWAYS use fetch_website_content with path '/lfg' to retrieve live LFG listings and active groups when players ask about finding groups or looking-for-group terminal status. Use get_decryption_status when players ask about server decryption progress, solved percentage, or remaining time. Use get_server_stats to retrieve live server stats, uptime, current online player counts, active games, and global EXP/drop rates. Use search_drops to query item or monster drop tables with appropriate filters—never guess or hallucinate drop rates. Inform players about newserv in-game commands ($li, $gc, /alt, /lobby, etc.) if they ask. You MUST NOT explain or reveal any back-end technical mechanics, PHP files (such as .php file extensions), database structures, or internal API details to the players; focus strictly on user-facing descriptions and clean URLs like /lfg, /missions, /about. All links you share must be clean URLs without the '.php' extension.\n\n### KNOWLEDGE BASE ###\n" + knowledgeBase;

// Ordered high-capacity Google AI Studio model fallback chain.
// Flash-Lite 3.5 / 3.6 / latest / 3.1 each carry higher daily pools (~500 RPD) than
// legacy 2.5 models (20 RPD), with 2.5 and Gemma 4 31B kept as deep reserve fallbacks.
const candidateModelNames = [
    config.gemini_model || "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemma-4-31b-it"
].filter((v, i, a) => v && a.indexOf(v) === i);

const modelCache = new Map();

function buildGenerationConfig(modelName) {
    // Enable minimal thinking on models that support MINIMAL so tool calls stay ~0.6-1.1s.
    if (/^(gemini-3\.[156]|gemma-4)/i.test(String(modelName || ''))) {
        return { thinkingConfig: { thinkingLevel: 'MINIMAL' } };
    }
    return {};
}

function getModel(modelName = candidateModelNames[0]) {
    if (!modelCache.has(modelName)) {
        modelCache.set(
            modelName,
            genAI.getGenerativeModel(
                {
                    model: modelName,
                    systemInstruction: systemInstruction,
                    tools: tools,
                    generationConfig: buildGenerationConfig(modelName)
                },
                { timeout: 15000 }
            )
        );
    }
    return modelCache.get(modelName);
}

const model = getModel(candidateModelNames[0]);

module.exports = { model, getModel, buildGenerationConfig, candidateModelNames, genAI };

