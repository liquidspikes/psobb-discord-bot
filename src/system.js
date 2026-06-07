// System / process-level admin commands.
// Restart relies on the process being supervised with an auto-restart policy
// (this deployment uses a systemd unit with `Restart=always`): the bot simply
// exits cleanly and systemd relaunches a fresh process.
const { exec } = require('child_process');
const { client } = require('./discordClient');
const { logInfo, logWarn, logError } = require('./actionLog');

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

// Called once on boot/reboot: DM every server admin (members with the Administrator
// permission, excluding bots) that the bot has started, with a timestamp. Fires once
// per process, so a `!restart` or crash-relaunch produces exactly one notice.
async function announceStartup(guild, selfCheckResult = null) {
    const startedAt = new Date();
    try {
        await guild.members.fetch(); // populate the member cache so we can find admins
        const admins = guild.members.cache.filter(
            (m) => !m.user.bot && m.permissions.has('Administrator')
        );
        const stamp = `${startedAt.toISOString()} (${startedAt.toLocaleString()})`;
        let notice = `✅ **${guild.name}** — bot started at ${stamp}.`;
        // Append the boot self-check outcome so a stale/broken deploy is impossible
        // to miss: a passing run reads as a 🩺 line, a failure leads with 🚨.
        if (selfCheckResult) {
            notice += `\n${selfCheckResult.startsWith('🚨') ? selfCheckResult : `🩺 ${selfCheckResult}`}`;
        }
        let delivered = 0;
        for (const member of admins.values()) {
            try {
                await member.send(notice);
                delivered++;
            } catch (e) {
                // Admin has DMs from server members disabled; skip them.
            }
        }
        logInfo('SYSTEM', `Startup notice DMed to ${delivered}/${admins.size} admin(s).`);
    } catch (e) {
        logWarn('SYSTEM', `Startup admin notice failed: ${e.message}`);
    }
}

// Admin command: "!pull" — pull the latest changes from Git and restart if there are updates.
async function handlePullCommand(message) {
    try {
        logInfo('COMMAND', `!pull by ${message.author.tag} (${message.author.id})`);
        if (!message.guild) {
            return await message.reply('⚠️ Run `!pull` in the server (not DMs).');
        }
        if (!message.member || !message.member.permissions.has('Administrator')) {
            return await message.reply('🔒 `!pull` is for server admins only.');
        }

        const reply = await message.reply('📡 **Initiating git pull from origin main...**');
        
        const cmd = 'git -c core.sshCommand="ssh -i /psobb-bot/.git/deploy_key -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null" pull origin main';
        
        exec(cmd, { cwd: '/psobb-bot' }, async (error, stdout, stderr) => {
            if (error) {
                logError('SYSTEM', `Git pull error: ${error.message}`);
                try {
                    return await reply.edit(`❌ **Git pull failed:**\n\`\`\`\n${stderr || error.message}\n\`\`\``);
                } catch (e) {}
                return;
            }
            
            logInfo('SYSTEM', `Git pull output: ${stdout}`);
            
            if (stdout.includes('Already up to date.')) {
                try {
                    return await reply.edit('✅ **Codebase is already up to date.** No restart required.');
                } catch (e) {}
                return;
            }
            
            try {
                await reply.edit(`✅ **Git pull succeeded!**\n\`\`\`\n${stdout.trim()}\n\`\`\`\n♻️ **Restarting now to apply updates...**`);
            } catch (e) {}
            
            setTimeout(async () => {
                try { await client.destroy(); } catch (e) {}
                process.exit(0);
            }, 2000);
        });
    } catch (e) {
        logWarn('SYSTEM', `!pull error for ${message.author.tag}: ${e.message}`);
    }
}

module.exports = { handleRestartCommand, announceStartup, handlePullCommand };
