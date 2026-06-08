# `src/moderation.js` — `!clear` / `!purge`

> Admin bulk-delete of recent messages in the channel where it's run.

## Responsibility
`handleClearCommand(message)` — validate, optionally confirm, and `bulkDelete` up to `<count>` messages.

## Exports
| Symbol | Description |
| --- | --- |
| `handleClearCommand(message)` | The `!clear <count>` / `!purge <count>` command. |

## Constants
- `MAX_CLEAR = 500` (hard cap), `CONFIRM_THRESHOLD = 100`, `CONFIRM_TIMEOUT_MS = 30000`.

## Depends on
[`actionLog`](actionLog.md).

## Depended on by
[`messageHandler`](messageHandler.md).

## Key behaviors / gotchas
- Requires Administrator (the user) **and** Manage Messages (the bot) in that channel.
- Count is required and explicit; capped at 500.
- Clears > 100 require a **react-to-confirm** (✅ within 30s) from the issuing admin only.
- `bulkDelete(n, true)` filters messages > 14 days (Discord can't bulk-delete those); the confirmation note self-deletes.
- Every use is logged (`MOD` category): who, how many, where.
