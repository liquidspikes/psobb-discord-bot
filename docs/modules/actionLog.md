# `src/actionLog.js` — Central action log

> Structured log of every backend action (NOT the AI conversation): console + in-memory ring buffer + persistent file. Powers `!log`.

## Responsibility
- `logAction(category, message, level)` writes to all three sinks.
- Maintain a 2000-entry ring buffer and a bounded file at `MEMORY_DIR/actions.log`.
- Serve recent history to admins via the `!log [lines]` command (DM, chunked).

## Exports
| Symbol | Description |
| --- | --- |
| `logAction(category, message, level='info')` | Core writer. |
| `logInfo / logWarn / logError(category, message)` | Convenience wrappers. |
| `getRecentLogs(lines)` | Last N lines (prefers file, falls back to buffer). |
| `handleLogCommand(message)` | The `!log` admin command (Administrator + guild only). |

## Data / files touched
- `MEMORY_DIR/actions.log` — capped at `FILE_MAX_LINES=10000`, trimmed to `FILE_TRIM_TO=8000`, checked every 200 writes.

## Categories
`SYSTEM`, `COMMAND`, `ROLE-SYNC`, `API`, `DROPS`, `SESSION`, `TOOL`, `TEKKER`, `LFG`, `PARTY`, `MOD`, `INTERACT`, `AUDIT`.

## Depended on by
Almost every module (logging is cross-cutting).

## Key behaviors / gotchas
- Successful PSOBB API calls are intentionally **not** logged here (see [`api`](api.md) and `LOGGING_POLICY.md`) to avoid flooding from the role-sync tick.
- Entry format: `[ISO ts] [LEVEL] [CATEGORY] message`.
- The AI chatbot conversation is logged separately (`questions.log`), not here.
