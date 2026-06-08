# Website API — `api/bot_tekker_db.php`

> **Canonical source:** `psobb.io-website-public/api/bot_tekker_db.php` (separate repo). Edit there, not in the bot repo.

The Tekker Challenge storage backend. The bot keeps all game logic and calls this for persistence. Bearer-authed (same scheme as `bot_api.php`). Uses the **SQLite3 extension** against `db/website.db` (consistent with the rest of the site — see `SITE_SQLITE3_USAGE.md`).

## Consumed by (bot)
[`tekkerDb.js`](../modules/tekkerDb.md) — one POST per op.

## Protocol
- Request: `POST` JSON `{ "op": "<operation>", ...params }`.
- Response: `{ "success": true, "result": ... }` or `{ "success": false, "error": ... }`.

## Operations (must match `tekkerDb.js`)
`ping` · `getActiveDrop` · `createDrop` · `deactivateDrop` · `getPlayerState` · `upsertPlayerState` · `addTelemetryLog` · `addActiveUser` · `getActiveUserCount` · `clearActiveUsers` · `getTriggerThreshold` · `setTriggerThreshold` · `createToken` · `getToken` · `getUnclaimedTokens` · `getAllTokens` · `transferToken` · `markTokenClaimed` · `deleteToken` · `setTokenClaimed`.

## Tables (auto-created on first request)
`tekker_active_drops`, `tekker_player_state`, `tekker_telemetry`, `tekker_tokens`, `tekker_active_users`, `tekker_settings`. Schema migrations are isolated to this endpoint so core `db.php` stays untouched.

## Key behaviors / gotchas
- Only one drop is active at a time (`createDrop` deactivates others).
- `getTriggerThreshold` defaults to **30** if unset.
- Adding/renaming an op requires editing **both** this file's `switch ($op)` and [`tekkerDb.js`](../modules/tekkerDb.md).
- Fatal PHP errors are shielded into JSON; the bot logs failures under `TEKKER` and degrades gracefully.
