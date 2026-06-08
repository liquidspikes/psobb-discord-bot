# `bot.js` — Entry point

> Wires Discord gateway events to the feature modules and logs the client in. Contains no business logic itself.

## Responsibility
- Register message handlers, then on `ClientReady`:
  1. `initDb()` — connectivity check to the Tekker storage endpoint.
  2. `selfCheck()` — boot integrity gate for the role-sync hot path; result is logged and DMed to admins.
  3. Resolve the target guild (from `role_sync.guild_id` → `channel_id`'s guild → first guild).
  4. `startRoleSync(guild)`, `announceStartup(guild, selfCheckResult)`, `startPartyRooms(guild)`.
  5. Start the **voice-activity tracking loop** (`setInterval`, 60s): scans guild voice channels and feeds active, non-bot, non-muted members in multi-person channels to `trackActivity(..., 'voice')`.
  6. `startLfgWatcher()`.
- Each subsystem is wrapped in its own `try/catch` so one failing can't take down the others.

## Exports
None (executable entry point). `package.json` `main`/`start` → `node bot.js`.

## Depends on
- [`config`](config.md) — `bot_token`, `role_sync`, `channel_id`.
- [`discordClient`](discordClient.md) — the `client`.
- [`roleSync`](roleSync.md) — `startRoleSync`, `selfCheck`.
- [`lfg`](lfg.md) — `startLfgWatcher`.
- [`partyRooms`](partyRooms.md) — `startPartyRooms`.
- [`messageHandler`](messageHandler.md) — `registerMessageHandlers`.
- [`actionLog`](actionLog.md) — `logInfo/logWarn/logError`.
- [`system`](system.md) — `announceStartup`.
- [`tekkerDb`](tekkerDb.md) — `initDb`; [`tekkerChallenge`](tekkerChallenge.md) — `trackActivity`.

## Key behaviors / gotchas
- The bot logs in at the very end with `client.login(config.bot_token)`; if config fails to load, [`config`](config.md) throws first.
- The voice loop polls every 60s — it does not use presence events, so it depends on the **Server Members** intent and a populated channel/member cache.
- Guild resolution is defensive: a missing `role_sync.guild_id` still works as long as `channel_id` resolves to a guild.
