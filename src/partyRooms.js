// =====================================================================
// PARTY VOICE ROOMS
// Watches live multiplayer game instances (via the website's get_parties bot
// endpoint) and gives each active party its own PRIVATE Discord voice channel,
// visible only to the linked players in that game, the community-support role,
// the bot, and admins (via the Administrator permission). On creation it posts
// an opening ping to the voice channel's built-in text chat tagging the linked
// party members; as each additional linked player joins the game it grants them
// access and posts an "@here <user> has entered" ping. The channel is torn down
// (after a short grace) once the party drops below the minimum linked players
// (min_linked, default 2) — e.g. a duo falling to a single player — and a fresh
// room is reinitialized if the party fills back up. State is persisted so a
// restart doesn't orphan channels.
//
// AUTO-MOVE (party_rooms.auto_move, on by default; needs Move Members): a party
// member sitting in the configured lobby voice channel (party_rooms.lobby_id) is
// pulled into their room on create/join, and moved back to the lobby when they
// leave the party or the room is torn down. Discord can only relocate members who
// are already connected to voice, so players not in the lobby just get the ping.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
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

// Auto-move: pull a party member who is sitting in the LOBBY voice channel into
// their party room when it spawns / they join, and move them back to the lobby
// when they leave the party (or the room is torn down). Discord can only relocate
// a member who is ALREADY connected to voice, so this only affects players in the
// lobby — anyone not in voice just gets the access grant + ping as before.
// Requires the bot to have Move Members. Disable via party_rooms.auto_move:false.
const LOBBY_ID = String(CFG.lobby_id || '1456493542708088941');
const AUTO_MOVE = CFG.auto_move !== false && !!LOBBY_ID;

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

// Best-effort voice move. Relocates `discordId` to `toChannelId` only if they are
// currently connected to `requireFromId` (e.g. the lobby) — passing null requires
// only that they are in some voice channel. Needs the Move Members permission.
// Returns true if a move actually happened.
async function moveMember(guild, discordId, toChannelId, requireFromId = null) {
    if (!AUTO_MOVE || !toChannelId) return false;
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member || !member.voice || !member.voice.channelId) return false; // not in voice
    if (requireFromId && member.voice.channelId !== requireFromId) return false; // not where expected
    if (member.voice.channelId === toChannelId) return false; // already there
    try {
        await member.voice.setChannel(toChannelId, 'PSOBB party room auto-move');
        return true;
    } catch (e) {
        logWarn('PARTY', `Could not move ${discordId} to ${toChannelId} (have Move Members?): ${e.message}`);
        return false;
    }
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
        await channel.send({
            content: msg.slice(0, 1990),
            allowedMentions: { parse: [], users: memberIds },
            flags: [MessageFlags.SuppressNotifications]
        });
    } catch (e) { logWarn('PARTY', `Room ${channel.id} opening ping failed: ${e.message}`); }

    // DM notification to opted-in users
    const { getPrefs } = require('./notificationPrefs');
    for (const id of memberIds) {
        const userPrefs = getPrefs(id);
        if (userPrefs.VC) {
            try {
                const member = await guild.members.fetch(id).catch(() => null);
                if (member) {
                    await member.send({
                        content: `🎮 **Party Room created!** You've been added to the voice channel for game **${party.name || 'Game'}** in the server.`
                    }).catch(() => {});
                }
            } catch (dmErr) {}
        }
    }
    // Pull party members who are waiting in the lobby straight into the new room.
    for (const id of memberIds) {
        if (await moveMember(guild, id, channel.id, LOBBY_ID)) {
            logInfo('PARTY', `Moved ${id} from lobby into room for game ${party.game_id}.`);
        }
    }
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
            flags: [MessageFlags.SuppressNotifications]
        });
    } catch (e) { logWarn('PARTY', `Entry ping failed in ${state.channelId}: ${e.message}`); }

    // DM notification to opted-in room members
    const { getPrefs } = require('./notificationPrefs');
    const otherMembers = (state.members || []).filter(m => m !== discordId);
    for (const memberId of otherMembers) {
        const userPrefs = getPrefs(memberId);
        if (userPrefs.VC) {
            try {
                const member = await channel.guild.members.fetch(memberId).catch(() => null);
                const joiningMember = await channel.guild.members.fetch(discordId).catch(() => null);
                const joiningName = joiningMember ? joiningMember.displayName : 'A player';
                if (member) {
                    await member.send({
                        content: `🔊 **VC Alert:** ${joiningName} has joined your party room for game **${channel.name}**.`
                    }).catch(() => {});
                }
            } catch (dmErr) {}
        }
    }
    // If they're waiting in the lobby, pull them straight into the room.
    if (await moveMember(channel.guild, discordId, state.channelId, LOBBY_ID)) {
        logInfo('PARTY', `Moved ${discordId} from lobby into room ${state.channelId}.`);
    }
    return true;
}

async function teardownRoom(gameId, state) {
    const channel = await client.channels.fetch(state.channelId).catch(() => null);
    if (channel) {
        // Move anyone still sitting in the room back to the lobby BEFORE deleting, so a
        // teardown relocates them instead of disconnecting them from voice entirely.
        if (AUTO_MOVE && LOBBY_ID) {
            for (const m of [...channel.members.values()]) {
                if (m.user.bot) continue;
                await m.voice.setChannel(LOBBY_ID, 'PSOBB party ended — back to lobby')
                    .catch((e) => logWarn('PARTY', `Could not move ${m.id} to lobby on teardown: ${e.message}`));
            }
        }
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
            if (linked.length >= MIN_LINKED) state.emptySince = null; // still a full party → cancel any pending teardown grace
            const known = new Set(state.members || []);
            const linkedSet = new Set(linked);
            // New arrivals: grant access, ping, and (if they're in the lobby) pull them in.
            for (const id of linked) {
                if (known.has(id)) continue;
                if (await addMember(state, id)) {
                    state.members.push(id);
                    logInfo('PARTY', `Added ${id} to room for game ${gid}.`);
                }
            }
            // Departures: someone we'd added is no longer in the party → move them back to
            // the lobby (if they're still in this room) and drop their access. Pruning them
            // from state.members means a later re-join is treated as a fresh arrival. The
            // feed is only consulted here on a successful poll (poll bailed above on error),
            // so a transient feed failure can't yank players out mid-game.
            for (const id of [...(state.members || [])]) {
                if (linkedSet.has(id)) continue;
                await moveMember(guild, id, LOBBY_ID, state.channelId);
                const ch = await client.channels.fetch(state.channelId).catch(() => null);
                if (ch) { try { await ch.permissionOverwrites.delete(id, 'PSOBB left party'); } catch (e) {} }
                state.members = state.members.filter((m) => m !== id);
                logInfo('PARTY', `Moved ${id} back to lobby — left party for game ${gid}.`);
            }
            saveState();
        }

        // 2. Teardown: a room lives only while the party still has at least MIN_LINKED
        //    linked players. Once it's gone or drops BELOW the minimum (e.g. a 2-player
        //    party falling to 1), dissolve the room after the grace window (which
        //    survives brief blips / disconnects). If players climb back to MIN_LINKED
        //    before that, step 1 cancels the grace; if it happens after teardown, a
        //    fresh room is reinitialized by createRoom on a later poll.
        const now = Date.now();
        for (const gid of Object.keys(rooms)) {
            const party = byId.get(gid);
            const belowMin = !party || linkedIdsOf(party).length < MIN_LINKED;
            if (!belowMin) continue;
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
    // Auto-move needs Move Members + a real lobby voice channel to move people to/from.
    if (AUTO_MOVE) {
        if (me && !me.permissions.has(PermissionFlagsBits.MoveMembers)) {
            logWarn('PARTY', 'auto_move is on but I lack the Move Members permission — players will be pinged but not pulled in/out of voice.');
        }
        const lobby = await client.channels.fetch(LOBBY_ID).catch(() => null);
        if (!lobby || lobby.type !== ChannelType.GuildVoice) {
            logWarn('PARTY', `auto_move lobby_id ${LOBBY_ID} is not a voice channel; auto-move will be a no-op until it's fixed.`);
        }
    }
    const supportRole = resolveRole(guild, COMMUNITY_ROLE);
    if (COMMUNITY_ROLE && !supportRole) {
        logWarn('PARTY', `Community-support role "${COMMUNITY_ROLE}" not found; party rooms will be players + admins only.`);
    }

    rooms = loadState();
    await reconcile();
    logInfo('PARTY', `Party rooms active in "${category.name}". Support role: ${supportRole ? supportRole.name : '(none)'}. Interval ${INTERVAL_MS / 1000}s, grace ${GRACE_MS / 1000}s, min linked ${MIN_LINKED}. Auto-move: ${AUTO_MOVE ? `on (lobby ${LOBBY_ID})` : 'off'}. Tracking ${Object.keys(rooms).length} existing room(s).`);
    await pollParties(guild);
    timer = setInterval(() => pollParties(guild), INTERVAL_MS);
}

module.exports = { startPartyRooms };
