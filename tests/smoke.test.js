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
const commandsMod = require('../src/commands');
const modelMod = require('../src/model');
const messageHandlerMod = require('../src/messageHandler');
const healthcheckMod = require('../src/healthcheck');

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

// 5. model.js fallback chain, generation config & removed dead exports
assert.strictEqual(modelMod.model, undefined, 'Unused default model export should be removed');
assert.strictEqual(modelMod.genAI, undefined, 'Unused genAI export should be removed');
assert.ok(Array.isArray(modelMod.candidateModelNames) && modelMod.candidateModelNames.length >= 2);
assert.deepStrictEqual(modelMod.buildGenerationConfig('gemini-3.5-flash-lite'), { thinkingConfig: { thinkingLevel: 'MINIMAL' } });
assert.deepStrictEqual(modelMod.buildGenerationConfig('gemma-4-31b-it'), { thinkingConfig: { thinkingLevel: 'MINIMAL' } });
assert.deepStrictEqual(modelMod.buildGenerationConfig('gemini-2.5-flash'), {});

// 6. messageHandler.js Gemini 3/Gemma vs 2.x turn helpers
assert.strictEqual(messageHandlerMod.functionResponseRoleForModel('gemini-2.5-flash'), 'function');
assert.strictEqual(messageHandlerMod.functionResponseRoleForModel('gemini-3.5-flash-lite'), 'user');
assert.strictEqual(messageHandlerMod.functionResponseRoleForModel('gemma-4-31b-it'), 'user');
assert.ok(messageHandlerMod.compute429CooldownMs('PerDay quota exceeded') >= 3600 * 1000);
assert.strictEqual(messageHandlerMod.compute429CooldownMs('{"retryDelay":"12s"}'), 17000);
const sanitized = messageHandlerMod.sanitizeModelParts([
    { thought: true, text: '' },
    { thought: true, thoughtSignature: 'sig123' },
    { functionCall: { name: 'get_server_stats', args: {} } },
]);
assert.strictEqual(sanitized.length, 2);
assert.strictEqual(
    messageHandlerMod.extractResponseText({
        candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, { text: 'visible reply' }] } }],
    }),
    'visible reply'
);

// 7. !quest vs !quests command routing + !trade registration & healthcheck integration
const questEntry = commandsMod.registry.find((e) => e.name === 'quest');
const questsEntry = commandsMod.registry.find((e) => e.name === 'quests');
const tradeEntry = commandsMod.registry.find((e) => e.name === 'trade');
assert.ok(questEntry && questsEntry && tradeEntry);
assert.strictEqual(questEntry.match('!quest'), true);
assert.strictEqual(questEntry.match('$quest check'), true);
assert.strictEqual(questEntry.match('!quests'), false, '!quest must not shadow !quests');
assert.strictEqual(questsEntry.match('!quests'), true);
assert.strictEqual(questsEntry.passthrough, true);
assert.strictEqual(tradeEntry.match('!trade @user T-1 T-2'), true);
assert.strictEqual(healthcheckMod.isFeatureUp('tekker'), true);

(async () => {
    // Clean up any smoke test log side-effect only as needed; verify !quests passthrough dispatches false
    const consumedQuests = await commandsMod.dispatch({ content: '!quests', author: { tag: 'SmokeTest', id: '0' } });
    assert.strictEqual(consumedQuests, false, '!quests should fall through to AI handler');
    const gatedTrade = await healthcheckMod.gateCommand({ content: '!trade @user T-1 T-2', reply: async () => {} });
    assert.strictEqual(gatedTrade, false);
    console.log('ALL SMOKE TESTS PASSED');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
