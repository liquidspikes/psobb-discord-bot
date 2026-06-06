// Entry point for the PSOBB Discord bot.
// All logic lives in ./src/* modules; this file just wires events and logs in.
const { Events } = require('discord.js');
const { config } = require('./src/config');
const { client } = require('./src/discordClient');
const { startRoleSync } = require('./src/roleSync');
const { registerMessageHandlers } = require('./src/messageHandler');

// Attach the raw DM relay + main message handler.
registerMessageHandlers();

client.once(Events.ClientReady, async (c) => {
    console.log("[READY] Bot is live: " + c.user.tag);
    try {
        const cfg = config.role_sync || {};
        let guild = null;
        if (cfg.guild_id) guild = await c.guilds.fetch(cfg.guild_id).catch(() => null);
        if (!guild && config.channel_id) {
            const ch = await c.channels.fetch(config.channel_id).catch(() => null);
            if (ch && ch.guild) guild = ch.guild;
        }
        if (!guild) guild = c.guilds.cache.first();
        if (guild) await startRoleSync(guild);
        else console.warn('[ROLE-SYNC] No guild found; role sync not started.');
    } catch (e) {
        console.error('[ROLE-SYNC] Startup error:', e.message);
    }
});

client.login(config.bot_token);
