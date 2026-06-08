# `src/roleSync.js` — Role & nickname sync, audits, self-check

> The largest module. Mirrors a linked player's in-game identity into Discord roles + nickname, runs admin audits, and gates startup with a self-check.

## Responsibility
- Periodic + on-demand sync of class/subclass/level/Section roles and the `LVL<n>` nickname suffix + 💠 badge for **linked players**.
- Owns the nickname/badge machinery for the lurker tiers too (👀/⚠️👀/❗👀 via `applyLurkerBadge`/`runLurkerPass`), but those are **driven by `!interactions build`, not `!sync`** — the two command surfaces are separated.
- **Assign-existing-only**: never creates/recolors roles; only adds/removes by name. Strips permission-less cosmetic/managed roles and reapplies the correct set in one `roles.set()`.
- Per-user opt-out locks; admin role/channel permission audits; `!commands`/`!help`.

## Exports (consumed by other modules)
| Symbol | Description |
| --- | --- |
| `startRoleSync(guild)` | Start the periodic tick (`role_sync.interval_minutes`). |
| `selfCheck` | Boot integrity gate (pure; throws on failure). |
| `handleSyncCommand` / `handleSyncAllCommand` | `!sync` (self) / `!sync all` (every **linked** player; no history scan, no eyes). |
| `handleLockCommand` / `handleNicknameCommand` | `!lock`/`!unlock` secid\|nickname; `!nickname`. |
| `handleHelpCommand` | `!commands`/`!help` (admins also get a DM of admin commands). |
| `handleRolesCommand` / `handleChannelsCommand` | `!roles` / `!channels` DM audits. |
| `dmAdminReport` | DM chunker for audit reports. |
| `runLurkerPass(guild, onProgress)` | Apply the tiered eyes badge to all unlinked members. Called by `!interactions build`. |

## Key internals (not exported — used only within this module / by `selfCheck`)
`syncMember` (core role+nick apply), `selectProfile`, `computeTargetRoleNames`, `isStrippableRole`, `isLinked`, `buildManagedNick`, `applyLurkerBadge` (single-member eyes), `isLurkerExempt`, `auditGuildRoles`/`auditGuildChannels`.

## Data / files touched
- `MEMORY_DIR/linked_roster.json` — known-linked Discord IDs (sync fallback).
- `MEMORY_DIR/last_character.json` — last active char per id (pins offline syncs).
- `MEMORY_DIR/role_sync_locks.json` — per-user `{ secid?, nickname? }` locks.

## Config keys
`role_sync.{enabled,interval_minutes,guild_id,nickname_level,nickname_prefix(💠),nickname_prefix_lurker(👀),lurker_exempt_roles,protected_roles}`.

## Depends on
[`config`](config.md), [`api`](api.md), [`actionLog`](actionLog.md), [`interactions`](interactions.md) (`lurkerTier`), [`pso`](pso.md). Note: `interactions` lazily requires this module back (`runLurkerPass`) — a deliberate cycle resolved via lazy `require` inside the command handler.

## Depended on by
[`bot.js`](bot.md), [`messageHandler`](messageHandler.md).

## Key behaviors / gotchas
- **Never strips:** roles with any permission, `r.managed` (integration/booster), roles above the bot, or anything in `protected_roles`.
- Per-member **signature cache** (`lastSyncSignature`) skips redundant Discord calls when nothing changed; commands `delete()` the signature to force a fresh apply.
- `isLinked()` requires a real character (slot with `exists !== false`) — a linked-but-character-less account is treated as not syncable.
- Nickname fitted to Discord's 32-char cap, reserving room for the `LVL` suffix; the 💠 badge is applied regardless of the nickname lock **and regardless of role-assignment success** — becoming linked must always overwrite any stale 👀/⚠️/❗ eyes (the overwrite happens via `buildManagedNick → stripManagedPrefix`, which lists all managed prefixes longest-first).
- `selfCheck()` runs the exact `selectProfile → computeTargetRoleNames` path on a fixture so a stale/partial deploy fails loudly at boot.

## Related website endpoints
- [`bot_api.php`](../website-api/bot_api.md) — `get_player`, `get_online_players`, `get_linked_players`. Its `$SECID_MAP`/`$CLASS_MAP` must match [`pso`](pso.md).
