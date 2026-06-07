// =====================================================================
// LFG ANNOUNCER
// Polls the website's get_lfg bot endpoint and posts each NEW Looking-For-Group
// request to a Discord channel, pinging the class roles the poster is looking
// for (HU→Hunter, RA→Ranger, FO→Force). Tracks the last announced post id
// (persisted to the memory dir) so restarts don't replay old posts, and seeds
// from the server's latest_id on first run so an existing backlog isn't dumped
// into the channel.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { config, MEMORY_DIR } = require('./config');
const { client } = require('./discordClient');
const { apiCall } = require('./api');
const { logInfo, logWarn, logError } = require('./actionLog');

// Channel to announce in. Configurable via lfg_sync.channel_id (or top-level
// lfg_channel_id); falls back to the #ragol-dispatch-lfg channel id.
const LFG_CHANNEL_ID = String(
    (config.lfg_sync || {}).channel_id || config.lfg_channel_id || '1502345296737337474'
);
// Poll cadence; floor of 15s to stay friendly to the API.
const LFG_INTERVAL_MS = Math.max(15, (config.lfg_sync || {}).interval_seconds || 60) * 1000;

// Map LFG "looking_for" archetype tokens to the managed class role names.
const ARCHETYPE_TO_ROLE = { HU: 'Hunter', RA: 'Ranger', FO: 'Force' };

// Persisted cursor: the highest LFG post id we've already announced.
const CURSOR_PATH = path.join(MEMORY_DIR, 'last_lfg_id.json');
function loadCursor() {
    try {
        if (fs.existsSync(CURSOR_PATH)) {
            const obj = JSON.parse(fs.readFileSync(CURSOR_PATH, 'utf8'));
            if (obj && Number.isFinite(obj.lastId)) return obj.lastId;
        }
    } catch (e) { logError('LFG', `Cursor load error: ${e.message}`); }
    return null; // null = not seeded yet (first ever run)
}
function saveCursor(id) {
    try {
        fs.writeFileSync(CURSOR_PATH, JSON.stringify({ lastId: id }, null, 2));
    } catch (e) { logError('LFG', `Cursor save error: ${e.message}`); }
}

let lastId = loadCursor();

function findRole(guild, name) {
    return guild.roles.cache.find((r) => r.name.toLowerCase() === name.toLowerCase()) || null;
}

// Build the announcement message + the list of role ids we're allowed to ping.
function buildAnnouncement(guild, post) {
    // Resolve class-role pings from looking_for ("HU,RA,FO").
    const wanted = String(post.looking_for || '')
        .split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
    const mentions = [];
    const roleIds = [];
    const seen = new Set();
    for (const tok of wanted) {
        const roleName = ARCHETYPE_TO_ROLE[tok];
        if (!roleName || seen.has(roleName)) continue;
        seen.add(roleName);
        const role = guild && findRole(guild, roleName);
        if (role) { mentions.push(`<@&${role.id}>`); roleIds.push(role.id); }
        else mentions.push(`**${roleName}**`); // role not on server — name only, no ping
    }
    const lookingStr = mentions.length ? mentions.join(' ') : 'anyone';

    const name = post.character_name || 'A hunter';
    const lvl = post.level ? `Lvl ${post.level} ` : '';
    const cls = post.class || '';
    const sec = post.section_id ? ` · ${post.section_id}` : '';
    const mode = post.game_mode && post.game_mode !== 'Normal' ? ` · ${post.game_mode}` : '';
    const desc = String(post.description || '').slice(0, 500);

    let content = `📣 **New LFG** — **${name}** (${lvl}${cls}${sec})\n`;
    if (post.game_name) content += `🎮 **${post.game_name}**${mode}\n`;
    content += `🔎 Looking for: ${lookingStr}\n`;
    if (desc) content += `📝 ${desc}\n`;
    if (post.bounty_title) {
        content += `🎯 Team bounty: **${post.bounty_title}**`;
        if (post.bounty_reward) content += ` — 🎁 ${post.bounty_reward}`;
        content += `\n`;
    }
    content += post.discord_id ? `Posted by <@${post.discord_id}> — hop in-game to join!` : `Hop in-game to join!`;

    return { content: content.slice(0, 1990), roleIds };
}

async function pollLfg(channel) {
    try {
        const guild = channel.guild;
        // Ensure roles are cached so class pings resolve.
        if (guild && guild.roles.cache.size <= 1) await guild.roles.fetch().catch(() => {});

        const params = (lastId && lastId > 0) ? { since_id: lastId } : {};
        const data = await apiCall('get_lfg', params);
        if (!data || data.error || data.success !== true) return; // apiCall logs API errors

        // First ever run (no persisted cursor): seed to the server's latest id and
        // skip announcing, so we don't dump the existing backlog into the channel.
        if (lastId === null) {
            lastId = Number.isFinite(data.latest_id) ? data.latest_id : 0;
            saveCursor(lastId);
            logInfo('LFG', `Watcher seeded at post id ${lastId}; will announce posts after this.`);
            return;
        }

        const listings = Array.isArray(data.listings) ? data.listings : [];
        for (const post of listings) {
            const id = parseInt(post.id, 10);
            if (!Number.isFinite(id) || id <= lastId) continue;
            const { content, roleIds } = buildAnnouncement(guild, post);
            try {
                await channel.send({
                    content,
                    // Only the resolved class roles may ping — never @everyone/@here,
                    // arbitrary users, or anything embedded in the raw description.
                    allowedMentions: { parse: [], roles: roleIds, users: [] },
                });
                logInfo('LFG', `Announced LFG #${id} by ${post.character_name || 'unknown'} (looking for ${post.looking_for || 'anyone'}).`);
            } catch (e) {
                logWarn('LFG', `Failed to post LFG #${id}: ${e.message}`);
            }
            lastId = Math.max(lastId, id);
            saveCursor(lastId);
        }
    } catch (e) {
        logError('LFG', `Poll error: ${e.message}`);
    }
}

let lfgTimer = null;
async function startLfgWatcher() {
    const cfg = config.lfg_sync || {};
    if (cfg.enabled === false) { logInfo('LFG', 'Disabled via config.'); return; }
    if (!LFG_CHANNEL_ID) { logWarn('LFG', 'No LFG channel configured; watcher not started.'); return; }

    const channel = await client.channels.fetch(LFG_CHANNEL_ID).catch(() => null);
    if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
        logWarn('LFG', `LFG channel ${LFG_CHANNEL_ID} not found or not a text channel; watcher not started.`);
        return;
    }

    logInfo('LFG', `Watcher active in #${channel.name || LFG_CHANNEL_ID}. Interval: ${LFG_INTERVAL_MS / 1000}s. Cursor: ${lastId === null ? 'unseeded' : lastId}.`);
    await pollLfg(channel);
    lfgTimer = setInterval(() => pollLfg(channel), LFG_INTERVAL_MS);
}

module.exports = { startLfgWatcher, buildAnnouncement };
