# Documentation Index

Per-file documentation for the PSOBB Discord bot, written so an AI agent (or human)
can navigate the codebase and make changes without reading every source file first.

Each module doc follows the same shape: **Responsibility → Exports → Depends on →
Depended on by → Data/files → Config keys → Key behaviors / gotchas → Related website
endpoints.** Start at [`bot.js`](modules/bot.md) (the entry point) and follow the
"Depends on" links.

## Bot modules (`src/`)

| Module | Doc | One-liner |
| --- | --- | --- |
| `bot.js` | [bot.md](modules/bot.md) | Entry point — wires Discord events and logs in. |
| `src/config.js` | [config.md](modules/config.md) | Loads runtime config + shared filesystem paths. |
| `src/discordClient.js` | [discordClient.md](modules/discordClient.md) | The shared discord.js `Client` instance. |
| `src/actionLog.js` | [actionLog.md](modules/actionLog.md) | Central action log (console + ring buffer + file) and `!log`. |
| `src/api.js` | [api.md](modules/api.md) | PSOBB server API calls + 30-min drops cache. |
| `src/knowledgeBase.js` | [knowledgeBase.md](modules/knowledgeBase.md) | Builds the static knowledge-base string for the model. |
| `src/model.js` | [model.md](modules/model.md) | The configured Gemini model (persona + KB + tools). |
| `src/pso.js` | [pso.md](modules/pso.md) | PSOBB game-data constants + value normalizers. |
| `src/socialMemory.js` | [socialMemory.md](modules/socialMemory.md) | Per-user long-term social memory (JSON). |
| `src/session.js` | [session.md](modules/session.md) | Detects a player's current in-game session. |
| `src/tools.js` | [tools.md](modules/tools.md) | Gemini tool declarations + handlers. |
| `src/messageHandler.js` | [messageHandler.md](modules/messageHandler.md) | DM relay + main message/command/AI handler. |
| `src/interactions.js` | [interactions.md](modules/interactions.md) | Persistent user-interaction log + lurker badges. |
| `src/roleSync.js` | [roleSync.md](modules/roleSync.md) | Role & nickname sync + admin audits + boot self-check. |
| `src/lfg.js` | [lfg.md](modules/lfg.md) | LFG announcer (mirrors website LFG posts to Discord). |
| `src/partyRooms.js` | [partyRooms.md](modules/partyRooms.md) | Private per-game voice rooms. |
| `src/moderation.js` | [moderation.md](modules/moderation.md) | `!clear` / `!purge` bulk message deletion. |
| `src/system.js` | [system.md](modules/system.md) | `!restart`, `!pull`, and the startup admin DM. |
| `src/tekkerChallenge.js` | [tekkerChallenge.md](modules/tekkerChallenge.md) | Tekker Challenge minigame logic. |
| `src/tekkerDb.js` | [tekkerDb.md](modules/tekkerDb.md) | Tekker storage client (HTTP → website endpoint). |

## Website dependencies (consumed by the bot)

These live in the **separate** `psobb.io-website-public` repo. The docs below describe
the contract the bot relies on; **edit the canonical `.php` files in that repo**, not
the bot repo.

| Endpoint | Doc | Used by |
| --- | --- | --- |
| `api/bot_api.php` | [bot_api.md](website-api/bot_api.md) | `api.js`, `session.js`, `roleSync.js`, `tools.js` |
| `api/bot_tekker_db.php` | [bot_tekker_db.md](website-api/bot_tekker_db.md) | `tekkerDb.js` |
| `api/get_drops.php` | [get_drops.md](website-api/get_drops.md) | `api.js` (`getDropsData`) |
| `api/summary.php` | [summary.md](website-api/summary.md) | `tools.js` (`get_server_stats`) |
| `api/agent_state.json` | [agent_state.md](website-api/agent_state.md) | `tools.js` (`get_decryption_status`) |
| website pages (generic) | [website-pages.md](website-api/website-pages.md) | `tools.js` (`fetch_website_content`) |

## Cross-cutting docs at repo root

- [`README.md`](../README.md) — feature overview, setup, config reference.
- [`LOGGING_POLICY.md`](../LOGGING_POLICY.md) — what is/isn't logged.
- [`COMMAND_LIST.md`](../COMMAND_LIST.md) — command reference.
- [`TEKKER_CLAIM_INTEGRATION.md`](../TEKKER_CLAIM_INTEGRATION.md) — the not-yet-live claim seam.
- [`CODE_REVIEW_REPORT.md`](../CODE_REVIEW_REPORT.md) — known bugs & risks (some still open).
- [`SITE_SQLITE3_USAGE.md`](../SITE_SQLITE3_USAGE.md) — website DB-layer map.
