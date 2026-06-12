# `src/permissions.js` — Privilege tiers

> Two tiers sit above a normal community member, plus a helper that resolves the caller's `GuildMember` even when a command arrives via DM.

## Tiers
- **`admin`** — holders of the Discord **Administrator** permission. Full access, including destructive commands (`!clear`, `!pull`, `!restart`, token mint/revoke/give).
- **`support`** — holders of a configured support role (default **"Community Support"**). May run the read-only / support set (`!sync all`, `!roles`, `!channels`, `!log`, `!health`, `!interactions check`) but **not** the destructive ones.
- **`member`** — everyone else.

## Exports
| Symbol | Description |
| --- | --- |
| `isAdmin(member)` | Has the Administrator permission. |
| `isSupport(member)` | Holds a support role (by id or case-insensitive name). |
| `canSupport(member)` | `isAdmin || isSupport` — the gate for read-only/support commands. |
| `memberTier(member)` | Returns `'admin' \| 'support' \| 'member'` (used by the tier-aware `!help`). |
| `resolveMember(message)` | Resolve the caller's `GuildMember`, fetching from `role_sync.guild_id` when `message.member` is null (DM invocations). Returns `null` if unresolvable. |
| `SUPPORT_ROLES` | The configured set of support role names/ids (lowercased). |

## Config keys
- `role_sync.support_roles` — array of role names/ids that grant the support tier (default `['Community Support']`).
- `role_sync.guild_id` — used by `resolveMember` so tier checks and `!help` work from DMs.

## Depends on
[`config`](config.md); lazily [`discordClient`](discordClient.md) inside `resolveMember`.

## Depended on by
Command handlers across [`roleSync`](roleSync.md), [`actionLog`](actionLog.md), [`interactions`](interactions.md), [`healthcheck`](healthcheck.md) — each runs its own tier check so its refusal message stays tailored. The [`commands`](commands.md) router does **not** enforce tiers itself (its `audience` field is descriptive only).

## Key behaviors / gotchas
- Support matching is **case-insensitive** and accepts either a role **id** or **name**.
- `resolveMember` is what lets a DM-only `!help`/`!sync` still see the caller's server roles.
