// Runtime configuration + shared paths.
// The config file lives outside the repo (see README "Configuration").
const fs = require('fs');
const path = require('path');

let config = {};
let MEMORY_DIR = '/psobb-bot/memory';
let RAG_PATH = '/psobb-bot/rag';
let MAIN_KNOWLEDGE_PATH = '/psobb-bot/knowledge.md';

const configPath = '/psobb-bot/discord_config.json';

if (process.env.NODE_ENV === 'test') {
    config = {
        bot_token: "mock-token",
        gemini_api_key: "mock-key",
        system_prompt: "mock-prompt",
        psobb_api_url: "https://mock-api.io/api?key=123",
        psobb_api_secret: "mock-secret",
        channel_id: "mock-channel",
        role_sync: {
            enabled: true,
            interval_minutes: 5,
            guild_id: "mock-guild",
            nickname_level: true,
            protected_roles: []
        }
    };
    MEMORY_DIR = path.join(__dirname, '..', 'test_memory');
    if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    RAG_PATH = path.join(__dirname, '..', 'rag');
    MAIN_KNOWLEDGE_PATH = path.join(__dirname, '..', 'knowledge.md');
} else {
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
        console.error(`Warning: Failed to load config from ${configPath}: ${e.message}`);
        throw e;
    }
}

module.exports = { config, MEMORY_DIR, RAG_PATH, MAIN_KNOWLEDGE_PATH };

