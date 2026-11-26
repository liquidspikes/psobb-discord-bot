// Core Game Logic Layer for Discord Tekker Challenge
const { config, ONLINE_ROLE_ID } = require('./config');
const db = require('./tekkerDb');
const { logInfo, logWarn, logError } = require('./actionLog');
const { client } = require('./discordClient');
const { isUserLinked } = require('./roleSync');
const {
    WEAPON_ATTR_CATEGORIES: CATEGORIES,
    WEAPON_ATTR_EMOJIS: EMOJIS,
    TEKKER_MASKED_WEAPON: MASKED_WEAPON,
} = require('./pso');
const { MessageFlags } = require('discord.js');

// Shown prominently whenever the game runs against the local test store
// (tekkerDb.LOCAL_MODE) so players understand tokens won here are NOT real
// rewards yet. The drop announcement gets a dedicated field; win messages get
// this line appended.
const TEST_MODE_WIN_NOTICE =
    '🧪 **TEST MODE** — this was a local test puzzle. This token is a **local test token only**; ' +
    '**real reward tokens are NOT generated until the website is brought up to date.**';
const TEST_MODE_DROP_FIELD = {
    name: '🧪 TEST MODE — practice only',
    value: 'This puzzle is running on the bot\'s local test store. Any token won here is a **local test token** and will **NOT** become a real reward until the website is brought up to date.',
};

// Cooldown tracker maps to enforce chat message (10s) and reaction (5s) anti-spam rules
const cooldowns = {
    message: new Map(),
    reaction: new Map()
};

// Active lock and phase messages
let activeLock = {
    userId: null,
    lockExpiresAt: 0,
    fumbleExpiresAt: 0
};
let phaseMessageIds = [];

// Per-drop list of /guess slash interactions whose (ephemeral) result messages
// we delete when the game ends (win / !tekker end / despawn). Ephemerals aren't
// real channel messages, so this is the only way to clear them — and Discord
// only allows it within ~15 min of each interaction, so older ones are skipped.
// Reset when a new drop is announced.
let guessInteractions = [];

// Delete every tracked /guess ephemeral result (best-effort, in parallel) and
// reset the list. Tokens older than ~15 min just fail and are skipped.
async function clearGuessEphemerals() {
    const list = guessInteractions;
    guessInteractions = [];
    await Promise.allSettled(list.map((it) => it.deleteReply().catch(() => {})));
}

// Target role ID for Server Boosters
const BOOSTER_ROLE_ID = '1500893249861324832';

// Dedicated channel the Tekker game runs in: drops are announced here and only
// guesses posted here are accepted. Configurable via tekker.channel_id (or
// top-level tekker_channel_id); falls back to the #tekker-challenge channel id.
const TEKKER_CHANNEL_ID = String(
    (config.tekker || {}).channel_id || config.tekker_channel_id || '1514826464631984168'
);

// At the START of each game the tekker channel is wiped clean except for this
// ONE message (e.g. a pinned rules/info post). Configurable via
// tekker.keep_message_id; falls back to the known pinned message.
const KEEP_MESSAGE_ID = String(
    (config.tekker || {}).keep_message_id || '1514911615839899770'
);

// Generate an unambiguous alphanumeric token code (excluding easily confused characters like O, 0, I, 1)
function generateTokenId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let token = '';
    for (let i = 0; i < 6; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `T-${token}`;
}

// Generate a new drop puzzle. The website backend is the authority: it rolls the
// stats, picks the two locked zeros + public hint, and sets the despawn window,
// then returns the full drop record. We must announce THAT object — rolling stats
// locally would show a hint that doesn't match the stored puzzle. Returns the drop
// on success, or null if the backend is unreachable (so the caller can skip the
// announcement instead of advertising a phantom drop).
async function generateDrop() {
    const created = await db.createDrop({});
    if (!created || !created.hint_attribute) {
        logError('TEKKER', 'createDrop returned no drop (backend down?) — skipping announcement.');
        return null;
    }
    return created;
}

// Wipe every message in the tekker channel except `keepId`, so each new game
// starts on a clean slate. Uses bulkDelete for messages < 14 days old (one API
// call per 100) and falls back to individual deletes for older ones. Requires
// the bot to have Manage Messages in the channel. Best-effort; logs on failure.
async function clearChannelExcept(channel, keepId) {
    let removed = 0;
    try {
        for (let i = 0; i < 12; i++) { // cap passes to avoid runaway on a huge channel
            const batch = await channel.messages.fetch({ limit: 100 }).catch(() => null);
            if (!batch || batch.size === 0) break;
            const deletable = batch.filter(m => m.id !== keepId);
            if (deletable.size === 0) break;

            const bulk = await channel.bulkDelete(deletable, true).catch(() => null);
            const bulkCount = bulk ? bulk.size : 0;
            removed += bulkCount;

            // bulkDelete silently skips messages older than 14 days — sweep those one by one.
            const leftover = bulk ? deletable.filter(m => !bulk.has(m.id)) : deletable;
            let individual = 0;
            for (const m of leftover.values()) {
                if (await m.delete().then(() => true).catch(() => false)) individual++;
            }
            removed += individual;

            // No progress this pass (everything left is undeletable — perms/age) — stop.
            if (bulkCount + individual === 0) break;
            if (batch.size < 100) break;
        }
    } catch (e) {
        logError('TEKKER', `Failed to clear tekker channel for new game: ${e.message}`);
    }
    if (removed) logInfo('TEKKER', `Cleared ${removed} message(s) from the tekker channel for the new game (kept ${keepId}).`);
    return removed;
}

// Broadcast drop announcement embed to the configured channel
async function announceDrop(drop) {
    try {
        const channel = await client.channels.fetch(TEKKER_CHANNEL_ID).catch(() => null);
        if (channel) {
            // Fresh slate: wipe the channel (keeping the pinned info message) BEFORE
            // posting the new drop, so the previous game's messages don't linger.
            await clearChannelExcept(channel, KEEP_MESSAGE_ID);
            phaseMessageIds = []; // any tracked transient ids are gone now
            guessInteractions = []; // fresh game — start tracking guess ephemerals anew
            const embed = {
                title: `🚨 SPECIAL WEAPON DROP: [${MASKED_WEAPON}] 🚨`,
                description: `Scanner indicates **${EMOJIS[drop.hint_attribute]} ${drop.hint_attribute}** is **0%**.\n\n` +
                             `• **Base users**: 5 attempts\n` +
                             `• **Server Boosters**: 8 attempts\n` +
                             `• **Time Limit**: 2 hours (adds 30m per guess, max 8h)\n\n` +
                             `*First to map all stats claims the reward token!*\n` +
                             `Use \`/guess [Native] [A.Beast] [Machine] [Dark] [Hit]\` (divisible by 5, all attributes ≤ 90%)`,
                color: 0x00ff88, // Vibrant green
                // In local test mode, warn up-front that wins aren't real rewards yet.
                ...(db.LOCAL_MODE ? { fields: [TEST_MODE_DROP_FIELD] } : {}),
            };
            // Ping the online-players role so in-game hunters get alerted to the drop.
            await channel.send({
                content: ONLINE_ROLE_ID ? `<@&${ONLINE_ROLE_ID}>` : undefined,
                embeds: [embed],
                allowedMentions: ONLINE_ROLE_ID ? { roles: [ONLINE_ROLE_ID] } : { parse: [] },
            });
        }
    } catch (e) {
        logError('TEKKER', `Failed to broadcast drop announcement: ${e.message}`);
    }
}

// Track Discord user activity (Messages, Reactions, Voice) and roll chance-based drop trigger
async function trackActivity(userId, guild, type) {
    // 1. Verify user is linked on website
    if (!isUserLinked(userId)) return;

    // 2. Enforce point-award cooldown timers to prevent spam
    const now = Date.now();
    if (type === 'message') {
        const last = cooldowns.message.get(userId) || 0;
        if (now - last < 10000) return; // 10s cooldown
        cooldowns.message.set(userId, now);
    } else if (type === 'reaction') {
        const last = cooldowns.reaction.get(userId) || 0;
        if (now - last < 5000) return; // 5s cooldown
        cooldowns.reaction.set(userId, now);
    }

    // 3. Pause if there is an active puzzle already running
    const activeDrop = await db.getActiveDrop();
    if (activeDrop) return;

    // 4. Record active user contributor in the Tekker store
    await db.addActiveUser(userId);

    // 5. Evaluate trigger chance
    const uniqueUsersCount = await db.getActiveUserCount();
    const threshold = await db.getTriggerThreshold();
    const P = Math.min(1.0, uniqueUsersCount / threshold); // Probability limit = 100%
    const roll = Math.random();

    if (roll < P) {
        logInfo('TEKKER', `Activity trigger succeeded: unique contributors = ${uniqueUsersCount}/${threshold} (chance: ${(P * 100).toFixed(1)}%, roll: ${(roll * 100).toFixed(1)}%). Launching drop...`);
        
        // Reset unique contributor tracker
        await db.clearActiveUsers();
        
        // Generate new drop (backend-authoritative). Only announce if it succeeded.
        const newDrop = await generateDrop();
        if (newDrop) await announceDrop(newDrop);
    }
}

// Admin: mint a token with explicit stats for a user (DB adjustment). Returns
// { tokenId, stats } or { error }. Validates the same legality the game enforces.
async function adminGrantToken(ownerId, stats) {
    if (!Array.isArray(stats) || stats.length !== 5 || stats.some((n) => !Number.isInteger(n) || n < 0 || n % 5 !== 0)) {
        return { error: 'Stats must be 5 non-negative whole numbers divisible by 5 (Native A.Beast Machine Dark Hit).' };
    }
    if (stats.some((n) => n > 90)) return { error: 'Attributes cannot exceed 90% (Hit included).' };

    const tokenId = generateTokenId();
    await db.createToken({
        token_id: tokenId,
        owner_id: ownerId,
        stat_native: stats[0], stat_abeast: stats[1], stat_machine: stats[2], stat_dark: stats[3], stat_hit: stats[4],
    });
    logInfo('TEKKER', `Admin granted token ${tokenId} (${stats.join('/')}) to ${ownerId}`);
    return { tokenId, stats };
}

// Transfer token ownership to another user
async function giftReward(ownerId, tokenId, targetUserId) {
    const token = await db.getToken(tokenId);
    if (!token) {
        return { success: false, error: `Token \`${tokenId}\` not found.` };
    }
    if (token.owner_id !== ownerId) {
        return { success: false, error: "You do not own this token." };
    }
    if (token.is_claimed) {
        return { success: false, error: "This token has already been claimed." };
    }

    await db.transferToken(tokenId, targetUserId);
    logInfo('TEKKER', `Token ${tokenId} gifted from ${ownerId} to ${targetUserId}`);
    return { success: true, token };
}

async function clearPhaseMessages() {
    try {
        const channel = await client.channels.fetch(TEKKER_CHANNEL_ID).catch(() => null);
        if (channel) {
            for (const msgId of phaseMessageIds) {
                const msg = await channel.messages.fetch(msgId).catch(() => null);
                if (msg) await msg.delete().catch(() => {});
            }
        }
    } catch (e) {
        logError('TEKKER', `Failed to clear phase messages: ${e.message}`);
    }
    phaseMessageIds = [];
}

// Admin: end the active drop early. Deactivates it, clears the activity tracker
// and the transient phase messages, and posts a reveal (the stats players missed)
// to the tekker channel. Returns the ended drop, or null if none was active.
async function endActiveDrop(endedByName) {
    const drop = await db.getActiveDrop();
    if (!drop) return null;

    await db.deactivateDrop(drop.drop_id);
    await db.clearActiveUsers();
    await clearPhaseMessages();
    await clearGuessEphemerals();

    try {
        const channel = await client.channels.fetch(TEKKER_CHANNEL_ID).catch(() => null);
        if (channel) {
            const embed = {
                title: `🛑 CHALLENGE ENDED 🛑`,
                description: `An admin${endedByName ? ` (**${endedByName}**)` : ''} ended the **[${MASKED_WEAPON}]** challenge early.\n\n` +
                             `*Here is what it was:*\n` +
                             `🗡️ **Native**: ${drop.stat_native}%\n` +
                             `🐾 **A.Beast**: ${drop.stat_abeast}%\n` +
                             `🤖 **Machine**: ${drop.stat_machine}%\n` +
                             `👻 **Dark**: ${drop.stat_dark}%\n` +
                             `🎯 **Hit**: ${drop.stat_hit}%\n`,
                color: 0xff4444 // Red
            };
            await channel.send({ embeds: [embed] });
        }
    } catch (e) {
        logError('TEKKER', `Failed to post challenge-ended reveal: ${e.message}`);
    }

    logInfo('TEKKER', `Active drop ${drop.drop_id} ended early${endedByName ? ` by ${endedByName}` : ''}.`);
    return drop;
}

async function processSlashGuess(interaction) {
    // Guild-only: booster/member resolution needs a guild, and the game lives in its
    // dedicated channel. (Registration also sets dm_permission:false; this is a guard
    // for older clients/cached commands.) Replies here are pre-defer, so use reply().
    if (!interaction.guild) {
        return await interaction.reply({
            content: '🎮 The Tekker Challenge can only be played in the server.',
            ephemeral: true
        });
    }
    if (interaction.channel.id !== TEKKER_CHANNEL_ID) {
        return await interaction.reply({
            content: `🎮 The Tekker Challenge runs in <#${TEKKER_CHANNEL_ID}> — post your guess there!`,
            ephemeral: true
        });
    }

    // Acknowledge immediately. The evaluation below makes several sequential round
    // trips to the website backend, which can exceed Discord's 3s interaction-token
    // window; deferring reserves the token so we can editReply() with the result.
    // From here on, all ephemeral responses MUST use editReply (not reply).
    await interaction.deferReply({ ephemeral: true });

    // 1. Resolve active drop
    const drop = await db.getActiveDrop();
    if (!drop) {
        return await interaction.editReply({
            content: "⚠️ There is no active weapon drop puzzle right now. Activity in the server will trigger the scanner to detect a new drop!"
        });
    }

    // 2. Validate guess options
    const native = interaction.options.getInteger('native');
    const abeast = interaction.options.getInteger('abeast');
    const machine = interaction.options.getInteger('machine');
    const dark = interaction.options.getInteger('dark');
    const hit = interaction.options.getInteger('hit');
    const guessArgs = [native, abeast, machine, dark, hit];

    const validationErrors = [];
    const categories = CATEGORIES;
    for (let i = 0; i < 5; i++) {
        const val = guessArgs[i];
        if (val < 0) {
            validationErrors.push(`${categories[i]} cannot be negative.`);
        }
        if (val % 5 !== 0) {
            validationErrors.push(`${categories[i]} must be divisible by 5.`);
        }
        if (val > 90) {
            validationErrors.push(`${categories[i]} cannot exceed 90%.`);
        }
    }

    if (validationErrors.length > 0) {
        return await interaction.editReply({
            content: `⚠️ **Validation failed**:\n${validationErrors.map(e => `• ${e}`).join('\n')}`
        });
    }

    // 3. Appraisal Lock & Fumble Check
    const now = Date.now();
    const guesserId = interaction.user.id;

    if (activeLock.userId && now < activeLock.fumbleExpiresAt) {
        if (now < activeLock.lockExpiresAt) {
            // Under 10s Appraisal Lock
            if (activeLock.userId !== guesserId) {
                // Snipe attempt
                return await interaction.editReply({
                    content: `🛑 <@${activeLock.userId}> is inspecting the item.`
                });
            } else {
                // Owner guessing within lock - refresh lock & fumble
                activeLock.lockExpiresAt = now + 10000;
                activeLock.fumbleExpiresAt = now + 15000;
            }
        } else {
            // Fumble window
            if (activeLock.userId === guesserId) {
                // Owner fumbling
                return await interaction.editReply({
                    content: `🛑 Scanner cooling down.`
                });
            } else {
                // Sniper stealing lock
                activeLock.userId = guesserId;
                activeLock.lockExpiresAt = now + 10000;
                activeLock.fumbleExpiresAt = now + 15000;
            }
        }
    } else {
        // Lock expired or unassigned
        activeLock.userId = guesserId;
        activeLock.lockExpiresAt = now + 10000;
        activeLock.fumbleExpiresAt = now + 15000;
    }

    // 4. Resolve booster status and attempts limits
    const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    let isBooster = false;
    if (member) {
        const hasRole = member.roles.cache.has(BOOSTER_ROLE_ID);
        const isPremium = member.premiumSince !== null || member.roles.cache.some(r => r.tags && r.tags.premiumSubscriberRole);
        isBooster = hasRole || isPremium;
    }
    const maxAttempts = isBooster ? 8 : 5;

    let playerState = await db.getPlayerState(interaction.user.id, drop.drop_id);
    let lifetimeAttempts = 0;
    let attemptsRemaining = maxAttempts;
    let lastGuessAt = null;

    if (playerState) {
        lifetimeAttempts = playerState.lifetime_attempts || 0;
        attemptsRemaining = playerState.attempts_remaining !== null && playerState.attempts_remaining !== undefined
            ? playerState.attempts_remaining
            : maxAttempts - playerState.attempts_used;
        lastGuessAt = playerState.last_guess_at;
    }

    // Lazy regeneration
    if (lastGuessAt) {
        const lastTime = new Date(lastGuessAt).getTime();
        const hoursPassed = Math.floor((Date.now() - lastTime) / 3600000);
        if (hoursPassed > 0) {
            attemptsRemaining = Math.min(maxAttempts, attemptsRemaining + hoursPassed);
        }
    }

    if (attemptsRemaining <= 0) {
        return await interaction.editReply({
            content: `⚠️ You have exhausted your attempts for this drop. Regenerating 1 attempt per hour.`
        });
    }

    attemptsRemaining--;
    lifetimeAttempts++;
    const lastGuessAtStr = new Date().toISOString();

    await db.upsertPlayerState(
        interaction.user.id,
        drop.drop_id,
        maxAttempts - attemptsRemaining,
        maxAttempts,
        lifetimeAttempts,
        attemptsRemaining,
        lastGuessAtStr
    );

    // 5. Compare stats and compile Higher/Lower/Correct feedback (with suppressions)
    const trueStats = [drop.stat_native, drop.stat_abeast, drop.stat_machine, drop.stat_dark, drop.stat_hit];
    const hintAttr = drop.hint_attribute;
    const secondZeroDiscovered = drop.second_zero_discovered === 1;

    // Identify hidden second zero
    const lockedZeros = [];
    if (drop.base_native === 0) lockedZeros.push("Native");
    if (drop.base_abeast === 0) lockedZeros.push("A.Beast");
    if (drop.base_machine === 0) lockedZeros.push("Machine");
    if (drop.base_dark === 0) lockedZeros.push("Dark");
    if (drop.base_hit === 0) lockedZeros.push("Hit");
    const hiddenSecondZero = lockedZeros.find(cat => cat !== hintAttr);

    let correctCount = 0;
    const lines = [];

    for (let i = 0; i < 5; i++) {
        const cat = categories[i];
        const emoji = EMOJIS[cat];
        const gVal = guessArgs[i];
        const tVal = trueStats[i];

        if (gVal === tVal) {
            correctCount++;
            if (cat === hintAttr) {
                lines.push(`${emoji} **${cat}**: ${gVal}% 🔒 *(Hint)*`);
            } else if (cat === hiddenSecondZero && secondZeroDiscovered) {
                lines.push(`${emoji} **${cat}**: ${gVal}% 🔒 *(Discovered)*`);
            } else {
                lines.push(`${emoji} **${cat}**: ${gVal}% ✅ *(Correct)*`);
            }
        } else {
            // The hidden second zero now gives normal directional feedback: a guess
            // above 0 shows "Lower" like any other attribute (it's no longer masked
            // as "Incorrect"). Guessing 0 on a genuinely non-zero attribute still
            // shows "Incorrect" so 0-probes can't map out which attributes are zero.
            if (gVal === 0 && tVal > 0) {
                lines.push(`${emoji} **${cat}**: ${gVal}% ❌ *(Incorrect)*`);
            } else if (gVal < tVal) {
                lines.push(`${emoji} **${cat}**: ${gVal}% 🔼 *(Higher)*`);
            } else {
                lines.push(`${emoji} **${cat}**: ${gVal}% 🔽 *(Lower)*`);
            }
        }
    }

    const isWin = correctCount === 5;
    const resultState = isWin ? 'Win' : (attemptsRemaining <= 0 ? 'Loss' : 'In_Progress');

    // Telemetry log
    await db.addTelemetryLog(interaction.user.id, drop.drop_id, guessArgs, resultState);

    // 6. Handle pulse timer
    await db.pulseDespawnTime(drop.drop_id);

    if (isWin) {
        // Deactivate drop and clear messages
        await db.deactivateDrop(drop.drop_id);
        await db.clearActiveUsers();
        await clearPhaseMessages();

        const tokenId = generateTokenId();
        await db.createToken({
            token_id: tokenId,
            owner_id: interaction.user.id,
            stat_native: trueStats[0],
            stat_abeast: trueStats[1],
            stat_machine: trueStats[2],
            stat_dark: trueStats[3],
            stat_hit: trueStats[4]
        });

        const embed = {
            title: `🏆 SPECIAL WEAPON CLAIMED 🏆`,
            description: `🎉 Congratulations **${interaction.user.username}**! You solved all stats on attempt **${maxAttempts - attemptsRemaining}/${maxAttempts}**!\n\n` +
                         `*Your token locks in these guaranteed attributes for a **${MASKED_WEAPON}** — redeem it later on the website.*\n\n` +
                         `**Final Stats Resolved**:\n` +
                         `🗡️ Native: **${trueStats[0]}%**\n` +
                         `🐾 A.Beast: **${trueStats[1]}%**\n` +
                         `🤖 Machine: **${trueStats[2]}%**\n` +
                         `👻 Dark: **${trueStats[3]}%**\n` +
                         `🎯 Hit: **${trueStats[4]}%**\n\n` +
                         `🎁 **Reward Token Generated**: \`${tokenId}\`\n\n` +
                         `*Your token is **saved to your account**. Redeem it on https://psobb.io/ or transfer it via \`!gift ${tokenId} @User\`!*`,
            color: 0x00c8ff
        };
        if (db.LOCAL_MODE) embed.description += `\n\n${TEST_MODE_WIN_NOTICE}`;

        logInfo('TEKKER', `Win: ${interaction.user.tag} solved stats ${trueStats.join('/')} → token ${tokenId}`);

        // Public victory broadcast — the ONLY win message (no ephemeral copy).
        await interaction.channel.send({
            content: `🏆 <@${interaction.user.id}> solved the Tekker Challenge! 🎉 The item has been claimed.`,
            embeds: [embed],
            allowedMentions: { parse: [], users: [interaction.user.id] },
            flags: [MessageFlags.SuppressNotifications],
        });

        // We had to defer (ephemeral) before scoring; remove that deferred reply so
        // the winner doesn't also get a private ephemeral copy of the win.
        await interaction.deleteReply().catch(() => {});

        // Game over: delete every player's tracked /guess result ephemeral.
        await clearGuessEphemerals();

    } else {
        // Incorrect guess response
        const embed = {
            author: {
                name: `${interaction.user.username}'s Attempt (${maxAttempts - attemptsRemaining}/${maxAttempts})`,
                icon_url: interaction.user.displayAvatarURL({ dynamic: true })
            },
            description: lines.join('\n') + (attemptsRemaining <= 0 ? `\n\n❌ **Attempt Limit Reached.**` : ''),
            color: attemptsRemaining <= 0 ? 0xff4444 : 0xffcc00
        };

        // Persistent Ephemeral Reply to player
        await interaction.editReply({
            content: `🔎 **Tekker Challenge evaluation results:**`,
            embeds: [embed]
        });
        // Track this interaction so its ephemeral can be cleared when the game ends.
        guessInteractions.push(interaction);

        // Public notification showing ONLY the numbers guessed
        const pubMsg = await interaction.channel.send({
            content: `👀 <@${interaction.user.id}> guessed **${guessArgs.join(' ')}** — wrong (${maxAttempts - attemptsRemaining}/${maxAttempts} attempts).`,
            allowedMentions: { parse: [], users: [] },
            flags: [MessageFlags.SuppressNotifications],
        });
        phaseMessageIds.push(pubMsg.id);

        // 7. Check Second Zero Discovery trigger
        const hiddenSecondZeroIdx = CATEGORIES.indexOf(hiddenSecondZero);
        const zeroCount = guessArgs.filter(v => v === 0).length;
        if (guessArgs[hiddenSecondZeroIdx] === 0 && zeroCount <= 2 && !secondZeroDiscovered) {
            await db.discoverSecondZero(drop.drop_id);
            await interaction.channel.send({
                content: `🔍 **Discovery:** A player's scanner confirmed **${EMOJIS[hiddenSecondZero]} ${hiddenSecondZero}** is **0%**!`
            });
        }

        // 8. Handle shifts (Trigger A / B) AFTER evaluation
        let syndicateShift = false;
        const incRes = await db.incrementDropGuesses(drop.drop_id);
        if (incRes && incRes.shift_triggered) {
            syndicateShift = true;
        }

        // Individual cap shift fires once, when THIS player exhausts their personal
        // attempt budget (5 base / 8 booster). Guard the base case with !isBooster so
        // a booster doesn't get an extra shift at 5 on top of their shift at 8.
        let individualShift = false;
        if ((!isBooster && lifetimeAttempts === 5) || (isBooster && lifetimeAttempts === 8)) {
            await db.shiftActiveDropStats(drop.drop_id);
            individualShift = true;
        }

        if (syndicateShift || individualShift) {
            // Clear the transient per-guess phase messages FIRST, then post the
            // scramble notice AFTER. The notice is intentionally NOT tracked in
            // phaseMessageIds, so it persists in the channel (later shifts/wins/
            // despawns only clear the per-guess messages, never this announcement).
            await clearPhaseMessages();

            const trigger = syndicateShift
                ? `the syndicate's combined guessing`
                : `**${interaction.user.username}** using all ${maxAttempts} of their attempts`;
            await interaction.channel.send({
                content: `⚠️ **Instability Detected!** The **${MASKED_WEAPON}**'s hidden attributes have **scrambled** — triggered by ${trigger}. Any Higher/Lower notes may now be stale. Keep guessing!`,
                allowedMentions: { parse: [], users: [] },
            });
            logInfo('TEKKER', syndicateShift
                ? `Syndicate cap shift triggered (drop ${drop.drop_id}).`
                : `Individual cap shift triggered by ${interaction.user.tag} — used all ${maxAttempts} attempts (drop ${drop.drop_id}).`);
        }
    }
}

let despawnInterval = null;
let lastDespawnedKey = null;

function startDespawnWatcher() {
    if (despawnInterval) clearInterval(despawnInterval);
    despawnInterval = setInterval(async () => {
        try {
            const drop = await db.getActiveDrop();
            if (!drop) return;

            if (!drop.drop_id) {
                const nullKey = `null:${drop.despawn_time || ''}`;
                if (lastDespawnedKey !== nullKey) {
                    lastDespawnedKey = nullKey;
                    logWarn('TEKKER', 'Ignoring/deactivating malformed active drop with missing drop_id.');
                }
                await db.deactivateDrop('');
                return;
            }

            const now = Date.now();
            const despawnTime = new Date(drop.despawn_time).getTime();

            if (now >= despawnTime) {
                const despawnKey = `${drop.drop_id}:${drop.despawn_time || ''}`;
                if (lastDespawnedKey === despawnKey) return;
                lastDespawnedKey = despawnKey;

                // Expired!
                await db.deactivateDrop(drop.drop_id);
                await db.clearActiveUsers();
                await clearPhaseMessages();
                await clearGuessEphemerals();

                const channel = await client.channels.fetch(TEKKER_CHANNEL_ID).catch(() => null);
                if (channel) {
                    const embed = {
                        title: `💀 SIGNAL LOST 💀`,
                        description: `The **[${MASKED_WEAPON}]** has vanished.\n\n` +
                                     `*Here is what you missed:*\n` +
                                     `🗡️ **Native**: ${drop.stat_native}%\n` +
                                     `🐾 **A.Beast**: ${drop.stat_abeast}%\n` +
                                     `🤖 **Machine**: ${drop.stat_machine}%\n` +
                                     `👻 **Dark**: ${drop.stat_dark}%\n` +
                                     `🎯 **Hit**: ${drop.stat_hit}%\n`,
                        color: 0xff4444 // Red
                    };
                    await channel.send({ embeds: [embed] });
                }
                logInfo('TEKKER', `Drop ${drop.drop_id} despawned / expired.`);
            }
        } catch (e) {
            logError('TEKKER', `Error in despawn watcher loop: ${e.message}`);
        }
    }, 30000); // Check every 30 seconds
}

module.exports = {
    generateDrop,
    announceDrop,
    trackActivity,
    giftReward,
    adminGrantToken,
    isUserLinked,
    MASKED_WEAPON,
    processSlashGuess,
    startDespawnWatcher,
    endActiveDrop
};
