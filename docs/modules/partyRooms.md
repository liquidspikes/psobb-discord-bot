# `src/partyRooms.js` — Private party voice rooms

> Gives each active multiplayer game its own private Discord voice channel for the linked players in that game.

## Responsibility
- Poll `get_parties`; for each game with ≥ `min_linked` linked players, create a private voice channel under a category.
- Grant access + post an entry ping as players join; tear the room down (after a grace window) once it empties of linked players.
- Persist room state so a restart doesn't orphan channels.

## Exports
| Symbol | Description |
| --- | --- |
| `startPartyRooms(guild)` | Validate category/perms, reconcile state, start the poll loop. |

## Data / files touched
- `MEMORY_DIR/party_rooms.json` — `{ [game_id]: { channelId, members[], emptySince } }`.

## Config keys
`party_rooms.{enabled,category_id,community_support_role,interval_seconds(≥15),grace_seconds(≥10),min_linked(≥1)}`. **Hard-coded fallbacks:** category `1456493542708088940`, community role `1508563507690471514`.

## Depends on
[`config`](config.md), [`discordClient`](discordClient.md), [`api`](api.md), [`actionLog`](actionLog.md), [`notificationPrefs`](notificationPrefs.md) (opt-in DMs).

## Depended on by
[`bot.js`](bot.md).

## Key behaviors / gotchas
- Channel overwrites: `@everyone` denied view/connect; bot + community-support role + each linked member allowed.
- **Silent by default + opt-in DM:** the room-open ping and the per-join entry ping are sent with `MessageFlags.SuppressNotifications`. Members who set `VC` on via [`notificationPrefs`](notificationPrefs.md) also get a real DM push (on room creation, and when another player joins their room). Best-effort `.catch(() => {})` on each DM.
- Persists room state **before** pinging so a crash mid-create can't orphan a channel; `reconcile()` on boot drops entries whose channel no longer exists.
- Requires **Manage Channels**; logs a warning if missing.

## Related website endpoints
- [`bot_api.php` — `get_parties`](../website-api/bot_api.md).
