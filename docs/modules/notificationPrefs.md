# `src/notificationPrefs.js` — Per-user notification preferences

> Stores each user's opt-in for **push** notifications and provides `sendDM`, a drop-in `user.send()` wrapper that makes pings **silent by default**.

## Concept
Discord pings (DMs and channel mentions) buzz the recipient's phone by default. This module flips that: the bot marks its pings with `MessageFlags.SuppressNotifications` (they still highlight in Discord, but don't push) **unless** the user has explicitly opted that category in. Three categories: **DM** (bot direct messages — `!log`, help, audits, startup notices), **LFG** (look-for-group announcements), **VC** (party voice-room pings).

## Storage
- `MEMORY_DIR/user_notifications.json` — `{ "<userId>": { "DM": bool, "LFG": bool, "VC": bool } }`. Loaded once at require-time; rewritten on every `setPref`. **No website dependency** — purely local, so this feature works even when every website endpoint is down.

## Exports
| Symbol | Description |
| --- | --- |
| `getPrefs(userId)` | Returns `{ DM, LFG, VC }` booleans (missing = `false`). |
| `setPref(userId, type, value)` | Set one category (`DM`/`LFG`/`VC`); persists. Returns `false` for an unknown type. |
| `sendDM(userOrMember, contentOrOptions, type='DM')` | Send a DM, appending `SuppressNotifications` to `flags` unless the user enabled `type`. Accepts a string or a message-options object; accepts a `User` or `GuildMember`. |
| `prefs` | The raw `{userId: {...}}` dict, exported so background loops can iterate opted-in users without N lookups. |

## Depended on by
- [`commands`](commands.md) (`!notify`) and [`messageHandler`](messageHandler.md) (`/notify` slash) — read/write prefs.
- [`actionLog`](actionLog.md) (`!log`), [`roleSync`](roleSync.md) (help/audit DMs), [`system`](system.md) (startup admin DM) — route their DMs through `sendDM` (silent unless DM opted in).
- [`lfg`](lfg.md) and [`partyRooms`](partyRooms.md) — make their channel pings silent and additionally DM the users who opted into LFG/VC.

## Key behaviors / gotchas
- **Default is silent.** A brand-new user (no JSON entry) gets `false` for all three, so nothing pushes until they `/notify <type> on`.
- `sendDM` defaults to the `DM` category; LFG/VC opt-in DMs in the background loops call `user.send()` directly (they only fire for already-opted-in users, so they intentionally push).
- The opted-in LFG/VC DMs iterate the exported `prefs` dict (LFG) or check `getPrefs` per member (VC); both fetch the `GuildMember` and best-effort `.catch(() => {})` on send so a closed DM never breaks the loop.
- Slash `/notify` replies are ephemeral; `!notify` replies in-channel.
