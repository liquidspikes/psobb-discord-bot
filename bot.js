// Entry point for the PSOBB Discord bot.
// All logic lives in ./src/* modules; this file just wires events and logs in.
const { Events, ChannelType } = require('discord.js');
const { config } = require('./src/config');
const { client } = require('./src/discordClient');
const { startRoleSync, selfCheck } = require('./src/roleSync');
const { startLfgWatcher } = require('./src/lfg');
const { startPartyRooms } = require('./src/partyRooms');
const { registerMessageHandlers } = require('./src/messageHandler');
const { logInfo, logWarn, logError } = require('./src/actionLog');
const { announceStartup } = require('./src/system');
const { initDb } = require('./src/tekkerDb');
const { trackActivity } = require('./src/tekkerChallenge');
const { runStartupChecks, isFeatureUp } = require('./src/healthcheck');

// Attach the raw DM relay + main message handler.
registerMessageHandlers();

client.once(Events.ClientReady, async (c) => {
    logInfo('SYSTEM', `Bot is live: ${c.user.tag}`);

    // Initialize SQLite Tekker Database
    try {
        await initDb();
        // Register the slash command globally
        // NOTE: set() replaces the ENTIRE global command list — any future global
        // slash command must be added to this array too, or it will be removed.
        await c.application.commands.set([
            {
                name: 'guess',
                description: 'Guess the attributes of the active special weapon',
                dm_permission: false, // guild-only: the game needs a guild + its channel
                // Every attribute (Hit included) ranges 0–90% (backend rolls
                // 15–80 base ±10 variance); min/max let Discord reject out-of-range
                // input client-side before it ever reaches processSlashGuess.
                options: [
                    { name: 'native', type: 4, description: 'Native attribute percentage (0–90)', required: true, min_value: 0, max_value: 90 },
                    { name: 'abeast', type: 4, description: 'A.Beast attribute percentage (0–90)', required: true, min_value: 0, max_value: 90 },
                    { name: 'machine', type: 4, description: 'Machine attribute percentage (0–90)', required: true, min_value: 0, max_value: 90 },
                    { name: 'dark', type: 4, description: 'Dark attribute percentage (0–90)', required: true, min_value: 0, max_value: 90 },
                    { name: 'hit', type: 4, description: 'Hit attribute percentage (0–90)', required: true, min_value: 0, max_value: 90 },
                ]
            },
            {
                name: 'notify',
                description: 'Manage push notifications for DM, LFG, and VC pings',
                options: [
                    {
                        name: 'type',
                        type: 3, // String
                        description: 'The notification type to configure (DM, LFG, VC)',
                        required: false,
                        choices: [
                            { name: 'DM', value: 'DM' },
                            { name: 'LFG', value: 'LFG' },
                            { name: 'VC', value: 'VC' }
                        ]
                    },
                    {
                        name: 'action',
                        type: 3, // String
                        description: 'Enable or disable push notifications',
                        required: false,
                        choices: [
                            { name: 'Enable (on)', value: 'on' },
                            { name: 'Disable (off)', value: 'off' }
                        ]
                    }
                ]
            }
        ]);
        logInfo('SYSTEM', 'Registered global slash commands.');
        
        if (isFeatureUp('tekker')) {
            const { startDespawnWatcher } = require('./src/tekkerChallenge');
            startDespawnWatcher();
        }
    } catch (e) {
        logError('SYSTEM', `Failed to initialize tekker database / commands: ${e.message}`);
    }

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

    // Dependency health check: probe every website/server endpoint the bot relies
    // on. Any feature whose backend isn't deployed/reachable is disabled for this
    // session (so the bot never runs through code that depends on a missing
    // endpoint) — background features are skipped below, command/AI features tell
    // the invoker. Result is folded into the admin startup DM.
    let healthSummary = null;
    try {
        healthSummary = await runStartupChecks();
    } catch (e) {
        logError('SYSTEM', `Dependency health check failed: ${e.message}`);
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
            // Send the admin boot DM FIRST, so a slow / hung / failing role-sync
            // startup can never delay or suppress it. announceStartup also fetches
            // the full member list, warming the cache for everything below.
            await announceStartup(guild, selfCheckResult, healthSummary);
            // Role sync needs the player API (get_player / get_online_players).
            if (isFeatureUp('role_sync')) {
                await startRoleSync(guild);
            } else {
                logWarn('ROLE-SYNC', 'NOT started — the player API dependency is unavailable (see !health).');
            }
            // Party voice rooms — needs the resolved guild; isolated so a failure
            // here can't take down role sync (and vice versa). Skipped entirely if
            // the get_parties dependency is missing.
            if (isFeatureUp('party_rooms')) {
                try {
                    await startPartyRooms(guild);
                } catch (e) {
                    logError('PARTY', `Startup error: ${e.message}`);
                }
            } else {
                logWarn('PARTY', 'Party rooms NOT started — the get_parties dependency is unavailable (see !health).');
            }

            // Start voice activity tracking loop for the tekker challenge — only if
            // the tekker store is reachable (otherwise every poll would just fail).
            if (isFeatureUp('tekker')) setInterval(async () => {
                try {
                    const channels = await guild.channels.fetch().catch(() => null);
                    if (!channels) return;

                    for (const channel of channels.values()) {
                        // ChannelType.GuildVoice = 2
                        if (channel.type === ChannelType.GuildVoice) {
                            const members = channel.members;
                            // Ignore bots, self-muted, self-deafened, or solo users
                            const activeMembers = members.filter(m => 
                                !m.user.bot && 
                                !m.voice.selfMute && 
                                !m.voice.selfDeaf && 
                                members.size > 1
                            );

                            for (const member of activeMembers.values()) {
                                await trackActivity(member.id, guild, 'voice').catch(() => {});
                            }
                        }
                    }
                } catch (e) {
                    logError('SYSTEM', `Error in voice activity tracking loop: ${e.message}`);
                }
            }, 60000); // Poll every 1 minute
            else logWarn('TEKKER', 'Voice activity tracking NOT started — the tekker store is unavailable (see !health).');
        } else {
            logWarn('ROLE-SYNC', 'No guild found; role sync not started.');
        }
    } catch (e) {
        logError('ROLE-SYNC', `Startup error: ${e.message}`);
    }

    // LFG announcer — polls the website for new Looking-For-Group posts and
    // mirrors them into the dispatch channel. Independent of role sync so a
    // role-sync failure can't take it down (and vice versa).
    try {
        if (isFeatureUp('lfg')) {
            await startLfgWatcher();
        } else {
            logWarn('LFG', 'LFG watcher NOT started — the get_lfg dependency is unavailable (see !health).');
        }
    } catch (e) {
        logError('LFG', `Startup error: ${e.message}`);
    }
});

client.login(config.bot_token);
