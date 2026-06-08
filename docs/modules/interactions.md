# `src/interactions.js` — Interaction log & lurker badges

> Tracks whether each user has messaged/reacted recently; drives the 👀 (lurker) vs 💠 (active) nickname badge in role sync.

## Responsibility
- Persist a `{ discordId: lastInteractionMs }` map.
- `markInteracted` on each message/reaction (throttled writes).
- Expose active/lurker state to [`roleSync`](roleSync.md) and the `!interactions` admin command.

## Exports
| Symbol | Description |
| --- | --- |
| `hasInteracted(id)` | `true` if last interaction ≤ 2 weeks ago. |
| `isKnown(id)` | `true` if the id has any entry. |
| `markInteracted(id)` | Set/refresh the timestamp (throttled). |
| `buildLog(memberIds)` | Census: add missing members as `0` (never interacted). |
| `stats()` | `{ total, interacted, lurkers }`. |
| `handleInteractionsCommand(message)` | `!interactions [build|check @user]` (admin). |
| `INTERACTIONS_PATH` | Path to the JSON store. |

## Data / files touched
- `MEMORY_DIR/interactions.json` — `{ id: timestampMs }` (legacy booleans are migrated on load).

## Constants
- `TWO_WEEKS_MS` (active window), `ONE_HOUR_MS` (write throttle).

## Depended on by
[`roleSync`](roleSync.md) (`hasInteracted` → badge), [`messageHandler`](messageHandler.md) (`markInteracted`).

## Key behaviors / gotchas
- Write throttling: if a user is already active and was updated <1h ago, `markInteracted` skips the disk write (prevents thrashing).
- "Active" is a rolling 2-week window — a previously-active user reverts to 👀 lurker after 2 weeks of silence until their next interaction.
