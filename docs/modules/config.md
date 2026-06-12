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
- `tekker_db_url` (override), `tekker.claim_enabled`, `tekker.channel_id` / `tekker_channel_id`
- `tekker.local_mode` (bool) — force all Tekker ops to the in-process [`tekkerLocalStore`](tekkerLocalStore.md) instead of the website (test mode). Also settable via env `TEKKER_LOCAL_MODE=1`. Default off.
- `tekker.auto_local_fallback` (bool, **default on**) — at boot, if the live `bot_tekker_db.php` endpoint is unreachable or out of date (capability probe fails), auto-switch to the local store for the session instead of leaving the game broken. Set `false` to keep strict graceful-degradation instead.
- `tekker.channel_id` / top-level `tekker_channel_id` — the dedicated Tekker channel.
- `tekker.keep_message_id` — the single message preserved when the channel is wiped at the start of each game (e.g. a pinned rules/info post). Falls back to a hard-coded id. Requires the bot to have **Manage Messages** in the channel.

## Depended on by
Essentially every module. Changing a path or key here ripples everywhere.

## Key behaviors / gotchas
- On load failure it **logs and re-throws** — the process won't start without a valid config (intentional fail-fast).
- Config lives **outside** the repo; the README "Configuration" section is the source of truth for its shape.
