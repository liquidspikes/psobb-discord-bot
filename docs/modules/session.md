# `src/session.js` — Current in-game session detection

> Extracts a linked player's active character / Section ID / episode / difficulty from a `get_player` response, to bias drop searches.

## Responsibility
- `extractActiveSession(playerInfo)` — pure parser; returns `{ is_online, difficulty, episode, sectionId, charName, charClass, charLevel }` or `null` when offline.
- `getCurrentPlayerSession(discordId)` — calls `get_player` and parses it if online.

## Exports
| Symbol | Description |
| --- | --- |
| `extractActiveSession(playerInfo)` | Pure extraction from an API payload. |
| `getCurrentPlayerSession(discordId)` | Fetch + extract (online only). |

## Depends on
[`api`](api.md) — `apiCall('get_player')`; [`pso`](pso.md) — `normalizeSectionId`; [`actionLog`](actionLog.md).

## Depended on by
[`messageHandler`](messageHandler.md) — only when a message matches the drop-keyword regex, to inject "CURRENT GAMEPLAY CONTEXT" into the prompt.

## Key behaviors / gotchas
- Tolerant of many field-name casings (`section_id`/`SectionID`/`Section`, etc.) and both string and numeric difficulty/episode.
- Active character resolution: match `LastPlayerName` → active flag → first character.
- Episode normalized to `'1'|'2'|'4'`; difficulty to `Normal|Hard|Very Hard|Ultimate`; anything else → `null`.
- Returns `null` unless `playerInfo.is_online` is truthy.

## Related website endpoints
- [`bot_api.php` — `get_player`](../website-api/bot_api.md).
