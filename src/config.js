// Runtime configuration + shared paths.
// The config file lives outside the repo (see README "Configuration").
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('/psobb-bot/discord_config.json', 'utf8'));
const MEMORY_DIR = '/psobb-bot/memory';
const RAG_PATH = '/psobb-bot/rag';
const MAIN_KNOWLEDGE_PATH = '/psobb-bot/knowledge.md';

module.exports = { config, MEMORY_DIR, RAG_PATH, MAIN_KNOWLEDGE_PATH };
