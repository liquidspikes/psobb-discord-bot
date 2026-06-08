# `src/config.js` — Runtime configuration & shared paths

> Loads the JSON config from outside the repo and exposes the shared filesystem paths every other module uses.

## Responsibility
- Read `/psobb-bot/discord_config.json` (production) into `config`.
- Define `MEMORY_DIR`, `RAG_PATH`, `MAIN_KNOWLEDGE_PATH`.
- In `NODE_ENV=test`, substitute a mock config and repo-local paths (`test_memory/`, `rag/`, `knowledge.md`) so modules can be required without the real config file.

## Exports
| Symbol | Type | Description |
| --- | --- | --- |
| `config` | object | Parsed config (see keys below). |
| `MEMORY_DIR` | string | Dir for all persisted JSON/logs (`/psobb-bot/memory`). |
| `RAG_PATH` | string | Dir of `*.md` knowledge sources (`/psobb-bot/rag`). |
| `MAIN_KNOWLEDGE_PATH` | string | Core lore file (`/psobb-bot/knowledge.md`). |

## Config keys (consumed across the codebase)
- `bot_token`, `gemini_api_key`, `system_prompt`, `channel_id`
- `psobb_api_url` (includes `?key=...`), `psobb_api_secret` (Bearer)
- `role_sync.{enabled,interval_minutes,guild_id,nickname_level,nickname_prefix,nickname_prefix_lurker,protected_roles}`
- `lfg_sync.{enabled,channel_id,interval_seconds}` / `lfg_channel_id`
- `party_rooms.{enabled,category_id,community_support_role,interval_seconds,grace_seconds,min_linked}`
- `tekker_db_url` (override), `tekker.claim_enabled`

## Depended on by
Essentially every module. Changing a path or key here ripples everywhere.

## Key behaviors / gotchas
- On load failure it **logs and re-throws** — the process won't start without a valid config (intentional fail-fast).
- Config lives **outside** the repo; the README "Configuration" section is the source of truth for its shape.
