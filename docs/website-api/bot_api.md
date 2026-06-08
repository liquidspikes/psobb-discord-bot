# Website API — `api/bot_api.php`

> **Canonical source:** `psobb.io-website-public/api/bot_api.php` (separate repo). Edit there, not in the bot repo.

The bot's primary data endpoint. Bearer-authed (legacy `BOT_API_SECRET` **or** a bcrypt `bot_tokens` row). Dispatches on `?action=`.

## Consumed by (bot)
[`api.js`](../modules/api.md) (`apiCall`), [`session.js`](../modules/session.md), [`roleSync.js`](../modules/roleSync.md), [`tools.js`](../modules/tools.md), [`tekkerChallenge.js`](../modules/tekkerChallenge.md) (future `claim_tekker_drop`).

## Actions used by the bot
| Action | Method | Returns | Bot caller |
| --- | --- | --- | --- |
| `link` | POST `username`,`discord_id` | `{success}` / `{error}` | (website link flow) |
| `get_player` | GET `discord_id` | account + `characters[]` (20 slots) + `website_stats` | `get_player_info`, role sync, session |
| `get_events` | GET | active `community_events[]` | `get_server_events` |
| `get_online_players` | GET | `[{account_id,discord_id,name}]` (linked, online) | role-sync tick |
| `get_linked_players` | GET | `[{account_id,discord_id,username}]` (all linked) | `!sync all` |
| `get_lfg` | GET `?since_id` | `{success,latest_id,listings[]}` | [`lfg.js`](../modules/lfg.md) |
| `get_parties` | GET | `{success,parties[]}` with rosters + `discord_id` | [`partyRooms.js`](../modules/partyRooms.md) |

## Character parsing (`get_player`)
- Reads all 20 `.psochar` save slots from newserv's players dir; empty slots returned as `{slot, exists:false}`.
- Parses class/level/section/stats/mats/inventory/quest-flags from the binary save; overlays **live** data for the currently-online slot from `/y/clients`.
- `$CLASS_MAP` (0–11) and `$SECID_MAP` (0–9) decode the binary enums.

## Key behaviors / gotchas
- **Section ID spelling:** `$SECID_MAP` index 1 = single-n **`Greenill`**, and the online overlay normalizes raw newserv `Greennill → Greenill`. This must match [`pso.js`](../modules/pso.md) (`SECTION_ID_NAMES` + `normalizeSectionId`). See `CODE_REVIEW_REPORT.md` bug #2.
- **Class enum:** `$CLASS_MAP` ids 5/10/11 = `RAcaseal`/`FOmar`/`RAmarl` — keep [`pso.js`](../modules/pso.md) `CLASS_ID_MAP` aligned (bug #3).
- Not linked → `{error:"Not linked", queried_discord_id}`. The bot treats `{error}` as a server problem, not "unlinked", except for that exact string.
- Fatal PHP errors are shielded into JSON `{error}` with a 500, so the bot never gets an opaque HTML 500.
- Reached via clean URL too (`.htaccess` rewrites `/api/bot_api` → `.php`); the bot calls the `.php` URL directly with the `?key=` + `&action=` query.
