# `src/healthcheck.js` — Startup dependency health check

> Probes every website/server dependency at boot and disables any feature whose backend isn't reachable, so the bot never runs through code that depends on a missing endpoint (e.g. when the site hasn't been deployed/updated yet).

## Responsibility
- Probe each external dependency the bot relies on.
- Map dependencies → features; mark a feature **disabled** if any of its deps failed.
- Log every result (`HEALTH` category) and produce a summary for the admin startup DM.
- Provide gates so disabled features notify whoever invokes them.

## Exports
| Symbol | Description |
| --- | --- |
| `runStartupChecks()` | Probe all deps (parallel), log results, return the summary string. |
| `isFeatureUp(featureKey)` | `false` only if a dep was probed and failed (fail-open before checks run). |
| `featureForTool(toolName)` | Maps an AI tool name → its feature key (or `null`). |
| `toolDownResult(toolName)` | `{ error }` for the model to relay when a tool's feature is down. |
| `gateCommand(message)` | If the message is a command for a disabled feature, reply with a notice and return `true` (blocked). |
| `handleHealthCommand(message)` | `!health` — admin-only; re-probes and reports. |
| `summaryText()` / `detailedReport()` | Short DM summary / full `!health` report. |

## Dependency → feature map
| Dependency (probe) | Gates feature | Effect when down |
| --- | --- | --- |
| `bot_api` (`get_online_players`) | `role_sync` | `!sync`/`!nickname` reply "unavailable"; tick not started |
| `lfg_api` (`get_lfg`) | `lfg` | LFG watcher not started |
| `parties_api` (`get_parties`) | `party_rooms` | Party rooms not started |
| `tekker_db` (`ping`) | `tekker` | `/guess`/`!tekker`/`!tokens`/`!claim`/`!gift` reply "unavailable"; voice trigger not started |
| `drops_api` (`get_drops.php`) | `drops` | `search_drops` tool returns an error the model relays |
| `summary_api` (`/api/summary`) | `server_stats` | `get_server_stats` tool returns an error |
| `agent_state` (`agent_state.json`) | `decryption` | `get_decryption_status` tool returns an error |
| `vote_integration` (`VOTE_SCRIPTS_DIR` readable) | `vote` | `get_active_vote_status` / `get_recent_votes` return an error the model relays → see [votes](../website-api/votes.md) |

## Depends on
[`api`](api.md) (`apiCall`, `getDropsData`), [`tekkerDb`](tekkerDb.md) (`ping`), [`actionLog`](actionLog.md), `axios`.

## Depended on by
- [`bot.js`](bot.md) — `runStartupChecks` + `isFeatureUp` to skip background feature starts.
- [`messageHandler`](messageHandler.md) — `gateCommand`, `isFeatureUp`/`featureForTool`/`toolDownResult` (tool loop), `handleHealthCommand` (`!health`).
- [`system`](system.md) — the summary is folded into the startup admin DM.

## Key behaviors / gotchas
- **Fail-open before probing:** until `runStartupChecks()` populates `depStatus`, `isFeatureUp` returns `true` — nothing is wrongly blocked during early startup.
- A probe counts a dependency **present** if the endpoint responds in a recognized shape; a briefly-offline upstream game server (e.g. `get_parties` → `{success:false}`) still counts as present, so deployed features aren't disabled by a transient blip.
- **Session-scoped:** features disabled at boot stay disabled until `!health` re-probes successfully (or a restart). Run `!health` after deploying the matching website changes to re-enable without restarting.
- To add a new gated feature: add a dependency probe + a `FEATURES` entry, then gate it (background start in [`bot.js`](bot.md), command in `COMMAND_FEATURE`, or `tool` for the AI loop).

## Related website endpoints
All of [`docs/website-api/`](../website-api/) — each probe targets one of those contracts.
