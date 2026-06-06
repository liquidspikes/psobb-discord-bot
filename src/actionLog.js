// =====================================================================
// ACTION LOG SYSTEM
// A central, structured log of every backend action the bot takes that is
// NOT the AI chatbot conversation itself: role syncs, nickname changes,
// command invocations, PSOBB API calls, session lookups, tool executions,
// and errors. Each action is:
//   1. echoed to the console (preserving prior console output behavior),
//   2. pushed to an in-memory ring buffer (the live "batch window"), and
//   3. appended to a persistent file so admins can pull history via "!log".
// Admins retrieve recent actions over DM with "!log [lines]".
// =====================================================================
const fs = require('fs');
const path = require('path');
const { MEMORY_DIR } = require('./config');

const LOG_PATH = path.join(MEMORY_DIR, 'actions.log');

// In-memory ring buffer: the current runtime "batch window" of recent actions.
const BUFFER_CAPACITY = 2000;
const buffer = [];

// Keep the on-disk log bounded so it can't grow without limit.
const FILE_MAX_LINES = 10000;
const FILE_TRIM_TO = 8000;
let writesSinceTrim = 0;

function formatEntry(level, category, message) {
    return `[${new Date().toISOString()}] [${level.toUpperCase()}] [${category}] ${message}`;
}

// Trim the persistent log file back down once it grows past FILE_MAX_LINES.
function maybeTrimFile() {
    if (++writesSinceTrim < 200) return;
    writesSinceTrim = 0;
    try {
        if (!fs.existsSync(LOG_PATH)) return;
        const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n');
        if (lines.length > FILE_MAX_LINES) {
            const kept = lines.slice(lines.length - FILE_TRIM_TO);
            fs.writeFileSync(LOG_PATH, kept.join('\n'));
        }
    } catch (e) {
        console.error('[ACTION-LOG] Trim error:', e.message);
    }
}

// Record one backend action. level: 'info' | 'warn' | 'error'.
function logAction(category, message, level = 'info') {
    const line = formatEntry(level, category, message);

    buffer.push(line);
    if (buffer.length > BUFFER_CAPACITY) buffer.shift();

    // Echo to console using the matching stream so existing log scraping still works.
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);

    try {
        fs.appendFileSync(LOG_PATH, line + '\n');
        maybeTrimFile();
    } catch (e) {
        console.error('[ACTION-LOG] Write error:', e.message);
    }
}

// Convenience wrappers.
const logInfo = (category, message) => logAction(category, message, 'info');
const logWarn = (category, message) => logAction(category, message, 'warn');
const logError = (category, message) => logAction(category, message, 'error');

// Return the most recent `lines` actions, newest last. Prefers the persistent file
// (survives restarts, supports deep history) and falls back to the in-memory buffer.
function getRecentLogs(lines) {
    // Reads from the persistent file, so history can go deeper than the live buffer.
    const n = Math.max(1, Math.min(lines || 50, FILE_MAX_LINES));
    try {
        if (fs.existsSync(LOG_PATH)) {
            const all = fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter((l) => l.trim());
            return all.slice(-n);
        }
    } catch (e) {
        console.error('[ACTION-LOG] Read error:', e.message);
    }
    return buffer.slice(-n);
}

// Admin command: "!log [lines]" — DM the requesting admin the most recent backend
// actions. Defaults to 50 lines; "!log 200" pulls the last 200 (capped at the buffer
// size). Excludes AI chatbot conversation, which is logged separately.
async function handleLogCommand(message) {
    try {
        logInfo('COMMAND', `!log by ${message.author.tag} (${message.author.id})`);
        if (!message.guild) {
            return await message.reply('⚠️ Run `!log` in the server (not DMs).');
        }
        if (!message.member || !message.member.permissions.has('Administrator')) {
            return await message.reply('🔒 `!log` is for server admins only.');
        }

        // Parse an optional line count: "!log", "!log 100".
        const parts = message.content.trim().split(/\s+/);
        let requested = 50;
        if (parts[1] !== undefined) {
            const parsed = parseInt(parts[1], 10);
            if (Number.isNaN(parsed) || parsed <= 0) {
                return await message.reply('⚠️ Usage: `!log [lines]` — e.g. `!log 100`. Lines must be a positive number.');
            }
            requested = parsed;
        }

        const entries = getRecentLogs(requested);
        if (!entries.length) {
            return await message.reply('ℹ️ No backend actions have been logged yet.');
        }

        const header = `**${message.guild.name}** — last ${entries.length} backend action(s):`;
        const body = entries.join('\n');
        const report = `${header}\n\`\`\`\n${body}\n\`\`\``;

        try {
            // Chunk under Discord's 2000-char limit, keeping code fences intact.
            if (report.length <= 1990) {
                await message.author.send(report);
            } else {
                await message.author.send(header);
                let chunk = '';
                for (const line of entries) {
                    if (chunk.length + line.length + 1 > 1900) {
                        await message.author.send('```\n' + chunk + '\n```');
                        chunk = '';
                    }
                    chunk += (chunk ? '\n' : '') + line;
                }
                if (chunk) await message.author.send('```\n' + chunk + '\n```');
            }
        } catch (dmErr) {
            console.warn(`[ACTION-LOG] !log DM failed for ${message.author.tag}: ${dmErr.message}`);
            return await message.reply('📬 I couldn\'t DM you — please enable direct messages from server members and try `!log` again.');
        }
        return await message.reply(`📬 Sent you the last ${entries.length} action(s) in a DM.`);
    } catch (e) {
        console.error('[ACTION-LOG] !log error:', e.message);
        return await message.reply('📡 Could not read the action log. Try again shortly.');
    }
}

module.exports = {
    logAction,
    logInfo,
    logWarn,
    logError,
    getRecentLogs,
    handleLogCommand,
};
