# `src/tools.js` — Gemini tool declarations + handlers

> The function-calling surface the model can invoke, and the server-side handlers that fulfil each call.

## Responsibility
- `tools` — the `functionDeclarations` array passed to the model.
- `toolHandlers` — `{ [name]: async (args) => result }` map invoked by [`messageHandler`](messageHandler.md)'s tool loop.

## Exports
| Symbol | Description |
| --- | --- |
| `tools` | Declarations (names, descriptions, parameter schemas). |
| `toolHandlers` | Async handler per tool. |

## Tools
| Tool | Backed by |
| --- | --- |
| `get_player_info` | `apiCall('get_player')` → [`bot_api.php`](../website-api/bot_api.md) |
| `get_online_players` | `apiCall('get_online_players')` |
| `get_server_events` | `apiCall('get_events')` |
| `fetch_website_content` | GET `https://psobb.io<path>`, HTML-stripped to 8000 chars → [website-pages](../website-api/website-pages.md) |
| `update_social_memory` / `get_social_memory` | [`socialMemory`](socialMemory.md) (caps at 20 notes) |
| `get_active_vote_status` / `get_recent_votes` | local JSON files + Discord reaction tallies |
| `get_decryption_status` | GET `https://psobb.io/api/agent_state.json` → [agent_state](../website-api/agent_state.md) |
| `search_drops` | [`api`](api.md) `getDropsData` → [`get_drops.php`](../website-api/get_drops.md) (filters, limit 40) |
| `get_server_stats` | GET `https://psobb.io/api/summary` → [`summary.php`](../website-api/summary.md) |

## Depends on
[`config`](config.md), [`discordClient`](discordClient.md), [`api`](api.md), [`socialMemory`](socialMemory.md), `axios`, `fs`.

## Key behaviors / gotchas
- **Hard-coded absolute paths** for the vote tools: `/home/alexzimmerman/gemini-psobb-scripts/current_vote.json` (+ `.applied` files). On a different deploy these silently return "no vote" (see `CODE_REVIEW_REPORT.md`, risk #2). Candidate for config.
- `get_decryption_status` computes `percent_solved` from `unknown_fns/total_fns` (+vars); the live `agent_state.json` is produced by an external pipeline and isn't in the repo.
- All handlers return a plain object; errors are returned as `{ error }`, not thrown, so the tool loop can continue.
