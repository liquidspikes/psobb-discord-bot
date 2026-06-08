# `src/tekkerDb.js` — Tekker storage client

> HTTP client for the Tekker store. The bot holds NO local database; this forwards every op to the website's `bot_tekker_db.php`.

## Responsibility
`call(op, params)` POSTs `{ op, ...params }` (Bearer-authed) and returns `result` (or `null` on failure). Thin typed wrappers expose each op; the export surface mirrors a local-DB module so callers are storage-agnostic.

## Exports (ops)
`initDb` (ping) · `getActiveDrop` · `createDrop` · `deactivateDrop` · `getPlayerState` · `upsertPlayerState` · `addTelemetryLog` · `addActiveUser` · `getActiveUserCount` · `clearActiveUsers` · `getTriggerThreshold` · `setTriggerThreshold` · `createToken` · `getToken` · `getUnclaimedTokens` · `getAllTokens` · `transferToken` · `markTokenClaimed` · `deleteToken` · `setTokenClaimed`.

## Endpoint resolution
`TEKKER_DB_URL` = `config.tekker_db_url` **or** `config.psobb_api_url` with `bot_api.php` → `bot_tekker_db.php`.

## Depends on
[`config`](config.md), [`actionLog`](actionLog.md), `axios`.

## Depended on by
[`tekkerChallenge`](tekkerChallenge.md), [`messageHandler`](messageHandler.md) (`!tekker`/`!tokens` admin paths), [`bot.js`](bot.md) (`initDb`).

## Key behaviors / gotchas
- 8s timeout; failures log to `TEKKER` and return `null`/`[]`/sensible defaults (e.g. threshold falls back to 30), so the minigame degrades instead of crashing.
- The **server op names here must exactly match** the `switch ($op)` cases in `bot_tekker_db.php`. Adding an op means editing both files.

## Related website endpoints
- [`bot_tekker_db.php`](../website-api/bot_tekker_db.md) — the 1:1 op contract.
