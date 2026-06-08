# `src/pso.js` — Game-data constants & normalizers

> Pure functions/data shared by session detection and role sync. No side effects, no I/O.

## Responsibility
Canonical PSOBB class/section/level data and the normalizers that turn raw API values into the names the Discord roles use.

## Exports
| Symbol | Description |
| --- | --- |
| `SUBCLASS_TO_MAIN` | 12 subclasses → `Hunter`/`Ranger`/`Force`. |
| `CLASS_ID_MAP` | numeric `class2` id → subclass name. |
| `SECTION_ID_NAMES` | the 10 Section ID names (single-n `Greenill`). |
| `LEVEL_ROLE_NAMES` | `Rookie`, `LVL10`…`LVL200`. |
| `MANAGED_ROLE_NAMES` | lowercased set of every role the bot may manage. |
| `normalizeSectionId(v)` | string/number → canonical Section name or `null`. |
| `normalizeClass(v)` | string/number → subclass name or `null`. |
| `levelRoleName(level)` | level → `Rookie`/`LVL<n>`. |

## Depended on by
[`session`](session.md), [`roleSync`](roleSync.md).

## Key behaviors / gotchas
- `normalizeSectionId` accepts newserv's double-n **`Greennill`** and maps it to single-n `Greenill` (matches the website's other endpoints + the Discord role). See `CODE_REVIEW_REPORT.md` bug #2.
- `CLASS_ID_MAP` is aligned with the website's `bot_api.php $CLASS_MAP` (ids 5/10/11 = `RAcaseal`/`FOmar`/`RAmarl`). The website returns class **names**, so this numeric map is a fallback path. See `CODE_REVIEW_REPORT.md` bug #3.
- `MANAGED_ROLE_NAMES` is the allowlist [`roleSync`](roleSync.md) uses to decide which permission-less roles it may strip — keep it in sync with the roles created on the server.

## Related website endpoints
- [`bot_api.php`](../website-api/bot_api.md) — its `$CLASS_MAP` / `$SECID_MAP` must agree with this file.
