# `src/tekkerDb.js` — Tekker storage client

> HTTP client for the Tekker store. The bot holds NO local database; this forwards every op to the website's `bot_tekker_db.php`.

## Responsibility
`call(op, params)` POSTs `{ op, ...params }` (Bearer-authed) and returns `result` (or `null` on failure). Thin typed wrappers expose each op; the export surface mirrors a local-DB module so callers are storage-agnostic.

## Exports (ops)
`initDb` (ping) · `getActiveDrop` · `createDrop` · `deactivateDrop` · `shiftActiveDropStats` · `incrementDropGuesses` · `discoverSecondZero` · `pulseDespawnTime` · `getPlayerState` · `upsertPlayerState` · `addTelemetryLog` · `addActiveUser` · `getActiveUserCount` · `clearActiveUsers` · `getTriggerThreshold` · `setTriggerThreshold` · `createToken` · `getToken` · `getUnclaimedTokens` · `getAllTokens` · `getClaimLog` · `transferToken` · `markTokenClaimed` · `deleteToken`.

Also exports **`ping()`** — a raw `ping` op (no logging) used by [`healthcheck`](healthcheck.md) to probe the tekker store at boot.

## Endpoint resolution
`TEKKER_DB_URL` = `config.tekker_db_url` **or** `config.psobb_api_url` with `bot_api.php` → `bot_tekker_db.php`.

## Local test mode (+ auto-fallback)
When in **local mode**, `call()` dispatches **synchronously** to [`tekkerLocalStore`](tekkerLocalStore.md) instead of POSTing, and `pingDetailed()` returns `{ok:true}` so the tekker feature stays enabled. This lets the whole `/guess` game (including ops the deployed site lacks) run with **no website**. Two triggers:

1. **Explicit:** `config.tekker.local_mode: true` or env `TEKKER_LOCAL_MODE=1`/`true`/`yes`/`on`.
2. **Auto-fallback (default ON; disable with `config.tekker.auto_local_fallback: false`):** at boot, `initDb()` runs a **capability probe** — `probeCapable()` — that doesn't just ping but exercises a *new* op (`discoverSecondZero` with a sentinel drop id: a single zero-row `UPDATE`, no side effect). If the live endpoint is **unreachable** OR **reachable-but-out-of-date** (returns "Unknown op", as an un-migrated deploy does), it calls `enableLocalFallback()` and flips to the local store for the session. (A plain `ping` can't detect "out of date" because the `ping` op is old — hence the capability probe.)

**`LOCAL_MODE`** is exported as a **live getter** (reflects post-fallback state) so [`tekkerChallenge`](tekkerChallenge.md) warns players that won tokens are local test tokens, and [`healthcheck`](healthcheck.md)'s `!health` flags the tekker line as a LOCAL test store. Default off — a healthy, up-to-date website always uses the live endpoint.

## Depends on
[`config`](config.md), [`actionLog`](actionLog.md), `axios`.

## Depended on by
[`tekkerChallenge`](tekkerChallenge.md), [`commands`](commands.md) (`!tekker`/`!tokens`/`!trade` paths read tokens + `getClaimLog` directly), [`bot.js`](bot.md) (`initDb`).

## Key behaviors / gotchas
- 8s timeout; failures return `null`/`[]`/sensible defaults (e.g. threshold falls back to 30), so the minigame degrades instead of crashing.
- **Circuit-breaker logging:** the scanner hits `call()` on every message, so errors are de-duplicated — it logs `TEKKER` **once** when the store first goes down, stays silent while it's down, and logs once on recovery (instead of one error per op per message). Successful ops never log. The `ping` op is excluded from the breaker (healthcheck/initDb do their own logging).
- The **server op names here must exactly match** the `switch ($op)` cases in `bot_tekker_db.php`. Adding an op means editing both files.
- The drop-mechanics ops (`shiftActiveDropStats`, `incrementDropGuesses`, `discoverSecondZero`, `pulseDespawnTime`) drive the slash `/guess` game; `getClaimLog` returns the claimed-rewards history (claimed tokens are deleted from the live token table — see [`bot_tekker_db`](../website-api/bot_tekker_db.md)).

## Related website endpoints
- [`bot_tekker_db.php`](../website-api/bot_tekker_db.md) — the 1:1 op contract.
