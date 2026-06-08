# `src/system.js` — Process-level commands & startup notice

> `!restart`, `!pull` (git deploy), and the boot-time admin DM.

## Responsibility
- `handleRestartCommand` — confirm, then `client.destroy()` + `process.exit(0)` so a supervisor relaunches.
- `handlePullCommand` — `git pull origin main` (via a deploy key), then restart if there were updates.
- `announceStartup` — DM every server admin a "bot started" notice (+ the self-check result) once per process.

## Exports
| Symbol | Description |
| --- | --- |
| `handleRestartCommand(message)` | `!restart` (admin). |
| `handlePullCommand(message)` | `!pull` / `!update` / `!gitpull` (admin). |
| `announceStartup(guild, selfCheckResult?, healthSummary?)` | Boot DM to admins (incl. the [dependency health](healthcheck.md) summary). |

## Depends on
[`discordClient`](discordClient.md), [`actionLog`](actionLog.md), `child_process.exec`.

## Depended on by
[`bot.js`](bot.md) (`announceStartup`), [`messageHandler`](messageHandler.md) (commands).

## Key behaviors / gotchas
- **`!restart` only works under a supervisor** with auto-restart (systemd `Restart=always`); without one, it just stops the bot. See README "Running as a service".
- `!pull` runs `git -c core.sshCommand="ssh -i /psobb-bot/.git/deploy_key ..." pull origin main` in `cwd: /psobb-bot` — paths are deployment-specific.
- Restart waits ~1.5s before exiting so the confirmation reply and log flush land first.
- `announceStartup` skips admins with DMs disabled and records the delivery count.
