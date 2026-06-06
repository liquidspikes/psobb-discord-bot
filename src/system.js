// System / process-level admin commands.
// Restart relies on the process being supervised with an auto-restart policy
// (this deployment uses a systemd unit with `Restart=always`): the bot simply
// exits cleanly and systemd relaunches a fresh process.
const { client } = require('./discordClient');
const { logInfo, logWarn } = require('./actionLog');

// Admin command: "!restart" — gracefully exit so the supervisor relaunches the bot.
async function handleRestartCommand(message) {
    try {
        logInfo('COMMAND', `!restart by ${message.author.tag} (${message.author.id})`);
        if (!message.guild) {
            return await message.reply('⚠️ Run `!restart` in the server (not DMs).');
        }
        if (!message.member || !message.member.permissions.has('Administrator')) {
            return await message.reply('🔒 `!restart` is for server admins only.');
        }

        logWarn('SYSTEM', `Restart requested by ${message.author.tag} — exiting for supervisor relaunch.`);
        try {
            await message.reply('♻️ **Restarting now…** I\'ll be back online in a few seconds.');
        } catch (e) {
            // If the confirmation can't be sent, restart anyway.
        }

        // Give Discord a moment to deliver the reply (and the log to flush), then
        // close the gateway and exit 0 so systemd (Restart=always) brings us back.
        setTimeout(async () => {
            try { await client.destroy(); } catch (e) {}
            process.exit(0);
        }, 1500);
    } catch (e) {
        logWarn('SYSTEM', `!restart error for ${message.author.tag}: ${e.message}`);
        // Last resort: exit so the supervisor can recover a wedged process.
        setTimeout(() => process.exit(0), 1500);
    }
}

module.exports = { handleRestartCommand };
