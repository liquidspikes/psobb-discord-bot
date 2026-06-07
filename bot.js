// Entry point for the PSOBB Discord bot.
// All logic lives in ./src/* modules; this file just wires events and logs in.
const { Events } = require('discord.js');
const { config } = require('./src/config');
const { client } = require('./src/discordClient');
const { startRoleSync, selfCheck } = require('./src/roleSync');
const { registerMessageHandlers } = require('./src/messageHandler');
const { logInfo, logWarn, logError } = require('./src/actionLog');
const { announceStartup } = require('./src/system');

// Attach the raw DM relay + main message handler.
registerMessageHandlers();

client.once(Events.ClientReady, async (c) => {
    logInfo('SYSTEM', `Bot is live: ${c.user.tag}`);

    // Boot-time integrity gate: catch a stale/partial deploy (e.g. the running
    // file missing a helper the sync path references) before it can fail silently
    // mid-sync. Result is logged and surfaced in the admin startup DM either way.
    let selfCheckResult;
    try {
        selfCheckResult = selfCheck();
        logInfo('SYSTEM', selfCheckResult);
    } catch (e) {
        selfCheckResult = `🚨 ${e.message}`;
        logError('SYSTEM', `STARTUP SELF-CHECK FAILED — the running code looks stale or broken: ${e.message}`);
    }

    try {
        const cfg = config.role_sync || {};
        let guild = null;
        if (cfg.guild_id) guild = await c.guilds.fetch(cfg.guild_id).catch(() => null);
        if (!guild && config.channel_id) {
            const ch = await c.channels.fetch(config.channel_id).catch(() => null);
            if (ch && ch.guild) guild = ch.guild;
        }
        if (!guild) guild = c.guilds.cache.first();
        if (guild) {
            await startRoleSync(guild);
            await announceStartup(guild, selfCheckResult);
        } else {
            logWarn('ROLE-SYNC', 'No guild found; role sync not started.');
        }
    } catch (e) {
        logError('ROLE-SYNC', `Startup error: ${e.message}`);
    }
});

client.login(config.bot_token);
