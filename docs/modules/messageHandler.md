# `src/messageHandler.js` — Message routing + AI conversation

> The raw-packet DM relay, reaction/message activity hooks, the slash-command listener, and the Gemini chat loop with tool-calling and reply chunking. **Text-command routing lives in [`commands`](commands.md);** this module just calls `commands.dispatch()`.

## Responsibility
`registerMessageHandlers()` attaches four listeners:
1. **`raw`** — re-emits `MESSAGE_CREATE` for DMs (no `guild_id`) so DMs are handled like guild messages.
2. **`MessageReactionAdd`** — `markInteracted`, then `trackActivity(...,'reaction')` only when `isFeatureUp('tekker')`.
3. **`InteractionCreate`** — the **`/guess` slash command**: when `isFeatureUp('tekker')`, delegates to [`tekkerChallenge`](tekkerChallenge.md) `processSlashGuess(interaction)`; otherwise replies that the feature is down. Wraps errors so a deferred interaction is `editReply`-ed rather than double-replied.
4. **`MessageCreate`** — the main handler:
   - de-dupes via `handledMessages` Set, ignores bots/system messages;
   - `markInteracted` for guild messages; `trackActivity(...,'message')` only for non-command guild messages **and** when `isFeatureUp('tekker')`;
   - gate: only proceeds if DM, mentioned, a command (`!`/`/`), or in `channel_id`;
   - **command routing:** for any `!`/`/` message, calls `commands.dispatch(message)` ([commands](commands.md)). `dispatch()` applies the website-dependency health gate (`gateCommand`) and runs the first matching command; if it returns `true` the message is consumed and handling stops. It returns `false` only for passthrough commands (`!stats`/`!quests`/`!progress`/`!progression`), which continue into the AI flow below;
   - otherwise: build per-user history (isolated in public channels, last 12 turns), inject context (time, user id, social memory, online session), `model.startChat()`, run the **tool loop** (≤5 iterations), then chunk the reply under 2000 chars.

## Exports
| Symbol | Description |
| --- | --- |
| `registerMessageHandlers()` | Wires the listeners (called once by [`bot.js`](bot.md)). |

## Command routing
The full command registry and routing order live in [`commands`](commands.md). This module only invokes `commands.dispatch(message)`; the slash `/guess` is handled separately in the `InteractionCreate` listener above (→ [`tekkerChallenge`](tekkerChallenge.md)).

## Data / files touched
- Appends each incoming message to `MEMORY_DIR/questions.log`.

## Key behaviors / gotchas
- ⚠️ **Known bug (open):** the `!quest`/`$quest` deprecation entry (in [`commands`](commands.md)) uses a `startsWith('!quest')` matcher, which also matches **`!quests`** — so the documented `!quests` AI command is shadowed. Fix by anchoring (`/^!quest(\s|$)/`) or moving the `!quests` entry earlier. See `CODE_REVIEW_REPORT.md` bug #1.
- The tool loop calls [`tools`](tools.md) handlers and feeds results back; capped at 5 iterations to avoid loops. Before each call it checks `isFeatureUp(featureForTool(name))` — a disabled tool returns `toolDownResult(name)` so the model tells the user the data source is down instead of hitting a missing endpoint.
- The activity hooks gate `trackActivity` behind `isFeatureUp('tekker')` so that when the tekker store is down the scanner doesn't fire failing `tekker_db` calls on every message/reaction (`markInteracted` still runs — it's the unrelated lurker-log feature).
- Public-channel history is filtered to the requesting user (+ the bot's replies to them) to avoid leaking other users' context.
- History is massaged to satisfy the Gemini API (must start with `user`, must alternate roles).
