// Core Game Logic Layer for Discord Tekker Challenge
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { config, MEMORY_DIR } = require('./config');
const db = require('./tekkerDb');
const { logInfo, logWarn, logError } = require('./actionLog');
const { client } = require('./discordClient');

// The tekker game deals ONLY in attribute/hit percentages — it does not pick or
// store a weapon. A win mints a token that guarantees these stats; the actual
// weapon is decided later by the (future) website claim page. This label is the
// flavour name shown in Discord for the as-yet-undetermined reward.
const MASKED_WEAPON = '❓ SPECIAL WEAPON';

const CATEGORIES = ["Native", "A.Beast", "Machine", "Dark", "Hit"];
const EMOJIS = {
    "Native": "🗡️",
    "A.Beast": "🐾",
    "Machine": "🤖",
    "Dark": "👻",
    "Hit": "🎯"
};

// Cooldown tracker maps to enforce chat message (10s) and reaction (5s) anti-spam rules
const cooldowns = {
    message: new Map(),
    reaction: new Map()
};

// Target role ID for Server Boosters
const BOOSTER_ROLE_ID = '1500893249861324832';

// Check if a Discord User ID is linked to the website database
function isUserLinked(userId) {
    const rosterPath = path.join(MEMORY_DIR, 'linked_roster.json');
    try {
        if (fs.existsSync(rosterPath)) {
            const arr = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
            if (Array.isArray(arr)) {
                return arr.map(String).includes(String(userId));
            }
        }
    } catch (e) {
        logError('TEKKER', `Failed to read linked roster from disk: ${e.message}`);
    }
    return false;
}

// Generate random stats conforming to game legality rules (forced 0% hint + 3-attribute limit)
function rollStats() {
    const hintIdx = Math.floor(Math.random() * 5);
    const stats = [0, 0, 0, 0, 0];
    
    for (let i = 0; i < 5; i++) {
        if (i === hintIdx) {
            stats[i] = 0; // Forced zero hint
        } else if (i === 4) { // Hit category (0 - 50%)
            stats[i] = Math.floor(Math.random() * 11) * 5;
        } else { // Standard category (0 - 100%)
            stats[i] = Math.floor(Math.random() * 21) * 5;
        }
    }
    
    // Apply PSO BB 3-attribute limit: a weapon cannot have more than 3 non-zero values
    let nonZeroIndices = [];
    for (let i = 0; i < 5; i++) {
        if (stats[i] > 0) nonZeroIndices.push(i);
    }
    
    while (nonZeroIndices.length > 3) {
        const randIdx = Math.floor(Math.random() * nonZeroIndices.length);
        const removeIdx = nonZeroIndices.splice(randIdx, 1)[0];
        stats[removeIdx] = 0;
    }
    
    return {
        stats,
        hint_attribute: CATEGORIES[hintIdx]
    };
}

// Generate an unambiguous alphanumeric token code (excluding easily confused characters like O, 0, I, 1)
function generateTokenId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let token = '';
    for (let i = 0; i < 6; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `T-${token}`;
}

// Generate a new drop puzzle — purely the random attribute/hit percentages.
async function generateDrop() {
    const { stats, hint_attribute } = rollStats();
    const dropId = 'd-' + Date.now();

    const dropData = {
        drop_id: dropId,
        stat_native: stats[0],
        stat_abeast: stats[1],
        stat_machine: stats[2],
        stat_dark: stats[3],
        stat_hit: stats[4],
        hint_attribute: hint_attribute
    };

    await db.createDrop(dropData);
    return dropData;
}

// Broadcast drop announcement embed to the configured channel
async function announceDrop(drop) {
    try {
        const channel = await client.channels.fetch(config.channel_id).catch(() => null);
        if (channel) {
            const embed = {
                title: `🚨 SPECIAL WEAPON DROP: [${MASKED_WEAPON}] 🚨`,
                description: `Scanner indicates **${EMOJIS[drop.hint_attribute]} ${drop.hint_attribute}** is **0%**.\n\n` +
                             `• **Base users**: 5 attempts\n` +
                             `• **Server Boosters**: 8 attempts\n\n` +
                             `*First to map all stats claims the reward token!*\n` +
                             `Use \`/guess [Native] [A.Beast] [Machine] [Dark] [Hit]\` (divisible by 5, Hit ≤ 50%, others ≤ 100%)`,
                color: 0x00ff88 // Vibrant green
            };
            await channel.send({ embeds: [embed] });
        }
    } catch (e) {
        logError('TEKKER', `Failed to broadcast drop announcement: ${e.message}`);
    }
}

// Process user guess and return feedback embed
async function processGuess(message, guessArgs) {
    // Auto-clear the player's guess message after 10s to keep the channel tidy
    // (requires Manage Messages; only in a guild — can't delete others' DMs).
    if (message.guild) {
        setTimeout(() => { message.delete().catch(() => {}); }, 10000);
    }

    // 1. Resolve active drop
    const drop = await db.getActiveDrop();
    if (!drop) {
        return await message.reply("⚠️ There is no active weapon drop puzzle right now. Activity in the server will trigger the scanner to detect a new drop!");
    }

    // 2. Validate guess arguments
    if (!Array.isArray(guessArgs) || guessArgs.length !== 5) {
        return await message.reply(`🗡️ **Usage**: \`/guess [Native] [A.Beast] [Machine] [Dark] [Hit]\` (e.g. \`/guess 0 10 35 0 5\`)`);
    }

    const guesses = guessArgs.map(x => parseInt(x));
    if (guesses.some(isNaN)) {
        return await message.reply("⚠️ Please enter valid integers for all 5 weapon stats.");
    }

    const categories = CATEGORIES;
    const validationErrors = [];
    for (let i = 0; i < 5; i++) {
        const val = guesses[i];
        if (val < 0) {
            validationErrors.push(`${categories[i]} cannot be negative.`);
        }
        if (val % 5 !== 0) {
            validationErrors.push(`${categories[i]} must be divisible by 5.`);
        }
        if (i === 4) { // Hit limit
            if (val > 50) validationErrors.push(`Hit cannot exceed 50%.`);
        } else { // Standard limit
            if (val > 100) validationErrors.push(`${categories[i]} cannot exceed 100%.`);
        }
    }

    if (validationErrors.length > 0) {
        return await message.reply(`⚠️ **Validation failed**:\n${validationErrors.map(e => `• ${e}`).join('\n')}`);
    }

    // 3. Resolve booster status and attempts limits
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    let isBooster = false;
    if (member) {
        const hasRole = member.roles.cache.has(BOOSTER_ROLE_ID);
        const isPremium = member.premiumSince !== null || member.roles.cache.some(r => r.tags && r.tags.premiumSubscriberRole);
        isBooster = hasRole || isPremium;
    }
    const maxAttempts = isBooster ? 8 : 5;

    let playerState = await db.getPlayerState(message.author.id, drop.drop_id);
    let attemptsUsed = playerState ? playerState.attempts_used : 0;

    if (attemptsUsed >= maxAttempts) {
        return await message.reply(`⚠️ You have exhausted your attempts (**${attemptsUsed}/${maxAttempts}**) for this drop. Let other players solve it!`);
    }

    attemptsUsed++;
    await db.upsertPlayerState(message.author.id, drop.drop_id, attemptsUsed, maxAttempts);

    // 4. Compare stats and compile Higher/Lower/Correct feedback
    const trueStats = [drop.stat_native, drop.stat_abeast, drop.stat_machine, drop.stat_dark, drop.stat_hit];
    let correctCount = 0;
    const lines = [];

    for (let i = 0; i < 5; i++) {
        const cat = categories[i];
        const emoji = EMOJIS[cat];
        const gVal = guesses[i];
        const tVal = trueStats[i];
        
        if (cat === drop.hint_attribute) {
            // Hint is locked and always correct
            correctCount++;
            lines.push(`${emoji} **${cat}**: ${gVal}% 🔒 *(Hint)*`);
        } else if (gVal === tVal) {
            correctCount++;
            lines.push(`${emoji} **${cat}**: ${gVal}% ✅ *(Correct)*`);
        } else if (gVal < tVal) {
            lines.push(`${emoji} **${cat}**: ${gVal}% 🔼 *(Higher)*`);
        } else {
            lines.push(`${emoji} **${cat}**: ${gVal}% 🔽 *(Lower)*`);
        }
    }

    // 5. Evaluate win condition
    const isWin = correctCount === 5;
    const resultState = isWin ? 'Win' : (attemptsUsed >= maxAttempts ? 'Loss' : 'In_Progress');
    
    // Log telemetry
    await db.addTelemetryLog(message.author.id, drop.drop_id, guesses, resultState);

    if (isWin) {
        // Deactivate drop
        await db.deactivateDrop(drop.drop_id);
        await db.clearActiveUsers(); // Reset activity points

        // Mint the reward token: owner + the guaranteed stats. No weapon — that's
        // resolved later by the website claim page.
        const tokenId = generateTokenId();
        await db.createToken({
            token_id: tokenId,
            owner_id: message.author.id,
            stat_native: trueStats[0],
            stat_abeast: trueStats[1],
            stat_machine: trueStats[2],
            stat_dark: trueStats[3],
            stat_hit: trueStats[4]
        });

        // Announce win publicly
        const embed = {
            title: `🏆 SPECIAL WEAPON CLAIMED 🏆`,
            description: `🎉 Congratulations **${message.author.username}**! You solved all stats on attempt **${attemptsUsed}/${maxAttempts}**!\n\n` +
                         `*Your token locks in these guaranteed attributes for a **${MASKED_WEAPON}** — redeem it later on the website.*\n\n` +
                         `**Final Stats Resolved**:\n` +
                         `🗡️ Native: **${trueStats[0]}%**\n` +
                         `🐾 A.Beast: **${trueStats[1]}%**\n` +
                         `🤖 Machine: **${trueStats[2]}%**\n` +
                         `👻 Dark: **${trueStats[3]}%**\n` +
                         `🎯 Hit: **${trueStats[4]}%**\n\n` +
                         `🎁 **Reward Token Generated**: \`${tokenId}\`\n\n` +
                         `*Your token is **saved to your account**. In-game claiming is coming soon — use **\`!tokens\`** to view it, or **\`!gift ${tokenId} @PlayerName\`** to gift it!*`,
            color: 0x00c8ff // Vibrant sky blue
        };

        logInfo('TEKKER', `Win: ${message.author.tag} solved stats ${trueStats.join('/')} on attempt ${attemptsUsed}/${maxAttempts} → token ${tokenId}`);

        // Public report (👀 + ping) + the win embed. Sent to the channel (not as a
        // reply) since the player's guess message is auto-deleted.
        await message.channel.send({
            content: `👀 <@${message.author.id}> guessed **right**! 🎉 Solved in ${attemptsUsed}/${maxAttempts} attempts.`,
            embeds: [embed],
            allowedMentions: { parse: [], users: [message.author.id] },
        });
        try {
            await message.author.send(
                `🎉 **You won the Tekker Challenge!**\n` +
                `Here is your reward token: \`${tokenId}\` for a **${MASKED_WEAPON}** with stats **${trueStats.join('/')}**.\n` +
                `• It is **saved to your account** — in-game claiming is coming soon.\n` +
                `• Run \`!tokens\` anytime to see your saved tokens.\n` +
                `• Run \`!gift ${tokenId} @User\` to transfer it to a friend!`
            );
        } catch (e) {
            logWarn('TEKKER', `Could not DM winning token ${tokenId} to ${message.author.tag}: ${e.message}`);
        }
    } else {
        // Send feedback embed
        const embed = {
            author: {
                name: `${message.author.username}'s Attempt (${attemptsUsed}/${maxAttempts})`,
                icon_url: message.author.displayAvatarURL({ dynamic: true })
            },
            description: lines.join('\n') + (attemptsUsed >= maxAttempts ? `\n\n❌ **Attempt Limit Reached.** You cannot guess again for this drop.` : ''),
            color: attemptsUsed >= maxAttempts ? 0xff4444 : 0xffcc00 // Red on exhaust, Yellow otherwise
        };
        // 👀 report line + feedback embed. Sent to the channel (not a reply) since the
        // guess message is auto-deleted; the @mention renders but doesn't ping on
        // every wrong guess.
        const status = attemptsUsed >= maxAttempts
            ? `out of attempts (${attemptsUsed}/${maxAttempts})`
            : `${attemptsUsed}/${maxAttempts} attempts`;
        await message.channel.send({
            content: `👀 <@${message.author.id}> guessed **wrong** — ${status}.`,
            embeds: [embed],
            allowedMentions: { parse: [], users: [] },
        });
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

    // 4. Log active user interaction in SQLite
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
        
        // Generate new drop
        const newDrop = await generateDrop();
        
        // Broadcast drop puzzle
        await announceDrop(newDrop);
    }
}

// Admin: mint a token with explicit stats for a user (DB adjustment). Returns
// { tokenId, stats } or { error }. Validates the same legality the game enforces.
async function adminGrantToken(ownerId, stats) {
    if (!Array.isArray(stats) || stats.length !== 5 || stats.some((n) => !Number.isInteger(n) || n < 0 || n % 5 !== 0)) {
        return { error: 'Stats must be 5 non-negative whole numbers divisible by 5 (Native A.Beast Machine Dark Hit).' };
    }
    if (stats[4] > 50) return { error: 'Hit cannot exceed 50%.' };
    if (stats.slice(0, 4).some((n) => n > 100)) return { error: 'Attributes cannot exceed 100%.' };

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

// Claim a weapon token and drop it at player's feet
async function claimReward(userId, tokenId) {
    const token = await db.getToken(tokenId);
    if (!token) {
        return { success: false, error: `Token \`${tokenId}\` not found.` };
    }
    if (token.owner_id !== userId) {
        return { success: false, error: "You do not own this token." };
    }
    if (token.is_claimed) {
        return { success: false, error: "This token has already been claimed." };
    }

    // Claiming is NOT built yet. The token (owner + guaranteed stats) stays saved
    // and giftable; redemption — and which weapon the stats apply to — will be
    // decided by the future website claim page. Until config.tekker.claim_enabled
    // is turned on (and that page exists, see TEKKER_CLAIM_INTEGRATION.md), report
    // the token as safely saved. The block below is the ready-to-go seam.
    const statString = `${token.stat_native}/${token.stat_abeast}/${token.stat_machine}/${token.stat_dark}/${token.stat_hit}`;
    if (!(config.tekker && config.tekker.claim_enabled)) {
        return {
            success: false,
            pending: true,
            message: `Your **${MASKED_WEAPON}** token \`${tokenId}\` (guaranteed stats **${statString}**) is **saved to your account**. Redemption isn't live yet — you'll be able to claim it once the website claim page ships. Use \`!gift ${tokenId} @player\` to transfer it in the meantime.`,
        };
    }

    if (!isUserLinked(userId)) {
        return { success: false, error: "Your Discord account is not linked. Please sign into https://psobb.io/login and link Discord in your player dashboard first." };
    }

    try {
        // Hand the token (owner + guaranteed stats) to the future claim endpoint;
        // the website decides which weapon the stats apply to.
        const url = config.psobb_api_url + "&action=claim_tekker_drop";
        const resp = await axios.post(url, {
            discord_id: userId,
            token_id: tokenId,
            stats: {
                native: token.stat_native, abeast: token.stat_abeast, machine: token.stat_machine,
                dark: token.stat_dark, hit: token.stat_hit
            }
        }, {
            headers: {
                'Authorization': "Bearer " + config.psobb_api_secret,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        if (resp.data && resp.data.success) {
            await db.markTokenClaimed(tokenId, userId);
            logInfo('TEKKER', `Token ${tokenId} claimed successfully by ${userId}`);
            return { success: true, message: resp.data.message };
        } else {
            const errMsg = resp.data && resp.data.error ? resp.data.error : "Unknown backend error.";
            return { success: false, error: errMsg };
        }
    } catch (e) {
        const status = e.response ? e.response.status : null;
        let detail = e.message;
        if (e.response && e.response.data) {
            const body = typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data);
            detail = body;
            // Extract error message from JSON response if present
            try {
                const parsed = JSON.parse(body);
                if (parsed.error) detail = parsed.error;
            } catch (jsonErr) {}
        }
        logError('API', `claim_tekker_drop${status ? ` [${status}]` : ''} → ${detail}`);
        return { success: false, error: `Pioneer 2 link failed: ${detail}` };
    }
}

module.exports = {
    generateDrop,
    announceDrop,
    processGuess,
    trackActivity,
    giftReward,
    claimReward,
    adminGrantToken,
    isUserLinked,
    MASKED_WEAPON
};
