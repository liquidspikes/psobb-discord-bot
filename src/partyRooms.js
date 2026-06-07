// =====================================================================
// PARTY VOICE ROOMS
// Watches live multiplayer game instances (via the website's get_parties bot
// endpoint) and gives each active party its own PRIVATE Discord voice channel,
// visible only to the linked players in that game, the community-support role,
// the bot, and admins (via the Administrator permission). On creation it posts
// an opening ping to the voice channel's built-in text chat tagging the linked
// party members; as each additional linked player joins the game it grants them
// access and posts an "@here <user> has entered" ping. The channel is torn down
// (after a short grace) once the party empties of linked players. State is
// persisted so a restart doesn't orphan channels.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { config, MEMORY_DIR } = require('./config');
const { client } = require('./discordClient');
const { apiCall } = require('./api');
const { logInfo, logWarn, logError } = require('./actionLog');

const CFG = config.party_rooms || {};
// Category to create the temp voice channels under. Configurable; falls back to
// the provided #PSOBB party-rooms category id.
const CATEGORY_ID = String(CFG.category_id || '1456493542708088940');
// Role (id or name) that can see/join every party room. Configurable; falls back
// to the "Community Support" role id.
const COMMUNITY_ROLE = String(CFG.community_support_role || '1508563507690471514');
const INTERVAL_MS = Math.max(15, CFG.interval_seconds || 25) * 1000;
const GRACE_MS = Math.max(10, CFG.grace_seconds || 60) * 1000;       // empty-party grace before delete
const MIN_LINKED = Math.max(1, CFG.min_linked || 2);                 // linked players needed to spawn a room

const STATE_PATH = path.join(MEMORY_DIR, 'party_rooms.json');

// game_id -> { channelId, members: [discordId already granted/pinged], emptySince: ms|null }
let rooms = {};
function loadState() {
    try {
        if (fs.existsSync(STATE_PATH)) {
            const obj = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
            if (obj && typeof obj === 'object') return obj;
        }
    } catch (e) { logError('PARTY', `State load error: ${e.message}`); }
    return {};
}
function saveState() {
    try {
        fs.writeFileSync(STATE_PATH, JSON.stringify(rooms, null, 2));
    } catch (e) { logError('PARTY', `State save error: ${e.message}`); }
}

function resolveRole(guild, idOrName) {
    if (!idOrName) return null;
    return guild.roles.cache.get(idOrName)
        || guild.roles.cache.find((r) => r.name.toLowerCase() === String(idOrName).toLowerCase())
        || null;
}

// Unique discord ids of the linked players currently in a party.
function linkedIdsOf(party) {
    const set = new Set();
    for (const p of (party.players || [])) {
        if (p && p.discord_id) set.add(String(p.discord_id));
    }
    return [...set];
}

function buildOverwrites(guild, memberIds) {
    const overwrites = [
        // @everyone: invisible + can't join.
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
        // The bot itself, so it can post and manage the channel.
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
    ];
    const supportRole = resolveRole(guild, COMMUNITY_ROLE);
    if (supportRole) {
        overwrites.push({ id: supportRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.SendMessages] });
    }
    for (const id of memberIds) {
        overwrites.push({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.SendMessages] });
    }
    return overwrites;
}

async function createRoom(guild, party) {
    const memberIds = linkedIdsOf(party);
    const name = `🎮 ${party.name || 'Party'}`.slice(0, 100);
    let channel;
    try {
        channel = await guild.channels.create({
            name,
            type: ChannelType.GuildVoice,
            parent: CATEGORY_ID,
            permissionOverwrites: buildOverwrites(guild, memberIds),
            reason: `PSOBB party room for game ${party.game_id}`,
        });
    } catch (e) {
        logWarn('PARTY', `Could not create room for game ${party.game_id}: ${e.message}`);
        return;
    }
    // Persist BEFORE pinging so a crash mid-create can't orphan the channel.
    rooms[party.game_id] = { channelId: channel.id, members: memberIds, emptySince: null };
    saveState();

    const detail = [party.difficulty, party.episode, party.mode && party.mode !== 'Normal' ? party.mode : null].filter(Boolean).join(' · ');
    const mentions = memberIds.map((id) => `<@${id}>`).join(' ');
    let msg = `🎮 **Party up!** A multiplayer game **${party.name || 'Game'}**${detail ? ` (${detail})` : ''} is live.\n`;
    msg += `${mentions} — you're in this game. This private room is just for your party (+ community support). Jump in! 🔊`;
    try {
        await channel.send({ content: msg.slice(0, 1990), allowedMentions: { parse: [], users: memberIds } });
    } catch (e) { logWarn('PARTY', `Room ${channel.id} opening ping failed: ${e.message}`); }
    logInfo('PARTY', `Created room "${name}" for game ${party.game_id} with ${memberIds.length} linked player(s).`);
}

async function addMember(state, discordId) {
    const channel = await client.channels.fetch(state.channelId).catch(() => null);
    if (!channel) return false;
    try {
        await channel.permissionOverwrites.edit(discordId, {
            ViewChannel: true, Connect: true, Speak: true, SendMessages: true,
        });
    } catch (e) {
        logWarn('PARTY', `Could not grant access to ${discordId} in ${state.channelId}: ${e.message}`);
        return false;
    }
    try {
        await channel.send({
            content: `@here the user <@${discordId}> has entered the game and been added to the channel.`,
            allowedMentions: { parse: ['everyone'], users: [discordId] },
        });
    } catch (e) { logWarn('PARTY', `Entry ping failed in ${state.channelId}: ${e.message}`); }
    return true;
}

async function teardownRoom(gameId, state) {
    const channel = await client.channels.fetch(state.channelId).catch(() => null);
    if (channel) {
        try { await channel.delete('PSOBB party ended'); }
        catch (e) { logWarn('PARTY', `Could not delete room ${state.channelId}: ${e.message}`); }
    }
    delete rooms[gameId];
    saveState();
    logInfo('PARTY', `Tore down party room for game ${gameId}.`);
}

async function pollParties(guild) {
    try {
        const data = await apiCall('get_parties');
        if (!data || data.error || data.success !== true) return; // apiCall logs API errors
        const parties = Array.isArray(data.parties) ? data.parties : [];
        const byId = new Map(parties.map((p) => [String(p.game_id), p]));

        // 1. Active parties: spawn rooms and add newly-arrived linked members.
        for (const party of parties) {
            const gid = String(party.game_id);
            const linked = linkedIdsOf(party);
            const state = rooms[gid];

            if (!state) {
                if (linked.length >= MIN_LINKED) await createRoom(guild, party);
                continue;
            }
            if (linked.length > 0) state.emptySince = null; // still active → cancel any grace
            const known = new Set(state.members || []);
            for (const id of linked) {
                if (known.has(id)) continue;
                if (await addMember(state, id)) {
                    state.members.push(id);
                    logInfo('PARTY', `Added ${id} to room for game ${gid}.`);
                }
            }
            saveState();
        }

        // 2. Teardown: rooms whose party is gone or has no linked members left,
        //    after the grace window (survives brief blips / disconnects).
        const now = Date.now();
        for (const gid of Object.keys(rooms)) {
            const party = byId.get(gid);
            const empty = !party || linkedIdsOf(party).length === 0;
            if (!empty) continue;
            const state = rooms[gid];
            if (!state.emptySince) { state.emptySince = now; saveState(); continue; }
            if (now - state.emptySince >= GRACE_MS) await teardownRoom(gid, state);
        }
    } catch (e) {
        logError('PARTY', `Poll error: ${e.message}`);
    }
}

// Drop persisted entries whose channel no longer exists; the next poll handles
// teardown of rooms whose game has since ended.
async function reconcile() {
    for (const gid of Object.keys(rooms)) {
        const ch = await client.channels.fetch(rooms[gid].channelId).catch(() => null);
        if (!ch) delete rooms[gid];
    }
    saveState();
}

let timer = null;
async function startPartyRooms(guild) {
    if (CFG.enabled === false) { logInfo('PARTY', 'Disabled via config.'); return; }
    if (!CATEGORY_ID) { logWarn('PARTY', 'No party_rooms.category_id configured; party rooms not started.'); return; }

    const category = await client.channels.fetch(CATEGORY_ID).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
        logWarn('PARTY', `party_rooms.category_id ${CATEGORY_ID} is not a category channel; party rooms not started.`);
        return;
    }
    if (guild.roles.cache.size <= 1) await guild.roles.fetch().catch(() => {});
    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (me && !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        logWarn('PARTY', 'I am missing the Manage Channels permission — I cannot create party rooms until that is granted.');
    }
    const supportRole = resolveRole(guild, COMMUNITY_ROLE);
    if (COMMUNITY_ROLE && !supportRole) {
        logWarn('PARTY', `Community-support role "${COMMUNITY_ROLE}" not found; party rooms will be players + admins only.`);
    }

    rooms = loadState();
    await reconcile();
    logInfo('PARTY', `Party rooms active in "${category.name}". Support role: ${supportRole ? supportRole.name : '(none)'}. Interval ${INTERVAL_MS / 1000}s, grace ${GRACE_MS / 1000}s, min linked ${MIN_LINKED}. Tracking ${Object.keys(rooms).length} existing room(s).`);
    await pollParties(guild);
    timer = setInterval(() => pollParties(guild), INTERVAL_MS);
}

module.exports = { startPartyRooms };
