# `bot.js` — Entry point

> Wires Discord gateway events to the feature modules and logs the client in. Contains no business logic itself.

## Responsibility
- Set IPv4-first DNS resolution (`dns.setDefaultResultOrder('ipv4first')`) and attach global `unhandledRejection` / `uncaughtException` guards (`actionLog`).
- Register message, reaction, and slash-command handlers (`registerMessageHandlers()`), then on `ClientReady`:
  1. Register guild/global slash commands (`/guess`, `/notify`).
  2. `initDb()` — connectivity + capability check for Tekker storage (with optional auto-local fallback).
  3. `selfCheck()` — boot integrity gate for the role-sync hot path; result is logged and DMed to admins.
  4. `runStartupChecks()` — [dependency health check](healthcheck.md); the summary is folded into the admin DM. Each feature start below is guarded by `isFeatureUp(...)`.
  5. Resolve the target guild (from `role_sync.guild_id` → `channel_id`'s guild → first guild).
  6. `announceStartup(guild, selfCheckResult, healthSummary)`, `startRoleSync(guild)` **if `isFeatureUp('role_sync')`**, `startPartyRooms(guild)` **if `isFeatureUp('party_rooms')`**, and `startDespawnWatcher()` **if `isFeatureUp('tekker')`**.
  7. Start the **voice-activity tracking loop** (`setInterval`, 60s) **if `isFeatureUp('tekker')`**: scans guild voice channels (`c && ...` null-safe) and feeds active, non-bot, non-muted members in multi-person channels to `trackActivity(..., 'voice')`.
  8. `startLfgWatcher()` **if `isFeatureUp('lfg')`**.
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
- [`healthcheck`](healthcheck.md) — `runStartupChecks`, `isFeatureUp`.

## Key behaviors / gotchas
- The bot logs in at the very end with `client.login(config.bot_token)`; if config fails to load, [`config`](config.md) throws first.
- The voice loop polls every 60s — it does not use presence events, so it depends on the **Server Members** intent and a populated channel/member cache.
- Guild resolution is defensive: a missing `role_sync.guild_id` still works as long as `channel_id` resolves to a guild.
