# `src/tekkerLocalStore.js` — Local Tekker store (test mode)

> An in-process JS port of every `bot_tekker_db.php` op, backed by a JSON file. Lets the **full Tekker game run with no website** — for testing the `/guess` mechanics + token lifecycle before the website PR that adds the new ops is merged & deployed.

## When it's used
Only when [`tekkerDb`](tekkerDb.md) is in **local mode** — `config.tekker.local_mode: true` **or** env `TEKKER_LOCAL_MODE=1` (`true`/`yes`/`on` also accepted). **Default off**: production always talks to the website endpoint. In local mode `tekkerDb.call()` dispatches here synchronously and the health probe (`pingDetailed`) reports the feature as up.

## Storage
- `MEMORY_DIR/tekker_local.json` — `{ seq, drops[], playerState[], telemetry[], activeUsers[], settings{}, tokens[], claimLog[] }`. Loaded once, rewritten after every mutating op. Delete the file to reset the test world.

## Exports
| Symbol | Description |
| --- | --- |
| `dispatch(op, params)` | Synchronous `switch($op)` equivalent; returns the same `result` value the HTTP path returns. Throws on an unknown op. |

## Parity with `bot_tekker_db.php`
Faithfully mirrors the website logic so behaviour matches the real backend:
- **Roll** (`createDrop`): 2 random locked zeros, one as the public hint; non-zero cats = `base 15–80 + ±10 variance`, clamped **0–90**.
- **Shifts** (`shiftActiveDropStats`, `incrementDropGuesses` → reroll at ≥12 guesses), **second-zero** (`discoverSecondZero`), **despawn pulse** (`pulseDespawnTime`: +30m/guess, capped +8h from spawn).
- **Tokens**: `createToken`/`getToken`/`getUnclaimedTokens`/`getAllTokens`/`transferToken`/`markTokenClaimed`/`deleteToken` — case-**sensitive** id match with whitespace trim (callers already upper-case ids), newest-first ordering.
- Timestamps written as `YYYY-MM-DD HH:MM:SS` (local), the same format the bot parses for spawn/despawn.

## Limitations (by design)
- **`getClaimLog` is always empty.** Weapon redemption (combining tokens into an item) happens on the **website** player dashboard (`claim_tekker_drop.php`), which the bot can't replicate — so no claim-log rows are produced locally.
- Won tokens are **local test tokens** that live only in this JSON file; they do **not** exist on the live website. [`tekkerChallenge`](tekkerChallenge.md) surfaces this to players (a "🧪 TEST MODE" field on the drop announcement and a notice on every win) so no one mistakes them for real rewards.

## Depended on by
[`tekkerDb`](tekkerDb.md) (only when local mode is on; required lazily so production never loads it).

## Related
- [`tekkerDb`](tekkerDb.md) — the router that chooses local vs website.
- [`bot_tekker_db.php`](../website-api/bot_tekker_db.md) — the canonical implementation this ports.
