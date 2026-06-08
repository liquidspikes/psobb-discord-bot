# `src/socialMemory.js` — Per-user social memory

> Reads/writes the bot's long-term notes about each user as a JSON array under `MEMORY_DIR`.

## Responsibility
Persist a per-Discord-ID list of `{ date, note }` observations the AI records about a player.

## Exports
| Symbol | Description |
| --- | --- |
| `getMemoryPath(discordId)` | `MEMORY_DIR/<digits-only id>.json`. |
| `loadSocialMemory(discordId)` | Returns the array (or `[]`). |
| `saveSocialMemory(discordId, arr)` | Writes the array (pretty JSON). |

## Data / files touched
- `MEMORY_DIR/<discordId>.json` — one file per user.

## Depended on by
- [`tools`](tools.md) — `update_social_memory` / `get_social_memory` (caps the array at 20 notes).
- [`messageHandler`](messageHandler.md) — preloads memory into the prompt context (so the model usually doesn't need the tool).

## Key behaviors / gotchas
- IDs are sanitized to digits only before becoming a filename (`replace(/[^0-9]/g,'')`).
- Errors are caught and logged to `console`, never thrown — memory is best-effort.
- The 20-note cap lives in [`tools`](tools.md), not here.
