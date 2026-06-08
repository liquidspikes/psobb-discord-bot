# Website API — `api/get_drops.php`

> **Canonical source:** `psobb.io-website-public/api/get_drops.php` (separate repo). Edit there, not in the bot repo.

Returns the full server drop tables. **Not** Bearer-authed (public GET); cached server-side (~24h) from newserv's rare-table.

## Consumed by (bot)
[`api.js`](../modules/api.md) `getDropsData()` (cached 30 min bot-side) → [`tools.js`](../modules/tools.md) `search_drops`.

## Request
`GET https://psobb.io/api/get_drops.php`

## Response shape
```json
{ "success": true, "data": [ { "item": "...", "monster": "...", "difficulty": "Ultimate", "section_id": "Skyly", "episode": 1, ... } ] }
```
The bot filters `data` by item/monster/difficulty/section_id/episode in `search_drops` and caps results at 40.

## Key behaviors / gotchas
- Normalizes newserv's `Greennill → Greenill` (single-n) for `section_id` — matches [`pso.js`](../modules/pso.md) and the section role names. So `search_drops`' `section_id` filter should use single-n `Greenill`.
- Item hex codes are mapped to names via `item_map.json`; unmapped entries may appear with raw/Title-cased names.
- If the cache and the upstream both fail, `getDropsData()` bot-side falls back to its last good (expired) cache.
