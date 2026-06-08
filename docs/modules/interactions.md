# `src/interactions.js` — Interaction log & lurker badges

> Tracks when each user last messaged/reacted, classifies unlinked members into lurker tiers (👀/⚠️👀/❗👀), and (via the `!interactions` command) owns the entire lurker-badge lifecycle. Fully separated from `!sync`, which handles linked players (💠) only.

## Responsibility
- Persist a `{ discordId: lastInteractionMs }` map plus guild `meta` (`lastFullScanAt`).
- `markInteracted` on each message/reaction (throttled writes).
- Classify members via `lurkerTier(id)` and expose it to [`roleSync`](roleSync.md).
- `!interactions build [deep]` = scan history → census log → apply the lurker badges (by calling [`roleSync`](roleSync.md)'s `runLurkerPass` via a lazy require).

## Exports
| Symbol | Description |
| --- | --- |
| `hasInteracted(id)` | `true` if last interaction ≤ 2 weeks ago. |
| `isKnown(id)` | `true` if the id has any entry. |
| `lurkerTier(id)` | `'active'` / `'eyes'` (14–45d) / `'warn'` (45d+) / `'never'` (needs a full scan). |
| `markInteracted(id)` | Set/refresh the timestamp (throttled). |
| `recordInteractionAt(id, ts)` | Keep the newest timestamp (used by the bulk scan; no disk write). |
| `scanGuildHistory(guild, {sinceMs,perChannelCap,full})` | Back-fill the log from message history; `full` scans to the server's beginning and stamps `meta.lastFullScanAt`. |
| `buildLog(memberIds)` | Census: add missing members as `0` (never interacted). |
| `stats()` | `{ total, interacted, lurkers }`. |
| `handleInteractionsCommand(message)` | `!interactions [build [deep] | check @user]`. |
| `INTERACTIONS_PATH` | Path to the JSON store. |

## Data / files touched
- `MEMORY_DIR/interactions.json` — wrapped `{ users: { id: timestampMs }, meta: { lastFullScanAt } }` (legacy flat `{ id: ts }` map + booleans are migrated on load).

## Constants
- `TWO_WEEKS_MS` (active window / 👀 lower bound), `FORTY_FIVE_DAYS_MS` (⚠️ threshold), `ONE_HOUR_MS` (write throttle).

## Depended on by
[`roleSync`](roleSync.md) (`lurkerTier` → badge tier; and `!interactions build` lazy-requires `roleSync.runLurkerPass` to apply the badges), [`messageHandler`](messageHandler.md) (`markInteracted`).

## Key behaviors / gotchas
- **Separation:** `!sync all` no longer scans history or applies eyes — that is entirely `!interactions build`. Linked players (💠) are `!sync`'s job.
- **Reactions are live-only:** `scanGuildHistory` back-fills MESSAGE history; historical reactions aren't scannable at scale, so reactions count only from live `markInteracted`.
- **❗ requires a deep scan:** without `meta.lastFullScanAt`, a no-record member caps at ⚠️ (`lurkerTier` can't prove "never" without a full scan). `!interactions build deep` sets it.
- Write throttling: if a user is already active and was updated <1h ago, `markInteracted` skips the disk write (prevents thrashing).
- "Active" is a rolling 2-week window; idle 14–45d → 👀, 45d+ → ⚠️👀, never → ❗👀 (deep scan only).
