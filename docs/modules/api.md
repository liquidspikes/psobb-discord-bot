# `src/api.js` — PSOBB server API + drops cache

> Thin HTTP layer over the website's bot API, plus a 30-minute cache of the drop tables.

## Responsibility
- `apiCall(action, params)` — GET `config.psobb_api_url&action=<action>&...params`, Bearer-authed with `psobb_api_secret`. Returns parsed JSON, or `{ error: "Service unavailable" }` on failure.
- `getDropsData()` — GET `https://psobb.io/api/get_drops.php`, cached 30 min; falls back to expired cache on fetch failure.

## Exports
| Symbol | Description |
| --- | --- |
| `apiCall(action, params={})` | Generic authed call to `bot_api.php` actions. |
| `getDropsData()` | Cached drop-table array. |

## Depends on
[`config`](config.md), [`actionLog`](actionLog.md), `axios`.

## Depended on by
[`session`](session.md), [`roleSync`](roleSync.md), [`tools`](tools.md), [`lfg`](lfg.md), [`partyRooms`](partyRooms.md).

## Key behaviors / gotchas
- **Successful calls are not logged** (only failures), by design — the role-sync tick calls `get_player` for every roster member each cycle.
- 5s timeout on `apiCall`, 15s on drops.
- On HTTP error it captures the server's status + body (first 300 chars) so 5xx responses are self-diagnosing in the log.
- Params with falsy values are skipped in the query string.

## Related website endpoints
- [`bot_api.php`](../website-api/bot_api.md) — every `apiCall` action.
- [`get_drops.php`](../website-api/get_drops.md) — `getDropsData`.
