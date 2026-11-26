# `src/jsonStore.js` — Shared JSON file persistence

> Safely loads and atomically writes JSON state files across `MEMORY_DIR`, preventing partial-write corruption and fallback-template mutation.

## Responsibility
- Read JSON files with fallback cloning (object templates are deep-cloned via `JSON.parse(JSON.stringify(...))` or computed via a function so callers never mutate a shared default).
- Write JSON atomically by writing `<filePath>.tmp` (creating parent directories if needed) and renaming into place.
- Log load/save errors through [`actionLog`](actionLog.md) when `actionLog` is available (tolerating early-require cycles before `actionLog` finishes initializing).

## Exports
| Symbol | Description |
| --- | --- |
| `readJsonFile(filePath, defaultValue = null, label = 'JSONStore')` | Load and parse `filePath`, returning a cloned/computed fallback if missing, empty, or invalid JSON. |
| `writeJsonFile(filePath, data, label = 'JSONStore')` | Atomically write pretty-printed JSON (`2`-space indent) via `<filePath>.tmp` rename; returns `boolean`. |

## Depends on
[`actionLog`](actionLog.md) (guarded lazy fallback if unset during load), `fs`, `path`.

## Depended on by
[`roleSync`](roleSync.md), [`interactions`](interactions.md), [`lfg`](lfg.md), [`partyRooms`](partyRooms.md), [`notificationPrefs`](notificationPrefs.md), [`socialMemory`](socialMemory.md), [`tekkerLocalStore`](tekkerLocalStore.md).

## Key behaviors / gotchas
- `writeJsonFile` leaves no `.tmp` artifact behind on success (`tests/smoke.test.js` covers both round-trip atomicity and corrupted-file recovery).
- Always pass a factory function `() => ({ ... })` or plain JSON-serializable default for `defaultValue`; passing `defaultValue` preserves caller-template isolation across calls.
