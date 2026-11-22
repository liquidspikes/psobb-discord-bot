'use strict';

const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';

// Allow smoke tests to run even in environments without node_modules installed.
const origLoad = Module._load;
const externalStubs = {
    'discord.js': {
        Client: class Client {},
        Partials: { Message: 0, Channel: 1, Reaction: 2 },
        ChannelType: { GuildText: 0, GuildVoice: 2 },
        PermissionFlagsBits: { ViewChannel: 1n, Connect: 2n, SendMessages: 4n, ManageChannels: 8n, Speak: 16n, MoveMembers: 32n },
        MessageFlags: { Ephemeral: 64, SuppressNotifications: 4096 },
        Events: { ClientReady: 'ready', MessageCreate: 'messageCreate' },
    },
    axios: {
        get: async () => ({ data: {} }),
        post: async () => ({ data: {} }),
    },
    '@google/generative-ai': {
        GoogleGenerativeAI: class GoogleGenerativeAI {},
    },
};
Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(externalStubs, request)) {
        try {
            return origLoad.call(this, request, parent, isMain);
        } catch (err) {
            if (err && err.code === 'MODULE_NOT_FOUND') return externalStubs[request];
            throw err;
        }
    }
    return origLoad.call(this, request, parent, isMain);
};

const {
    SECTION_ID_NAMES,
    WEAPON_ATTR_CATEGORIES,
    WEAPON_ATTR_EMOJIS,
    TEKKER_MASKED_WEAPON,
    normalizeSectionId,
    normalizeClass,
    levelRoleName,
    resolveGuildRole,
} = require('../src/pso');
const { readJsonFile, writeJsonFile } = require('../src/jsonStore');
const configMod = require('../src/config');
const roleSync = require('../src/roleSync');
const tekkerChallenge = require('../src/tekkerChallenge');
require('../src/notificationPrefs');
require('../src/tekkerLocalStore');
require('../src/interactions');
require('../src/partyRooms');
require('../src/lfg');
require('../src/socialMemory');
require('../src/commands');

// 1. pso.js shared constants and normalizers
assert.strictEqual(SECTION_ID_NAMES.length, 10);
assert.strictEqual(normalizeSectionId(0), 'Viridia');
assert.strictEqual(normalizeSectionId('9'), 'Whitill');
assert.strictEqual(normalizeSectionId('Greennill'), 'Greenill');
assert.strictEqual(normalizeSectionId('SKYLY'), 'Skyly');
assert.strictEqual(normalizeSectionId(10), null);
assert.strictEqual(normalizeSectionId(null), null);

assert.deepStrictEqual(WEAPON_ATTR_CATEGORIES, ['Native', 'A.Beast', 'Machine', 'Dark', 'Hit']);
for (const cat of WEAPON_ATTR_CATEGORIES) {
    assert.ok(typeof WEAPON_ATTR_EMOJIS[cat] === 'string' && WEAPON_ATTR_EMOJIS[cat].length > 0, `Missing emoji for ${cat}`);
}
assert.strictEqual(TEKKER_MASKED_WEAPON, '❓ SPECIAL WEAPON');
assert.strictEqual(tekkerChallenge.MASKED_WEAPON, TEKKER_MASKED_WEAPON);

assert.strictEqual(normalizeClass(0), 'HUmar');
assert.strictEqual(normalizeClass('fonewearl'), 'FOnewearl');
assert.strictEqual(levelRoleName(5), 'Rookie');
assert.strictEqual(levelRoleName(49), 'LVL40');

// resolveGuildRole (by ID and case-insensitive name)
const roleHunter = { id: '150000000000000001', name: 'Hunter' };
const roleSupport = { id: '150000000000000002', name: 'Community Support' };
const mockRoles = [roleHunter, roleSupport];
const mockGuild = {
    roles: {
        cache: {
            get: (id) => mockRoles.find((r) => r.id === id) || undefined,
            find: (fn) => mockRoles.find(fn) || undefined,
        },
    },
};
assert.strictEqual(resolveGuildRole(mockGuild, '150000000000000001'), roleHunter);
assert.strictEqual(resolveGuildRole(mockGuild, 'community support'), roleSupport);
assert.strictEqual(resolveGuildRole(mockGuild, 'MissingRole'), null);
assert.strictEqual(resolveGuildRole(null, 'Hunter'), null);

// 2. config.js ONLINE_ROLE_ID centralized default
assert.strictEqual(typeof configMod.ONLINE_ROLE_ID, 'string');
assert.ok(configMod.ONLINE_ROLE_ID.length > 0);

// 3. jsonStore.js read/write roundtrip & corruption/missing fallbacks
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psobb-bot-test-'));
try {
    const missingPath = path.join(tmpDir, 'missing.json');
    const fallbackTemplate = { count: 0 };
    const missingRead = readJsonFile(missingPath, fallbackTemplate, 'Test');
    assert.deepStrictEqual(missingRead, { count: 0 });
    missingRead.count = 99;
    assert.deepStrictEqual(fallbackTemplate, { count: 0 }, 'Fallback template must not be mutated');

    const corruptPath = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(corruptPath, '{not valid json');
    assert.deepStrictEqual(readJsonFile(corruptPath, () => ({ recovered: true }), 'Test'), { recovered: true });

    const roundtripPath = path.join(tmpDir, 'nested', 'state.json');
    assert.strictEqual(writeJsonFile(roundtripPath, { ok: true, items: [1, 2, 3] }, 'Test'), true);
    assert.strictEqual(fs.existsSync(`${roundtripPath}.tmp`), false);
    assert.deepStrictEqual(readJsonFile(roundtripPath, {}, 'Test'), { ok: true, items: [1, 2, 3] });
} finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
}

// 4. roleSync.isUserLinked re-exported cleanly via tekkerChallenge
assert.strictEqual(typeof roleSync.isUserLinked, 'function');
assert.strictEqual(typeof tekkerChallenge.isUserLinked, 'function');
assert.strictEqual(tekkerChallenge.isUserLinked('999999999999999999'), false);

console.log('ALL SMOKE TESTS PASSED');
