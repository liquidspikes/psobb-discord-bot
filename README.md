# PSOBB Discord Bot

An AI-driven Discord companion for the **psobb.io** Phantasy Star Online: Blue Burst
server. It answers player questions using a Gemini model grounded in a local knowledge
base, pulls live data from the server's API (player stats, online players, drops,
events, votes, decryption status), and automatically mirrors each linked player's
in-game identity into Discord roles and nicknames.

Entry point is [`bot.js`](bot.js); the implementation is split into focused modules under [`src/`](src/).

---

## Features

### AI assistant (Gemini)
- Conversational replies in DMs, when **@mentioned**, in the configured channel, or via commands.
- Grounded in a **local knowledge base**: [`knowledge.md`](knowledge.md) (core lore/server knowledge) plus every `*.md` file under [`rag/`](rag/) (class deep-dives, quests, drop tables, government tasks, area progression, etc.).
- **Tone adapts to player level** — kind to new players (Lvl 1–20), sassy to veterans (Lvl 100+).
- **Per-user social memory** — persists notes/relationships about each user under the memory directory and recalls them on the next interaction.
- Long replies are auto-split to respect Discord's 2000-character message limit.
- Public-channel history is isolated per user so the bot doesn't leak other people's context.

### Live server tools (function calling)
The model can call these tools against the server API / website:

| Tool | Purpose |
| --- | --- |
| `get_player_info` | A player's characters, level, class, online status, team, and **QuestProgress** (quest completions + area-warp unlocks). |
| `get_online_players` | Everyone currently connected. |
| `get_server_events` | Active community events and progress. |
| `get_server_stats` | Live telemetry: uptime, online count, active games, global EXP/drop multipliers, player & game lists. |
| `search_drops` | Query the drop tables by item, monster, difficulty, Section ID, and/or episode (30-min cache). |
| `fetch_website_content` | Read a psobb.io page (e.g. `/missions`, `/lfg`, `/about`) as plain text. |
| `get_active_vote_status` / `get_recent_votes` | Mission Control vote tallies and previous winners. |
| `get_decryption_status` | Live "Agent Decryption Matrix" progress, model, and ETA. |
| `update_social_memory` / `get_social_memory` | Read/write the bot's long-term notes about a user. |

### Commands
- `!stats`, `!quests`, `!progress`, `!progression` — routed to the AI (which calls `get_player_info` and reports character stats / quest & area-unlock progress).
- `!sync` — **manually refresh your roles and nickname** from your linked PSOBB account (see below).
- `!quest` / `$quest` — deprecated; returns a notice that bounties are now automatic.

### Role & nickname sync ⭐
Mirrors a linked player's **currently-active (or most-recently-played) character** into Discord:

- **Class role** — `Hunter`, `Ranger`, or `Force`.
- **Subclass role** — one of the 12 (`HUmar`, `HUnewearl`, `HUcast`, `HUcaseal`, `RAmar`, `RAmarl`, `RAcast`, `RAcaseal`, `FOmar`, `FOmarl`, `FOnewm`, `FOnewearl`).
- **Level role** — `Rookie` (Lvl 1–9), then `LVL10`, `LVL20`, … `LVL200`.
- **Section ID role** — one of `Viridia`, `Greenill`, `Skyly`, `Bluefull`, `Purplenum`, `Pinkal`, `Redria`, `Oran`, `Yellowboze`, `Whitill`.
- **Nickname** — the character's live level is appended, e.g. `Hunter Joe [142]`.
- **Display color** — comes from the **Section ID** role (Discord uses the highest *colored* role).

How it runs:
- **Automatic poll** on an interval (default 5 min). If the online feed exposes a Discord ID it syncs those players directly; otherwise it falls back to polling a persisted roster of known-linked members and syncs whoever is online.
- **`!sync`** for an instant, on-demand refresh.

Design guarantees:
- **Assign-existing-only** — the bot never creates or recolors roles. An admin creates them once; the bot only adds/removes by name (case-insensitive).
- **Permission-driven cleanup** — on every sync (character swap or `!sync`) it strips **all** of the member's permission-less cosmetic roles (any role with *Permissions: none*, plus the known managed identity names) and reapplies the correct ones. Roles that grant any permission, integration/booster roles, roles above the bot in the hierarchy, and any role in `role_sync.protected_roles` are never touched.
- **No-op skipping** — a per-member signature cache avoids redundant Discord API calls when nothing changed.
- **Fails safe** — role/nickname errors (e.g. hierarchy or owner-rename limits) are logged and skipped; the bot keeps running.

---

## Discord setup (required)

### 1. Create the application & bot
1. In the [Discord Developer Portal](https://discord.com/developers/applications), create an Application → **Bot**.
2. Copy the **bot token** (used as `bot_token` in config).
3. Under **Privileged Gateway Intents**, enable **Server Members Intent** (required for the role sync to fetch members) and **Message Content Intent** (required to read message text). Presence intent is optional.

### 2. Invite with the right permissions
Invite the bot (OAuth2 → URL Generator, scope `bot`) with at least:
- **Manage Roles** — to assign/remove the class/subclass/level/Section roles.
- **Manage Nicknames** — to append the level to nicknames.
- **Read Messages/View Channels**, **Send Messages**, **Read Message History** — for normal operation.

### 3. Create the roles
Create these roles **exactly** (matching is case-insensitive, but the names must otherwise match):

| Group | Role names |
| --- | --- |
| **Classes (3)** | `Hunter`, `Ranger`, `Force` |
| **Subclasses (12)** | `HUmar`, `HUnewearl`, `HUcast`, `HUcaseal`, `RAmar`, `RAmarl`, `RAcast`, `RAcaseal`, `FOmar`, `FOmarl`, `FOnewm`, `FOnewearl` |
| **Levels (21)** | `Rookie`, `LVL10`, `LVL20`, `LVL30`, `LVL40`, `LVL50`, `LVL60`, `LVL70`, `LVL80`, `LVL90`, `LVL100`, `LVL110`, `LVL120`, `LVL130`, `LVL140`, `LVL150`, `LVL160`, `LVL170`, `LVL180`, `LVL190`, `LVL200` |
| **Section IDs (10)** | `Viridia`, `Greenill`, `Skyly`, `Bluefull`, `Purplenum`, `Pinkal`, `Redria`, `Oran`, `Yellowboze`, `Whitill` |

You can create a subset to start — any missing role just produces a one-time warning in the logs and is skipped.

### 4. Role hierarchy & color
- **Drag the bot's own role ABOVE every managed role.** Discord forbids a bot from assigning or removing any role positioned at or above its own top role.
- **Color:** set colors on the **Section ID** roles. Either position the Section roles above the class/subclass/level roles, **or** leave the class/subclass/level roles colorless — so the member's displayed color resolves to their Section ID.
- The bot **cannot rename the server owner** (a hard Discord limitation); the owner's roles still apply, but their nickname won't change.

### 5. Account linking
Roles only apply to players who have linked their Discord account: sign in at
<https://psobb.io/login> and link Discord in the player dashboard. Unlinked users who
run `!sync` are told to do this.

---

## Configuration

The bot reads a JSON config from `/psobb-bot/discord_config.json` (see `src/config.js`).

```json
{
  "bot_token": "<discord bot token>",
  "gemini_api_key": "<google generative ai key>",
  "system_prompt": "<base persona / system instruction>",
  "psobb_api_url": "https://psobb.io/api/...?key=...",
  "psobb_api_secret": "<bearer token for the psobb API>",
  "channel_id": "<primary channel id the bot always listens in>",

  "role_sync": {
    "enabled": true,
    "interval_minutes": 5,
    "guild_id": "<your server id>",
    "nickname_level": true,
    "protected_roles": ["Verified", "Pronouns: They/Them", "1234567890"]
  }
}
```

`role_sync` is **optional** — if omitted, sync defaults to enabled with a 5-minute
interval, resolves the guild from the `channel_id`'s server, and appends the level to
nicknames. Set `"enabled": false` to turn the whole role system off.

| Key | Default | Notes |
| --- | --- | --- |
| `role_sync.enabled` | `true` | Master switch for the role/nickname system. |
| `role_sync.interval_minutes` | `5` | How often the automatic poll runs. |
| `role_sync.guild_id` | — | Target guild. Falls back to the `channel_id`'s guild, then the first guild. |
| `role_sync.nickname_level` | `true` | Whether to append ` [level]` to nicknames. |
| `role_sync.protected_roles` | `[]` | Roles the bot must **never** strip, even if they have no permissions. Matched case-insensitively by role **name or ID**. Use for opt-in cosmetic roles (pronouns, colors, event roles). |

---

## File & data layout

| Path | Purpose |
| --- | --- |
| `bot.js` | Entry point — wires events and logs the client in. |
| `src/config.js` | Loads runtime config + shared paths. |
| `src/discordClient.js` | The shared Discord.js client instance. |
| `src/api.js` | PSOBB server API calls + drops cache. |
| `src/socialMemory.js` | Per-user social-memory read/write. |
| `src/knowledgeBase.js` | Builds the knowledge-base string from `knowledge.md` + `rag/`. |
| `src/pso.js` | PSOBB game-data constants + value normalizers (classes, Section IDs, levels). |
| `src/session.js` | Detects a player's current in-game session. |
| `src/tools.js` | Gemini tool declarations + handlers. |
| `src/model.js` | The configured Gemini model (persona + knowledge + tools). |
| `src/roleSync.js` | Role & nickname sync system. |
| `src/messageHandler.js` | DM relay + main message/command/AI handler. |
| `knowledge.md` | Core lore / server knowledge loaded into the system prompt. |
| `rag/*.md` | Knowledge-base sources (classes, quests, drops, government tasks, etc.). |
| `/psobb-bot/discord_config.json` | Runtime configuration (not in the repo). |
| `/psobb-bot/memory/<discordId>.json` | Per-user social memory. |
| `/psobb-bot/memory/linked_roster.json` | Persisted set of Discord IDs known to be linked (role-sync fallback). |
| `/psobb-bot/memory/questions.log` | Append-only log of incoming questions. |

---

## Developer & ops scripts

These live at the repo root and are run manually (not part of the bot process):

| Script / file | Purpose |
| --- | --- |
| `test_api.js` | Quick smoke test of the PSOBB API — prints `get_online_players` and `get_events` responses. Run `node test_api.js`. |
| `diag_get_player.js` | Dumps the raw `get_player` API response for one Discord ID so you can see how many character slots the server returns and each slot's index/fields. Run `node diag_get_player.js <discord_id>`. |
| `get_player_all_slots.patch` | **Server-side patch for the psobb.io _website_ repo** ([`liquidspikes/psobb.io-website-public`](https://github.com/liquidspikes/psobb.io-website-public)), not this bot. It rewrites `api/bot_api.php`'s `get_player` action to enumerate **all** character save slots (0–19) instead of only the classic 4. Apply it there with `git apply get_player_all_slots.patch`, then `php -l api/bot_api.php`, then deploy. The bot needs no change to consume the extra slots. |

> The character-slot limit is a server-side concern: the bot already forwards every character the API returns. `diag_get_player.js` confirms the count before/after applying the patch.

---

## Running

```bash
npm install
node bot.js
```

Dependencies (see [`package.json`](package.json)): `discord.js`, `@google/generative-ai`, `axios`.

On startup you should see:
```
[INIT] Loaded RAG content from N files.
[READY] Bot is live: <bot tag>
[ROLE-SYNC] Active in "<guild>". Interval: 5 min. Roster: N linked. Protected roles: N.
```

### Verifying the role sync
1. Run `!sync` as a linked account → confirm the 4 roles apply, the nickname gains ` [level]`, and the color matches the Section ID. Run again → it should be a no-op (no role churn).
2. Level up / change class or Section in-game, wait one interval (or `!sync`) → old managed roles are removed and new ones applied; the nickname level updates.
3. Run `!sync` as an unlinked account → it returns the link-your-account instructions and changes nothing.
4. Watch for `[ROLE-SYNC] Missing role "…"` warnings to spot any roles you still need to create.
