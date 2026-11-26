# `src/messageHandler.js` — Message routing + AI conversation

> The raw-packet DM relay, reaction/message activity hooks, the slash-command listener, and the Gemini chat loop with tool-calling and reply chunking. **Text-command routing lives in [`commands`](commands.md);** this module just calls `commands.dispatch()`.

## Responsibility
`registerMessageHandlers()` attaches four listeners:
1. **`raw`** — re-emits `MESSAGE_CREATE` for DMs (no `guild_id`) so DMs are handled like guild messages.
2. **`MessageReactionAdd`** — `markInteracted`, then `trackActivity(...,'reaction')` only when `isFeatureUp('tekker')`.
3. **`InteractionCreate`** — slash commands:
   - **`/guess`**: when `isFeatureUp('tekker')`, delegates to [`tekkerChallenge`](tekkerChallenge.md) `processSlashGuess(interaction)`; otherwise replies that the feature is down. Wraps errors so a deferred interaction is `editReply`-ed rather than double-replied.
   - **`/notify`**: reads/writes [`notificationPrefs`](notificationPrefs.md) (`type`/`action` options) and replies ephemerally with the caller's push-notification settings. No website dependency, so it isn't health-gated.
4. **`MessageCreate`** — the main handler:
   - de-dupes via `handledMessages` Set, ignores bots/system messages, ignores `#admin-agent` (`ADMIN_AGENT_CHANNEL_ID`), and skips AI replies on quest-operations DMs (`.qst` / `QUEST_DM_RE`) from allowlisted quest authors (`QUEST_AUTHOR_IDS`) so the admin agent handles them cleanly;
   - `markInteracted` for guild messages; `trackActivity(...,'message')` only for non-command guild messages **and** when `isFeatureUp('tekker')`;
   - gate: only proceeds if DM, mentioned, a command (`!`/`/`), or in `channel_id`;
   - **command routing:** for any `!`/`/` message, calls `commands.dispatch(message)` ([commands](commands.md)). `dispatch()` applies the website-dependency health gate (`gateCommand`) and runs the first matching command; if it returns `true` the message is consumed and handling stops. It returns `false` only for passthrough commands (`!stats`/`!quests`/`!progress`/`!progression`), which continue into the AI flow below;
   - otherwise: build per-user history (isolated in public channels, last 12 turns), inject context (time, user id, social memory, online session), iterate active non-cooled models in `candidateModelNames` via direct `generateContent({ contents })`, run the **tool loop** (<=5 iterations, sending `functionResponse` as role `'user'` for Gemini 3.x+/Gemma or `'function'` for 2.x, preserving `thoughtSignature`, filtering `thought: true` reasoning parts, and caching HTTP `429` cooldowns per model), then chunk the reply under 2000 chars (via `safeReply`, falling back cleanly on expired reply targets).

## Exports
| Symbol | Description |
| --- | --- |
| `registerMessageHandlers()` | Wires the listeners (called once by [`bot.js`](bot.md)). |
| `compute429CooldownMs(errMsg)` | Computes RPM vs daily (`PerDay`) `429` cooldown backoff in milliseconds. |
| `sanitizeModelParts(parts)` | Drops empty `thought` placeholder parts while preserving `functionCall` and `thoughtSignature` parts. |
| `extractResponseText(response)` | Concatenates visible text parts while excluding `thought: true` reasoning parts. |
| `functionResponseRoleForModel(modelName)` | Returns `'function'` for `gemini-2.*` and `'user'` for Gemini 3.x+ / Gemma models. |

## Command routing
The full command registry and routing order live in [`commands`](commands.md). This module only invokes `commands.dispatch(message)`; the slash `/guess` is handled separately in the `InteractionCreate` listener above (→ [`tekkerChallenge`](tekkerChallenge.md)).

## Data / files touched
- Appends each incoming message to `MEMORY_DIR/questions.log`.

## Key behaviors / gotchas
- **`!quest` vs `!quests`:** [`commands`](commands.md) matches `!quest`/`$quest` with a word-boundary regex (`/^[!$]quest(\s|$)/i`), so `!quests` passes cleanly through to the AI flow.
- All unhandled warnings/errors log through [`actionLog`](actionLog.md) (`SYSTEM`/`AI`/`TOOL`) rather than raw console logging.
- The tool loop calls [`tools`](tools.md) handlers and feeds results back; capped at 5 iterations to avoid loops. Before each call it checks `isFeatureUp(featureForTool(name))` — a disabled tool returns `toolDownResult(name)` so the model tells the user the data source is down instead of hitting a missing endpoint.
- The activity hooks gate `trackActivity` behind `isFeatureUp('tekker')` so that when the tekker store is down the scanner doesn't fire failing `tekker_db` calls on every message/reaction (`markInteracted` still runs — it's the unrelated lurker-log feature).
- Public-channel history is filtered to the requesting user (+ the bot's replies to them) to avoid leaking other users' context.
- History is massaged to satisfy the Gemini API (must start with `user`, must alternate roles).
