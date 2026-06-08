# Website API — `api/summary.php`

> **Canonical source:** `psobb.io-website-public/api/summary.php` (separate repo). Edit there, not in the bot repo.

Live server telemetry, proxied from newserv `/y/summary` + `/y/config`.

## Consumed by (bot)
[`tools.js`](../modules/tools.md) `get_server_stats` — `GET https://psobb.io/api/summary` (clean URL; `.htaccess` rewrites to `summary.php`).

## Response shape (fields the bot reads)
```json
{
  "Server": { "ServerName", "Uptime", "ClientCount", "GameCount",
              "BBGlobalEXPMultiplier", "ServerGlobalDropRateMultiplier" },
  "Clients": [ { "Name", "Level", "Class", "SectionID" } ],
  "Games":   [ { "Name", "Mode", "Episode", "Difficulty", "Players", "HasPassword" } ]
}
```

## Key behaviors / gotchas
- When newserv is unreachable it returns a well-formed "Offline" stub (so the tool still parses).
- Strips the newserv `E/B/C` game-name mode prefix and exposes the mode.
- The bot maps these into `online_players` / `active_games` with safe defaults for missing fields.
- Reached via the **extensionless** clean URL — relies on the `.htaccess` rewrite `^([^\.]+)$ → $1.php`.
