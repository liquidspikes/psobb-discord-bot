// Builds the static knowledge base string fed into the model's system instruction:
// core lore (knowledge.md) plus every *.md file under the rag/ directory.
const fs = require('fs');
const { RAG_PATH, MAIN_KNOWLEDGE_PATH } = require('./config');

let knowledgeBase = "";

if (fs.existsSync(MAIN_KNOWLEDGE_PATH)) {
    knowledgeBase += "=== CORE LORE & SERVER KNOWLEDGE ===\n";
    knowledgeBase += fs.readFileSync(MAIN_KNOWLEDGE_PATH, 'utf8') + "\n\n";
}

try {
    if (fs.existsSync(RAG_PATH)) {
        const files = fs.readdirSync(RAG_PATH);
        knowledgeBase += "=== TECHNICAL DATA & DEEP DIVES ===\n";
        files.forEach((file) => {
            if (file.endsWith('.md')) {
                const content = fs.readFileSync(`${RAG_PATH}/${file}`, 'utf8');
                knowledgeBase += `\n--- SOURCE: ${file} ---\n${content}\n`;
            }
        });
        console.log(`[INIT] Loaded RAG content from ${files.length} files.`);
    }
} catch (e) {
    console.error("Error reading RAG directory:", e.message);
}

module.exports = { knowledgeBase };
