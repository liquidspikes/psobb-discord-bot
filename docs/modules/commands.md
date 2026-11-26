# `src/commands.js` — Command router

> The single entry point for every `!`/`/` prefixed text command. [`messageHandler`](messageHandler.md) calls `dispatch(message)`; this module owns the registry and routing order.

## Responsibility
- Hold an **ordered registry** of command entries and route each incoming command to the **first entry whose matcher accepts it** (order matters — first match wins, while `!quest`/`$quest` uses a word-boundary regex so `!quests` falls through to AI passthrough).
- Apply the website-dependency health gate (`gateCommand`, covering `role_sync` and `tekker` including `!trade`) before running anything.
- Delegate the actual work to the owning module's handler (roleSync, system, moderation, tekkerChallenge/tekkerDb, actionLog, interactions, healthcheck), while keeping a few command bodies inline (`!claim`, `!gift`, `!trade`, `!tokens`, `!tekker*`).

## Exports
| Symbol | Description |
| --- | --- |
| `dispatch(message)` | Health-gate, then run the first matching command. Returns **true** when the message was consumed (handled, gated, or an unknown command to ignore); **false** only for `passthrough` commands so the caller continues into the AI flow. |
| `register(entry)` | Push a command entry (auto-builds a default matcher from `prefixes × {name, …aliases}` if none given). |
| `registry` | The ordered entry array (exported mainly for inspection). |

### Registry entry shape
`{ name, aliases?, prefixes?(=['!']), match?, audience, passthrough?, run(message, parts) }`
- **`match(content)`** — predicate; defaults to a `startsWith` test over every prefix×word. Custom matchers handle boundary/irregular cases (`!quest`/`$quest` via `/^[!$]quest(\s|$)/i`, `!sync all` before `!sync`, `!nickname`/`!nick` via regex).
- **`audience`** — descriptive tier label (`'admin' | 'support' | 'member'`) for **documentation only**; it is **not enforced here**. Each handler keeps its own permission check (see [`permissions`](permissions.md)) so its tailored refusal message survives.
- **`passthrough`** — `true` for commands that intentionally fall through to the AI handler (`!stats`, `!quests`, `!progress`, `!progression`): they log and let `dispatch()` return `false`.

## Depends on
[`actionLog`](actionLog.md), [`healthcheck`](healthcheck.md) (`gateCommand`/`handleHealthCommand`), [`pso`](pso.md) (`WEAPON_ATTR_EMOJIS`, `TEKKER_MASKED_WEAPON`), [`notificationPrefs`](notificationPrefs.md), [`roleSync`](roleSync.md), [`system`](system.md), [`moderation`](moderation.md), and lazily [`tekkerChallenge`](tekkerChallenge.md)/[`tekkerDb`](tekkerDb.md)/[`interactions`](interactions.md).

## Depended on by
[`messageHandler`](messageHandler.md) — `commands.dispatch(message)` is the only call site.

## Registered commands (in order)
`!health` (support) · `/guess`,`!guess` (redirect to slash) · `!claim` · `!gift` · `!trade` · `!tokens` · `!tekker*` (status/`roll`/`end`|`stop`|`cancel`/`tokens`|`all`/`grant`/`revoke`/`give`/`threshold`) · `!quest`/`$quest` (deprecated, word-boundary) · `!log` (support) · `!interactions` (support) · `!restart` · `!pull`/`!gitpull`/`!update` · `!clear`/`!purge` · `!roles` (support) · `!channels` (support) · `!commands`/`!help` · `!lock`/`!unlock` · `!nickname`/`!nick` · `!sync all` (support, before `!sync`) · `!notify` · `!sync` · passthrough: `!stats`/`!quests`/`!progress`/`!progression`.

`!notify <DM|LFG|VC> <on|off>` reads/writes [`notificationPrefs`](notificationPrefs.md) (the `/notify` slash form is handled in [`messageHandler`](messageHandler.md)). With no args it prints the caller's current per-type push settings.

## Key behaviors / gotchas
- **`!claim` no longer drops an item** — it just explains the website redemption flow (log in, go online in-game, combine up to 3 tokens at https://psobb.io/).
- **`!trade`** validates ownership of both tokens, posts a ✅/❌ offer the target must confirm within 60s, then **re-validates ownership at acceptance time** before swapping (tokens may have been gifted/claimed during the window). Gated by `healthcheck` under `tekker`.
- **`!tekker tokens`** now reads two stores: outstanding `getAllTokens()` (filtered to unclaimed) **and** the `getClaimLog()` claimed-rewards history (claimed tokens are deleted from the live table).
- **`!quest` vs `!quests`:** anchored by `/^[!$]quest(\s|$)/i` so `!quests` passes cleanly through to the AI handler.

## Related
- [`permissions`](permissions.md) — the tier helpers handlers use for their own checks.
