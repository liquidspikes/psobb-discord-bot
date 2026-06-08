# PSOBB Discord Bot

An AI-driven Discord companion for the **psobb.io** Phantasy Star Online: Blue Burst
server. It answers player questions using a Gemini model grounded in a local knowledge
base, pulls live data from the server's API (player stats, online players, drops,
events, votes, decryption status), and automatically mirrors each linked player's
in-game identity into Discord roles and nicknames.

Entry point is [`bot.js`](bot.js); the implementation is split into focused modules under [`src/`](src/).

## 📚 Documentation map (per-file docs)

Every module and every website dependency has its own reference doc under [`docs/`](docs/),
written so an AI agent (or human) can navigate and change the code without reading every
source file first. Each doc lists the module's **responsibility, exports, what it depends on,
what depends on it, data files, config keys, and gotchas** — start at [`docs/README.md`](docs/README.md)
and follow the links.

- **Start here:** [`docs/README.md`](docs/README.md) — the documentation index.
- **Bot modules:** one doc per file in [`docs/modules/`](docs/modules/) (e.g. [`roleSync.md`](docs/modules/roleSync.md), [`messageHandler.md`](docs/modules/messageHandler.md), [`tekkerChallenge.md`](docs/modules/tekkerChallenge.md)).
- **Website dependencies the bot consumes:** [`docs/website-api/`](docs/website-api/) — the contracts for `bot_api.php`, `bot_tekker_db.php`, `get_drops.php`, `summary.php`, `agent_state.json`, and generic page fetches (these `.php`/`.json` files live in the separate `psobb.io-website-public` repo; edit them there).

> Keep these docs in sync when you change a module's exports, data files, or config keys.

---

## Features

### AI assistant (Gemini)
- Conversational replies in DMs, when **@mentioned**, in the configured channel, or via commands.
- Grounded in a **local knowledge base**: [`knowledge.md`](knowledge.md) (core lore/server knowledge) plus every `*.md` file under [`rag/`](rag/) (class deep-dives, quests, drop tables, government tasks, area progression, etc.).
- **Tone adapts to player level** — kind to new players (Lvl 1–20), sassy to veterans (Lvl 100+).
- Per-user social memory — persists notes/relationships about each user under the memory directory and recalls them on the next interaction.
- Long replies are auto-split to respect Discord's 2000-character message limit.
- Public-channel history is isolated per user so the bot doesn't leak other people's context.

### Tekker Challenge (Minigame)
- Interactive Discord minigame where users guess hidden stats of a weapon (`❓ SPECIAL WEAPON`).
- Higher/Lower feedback mapped to standard emojis (🗡️, 🐾, 🤖, 👻, 🎯).
- Server boosters get 8 attempts, while base users get 5 attempts.
- Forced zero hint: the generator forces one weapon attribute to `0%` and uses it as the hint.
- Uniqueness-based activity trigger: message, reaction, and voice activity from linked users rolls a random chance to spawn a new puzzle, naturally preventing spam.
- Reward tokens: winning generates a unique claim code (`T-XXXXXX`) that users can check via `!tokens`, gift via `!gift`, or claim via `!claim`.

### Interaction Log & Lurker Badges
- A persistent record (`interactions.json`) of each user's **last** message/reaction timestamp, used to classify how long unlinked members have been idle.
- **Linked** members always wear the `💠` diamond (set by role sync, and it always overwrites any eyes — becoming linked wins). **Unlinked** members get a tiered eyes badge based on idle time: `👀` (idle 14–45 days), `⚠️👀` (45+ days), or `❗👀` (never interacted — only after a full-history deep scan). Admins and Community Support are exempt.
- Lurker badges are applied by **`!interactions build`**; the `!sync` commands handle linked players (`💠`) only — the two are separated. Live activity refreshes the timestamp immediately, but the eyes badge itself updates on the next `!interactions build`.

### Dependency health check & graceful degradation
On startup the bot **probes every website/server endpoint it depends on** and disables any
feature whose backend isn't reachable — so if the website hasn't been updated/deployed yet,
the bot doesn't run through code that calls a missing endpoint. Implemented in
[`src/healthcheck.js`](src/healthcheck.js).

- **Background features** (role-sync tick, LFG watcher, party rooms, the voice-activity Tekker
  trigger) are simply **not started** when their dependency is down.
- **Command features** (`!sync`, `!nickname`, `/guess`, `!tekker`, `!tokens`, `!claim`, `!gift`)
  reply to the invoker with a "temporarily unavailable" notice.
- **AI tools** (`search_drops`, `get_server_stats`, `get_decryption_status`) return an error the
  model relays to the user.
- Every result is logged under the `HEALTH` category and folded into the **admin startup DM**.
- Admins can re-probe at any time with **`!health`** — re-enabling a feature after the website is
  fixed **without restarting** the bot.

| Dependency | Gated feature |
| --- | --- |
| `bot_api.php` (`get_online_players`) | Role & nickname sync |
| `get_lfg` | LFG announcer |
| `get_parties` | Party voice rooms |
| `bot_tekker_db.php` (`ping`) | Tekker Challenge |
| `get_drops.php` | Drop search |
| `api/summary` | Live server stats |
| `api/agent_state.json` | Decryption status |
| Mission Control vote dir (external script) | Server event voting |

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

**Player commands**
- `!commands` (alias `!help`) — lists the player-facing commands and how to use them (admins also get a DM of the admin commands).
- `!stats`, `!quests`, `!progress`, `!progression` — routed to the AI (which calls `get_player_info` and reports character stats / quest & area-unlock progress).
- `!sync` — **manually refresh your roles and nickname** from your linked PSOBB account (see below). Reports the real outcome, including any missing roles or hierarchy/permission problems that blocked the change.
- `!lock secid` / `!unlock secid` — opt out of (or back into) the bot changing your **Section ID role** on a sync.
- `!lock nickname` / `!unlock nickname` — opt out of (or back into) the bot changing your **nickname** on a sync. `!lock` on its own shows your current settings.
- `!quest` / `$quest` — deprecated; returns a notice that bounties are now automatic.
- `/guess <Native> <A.Beast> <Machine> <Dark> <Hit>` (or `!guess`) — Guess the hidden stats of the active `❓ SPECIAL WEAPON` drop.
- `!tokens` — View your saved, unclaimed reward tokens.
- `!gift <token_id> @User` — Gift one of your reward tokens to another player.
- `!claim <token_id>` — Claim a reward token to drop it in-game.

**Admin commands** (require the **Administrator** permission; the report is sent to the requester via **DM**)
- `!sync all` — force a full re-sync of **every linked player** (everyone linked on the website, unioned with the persisted roster + currently-online players), online or offline. Posts a live progress line and a final summary. Respects each member's `!lock` settings.
- `!roles` — DMs a full **role audit**: classifies the bot's managed identity roles into ✅ ready / ❌ missing / ⬆️ above-the-bot, reports the bot's own Manage Roles permission and hierarchy position, and lists **every role on the server with the exact permissions it grants**.
- `!channels` — DMs a full **channel permission audit**: every channel (grouped under its category) with its **permission overwrites** — the per-role / per-member allow ✅ and deny ⛔ rules layered on the `@everyone` defaults.
- `!log [lines]` — DMs the most recent **backend actions** the bot has taken (role syncs, nickname changes, command invocations, PSOBB API calls, session lookups, tool executions, and errors — everything except the AI conversation itself). Defaults to the last 50; `!log 200` pulls the last 200 (see [Action log](#action-log)).
- `!restart` — **restarts the bot.** It confirms in-channel, then exits cleanly; the service supervisor relaunches a fresh process within a few seconds. **Requires the process to be supervised with an auto-restart policy** (see [Running as a service](#running-as-a-service)).
- `!tekker` — Show the current Tekker status (active drop, trigger pool, and threshold).
- `!tekker roll` (or `!tekker start`) — Force roll a new drop puzzle manually.
- `!tekker tokens` — DMs all reward tokens across all players (unclaimed, claimed, owner).
- `!tekker grant @User <Native> <A.Beast> <Machine> <Dark> <Hit>` — Grant a token with specified stats.
- `!tekker revoke <token_id>` — Delete a token.
- `!tekker give <token_id> @User` — Reassign a token to another user.
- `!tekker setclaimed <token_id> <on/off>` — Mark a token as claimed/unclaimed.
- `!tekker threshold [n]` — View or set the drop-trigger unique user threshold.
- `!interactions` — Display stats for the interaction log.
- `!interactions build` *(admin; optional `deep`)* — Scan message history (45 days, or full history with `deep`), census all members into the log, **and apply the tiered lurker badges** (`👀`/`⚠️👀`, plus `❗👀` on `deep`). This is the only command that writes lurker badges.
- `!interactions check @User` — Report the user's tier: `✅` active, `👀` (14–45d idle), `⚠️👀` (45d+), or `❗👀` (never).
- `!health` — Re-run the **website dependency health check** and DM/post a report of which dependencies are reachable and which features are consequently enabled/disabled. Use this after deploying website changes to re-enable a feature without restarting the bot.

- `!clear <count>` (alias `!purge <count>`) — **bulk-deletes the last `<count>` messages** in the channel it's run in. The count is required and explicit (e.g. `!clear 50`); it's capped at 500 and, per Discord's rules, can only remove messages newer than 14 days. The bot needs **Manage Messages** in that channel. **Clears over 100 messages require a react-to-confirm** (✅ within 30s) from the admin who ran it. Every use is logged (who cleared how many, where), and a short self-deleting confirmation is posted.

On every boot/reboot the bot **DMs each server admin** (members with the Administrator permission) a `✅ bot started at <timestamp>` notice — so you get confirmation after a `!restart`, a crash-relaunch, or a deploy. Admins with DMs disabled are skipped; the delivery count is recorded in the action log.

### Role & nickname sync ⭐
Mirrors a linked player's **currently-active (or most-recently-played) character** into Discord:

- **Class role** — `Hunter`, `Ranger`, or `Force`.
- **Subclass role** — one of the 12 (`HUmar`, `HUnewearl`, `HUcast`, `HUcaseal`, `RAmar`, `RAmarl`, `RAcast`, `RAcaseal`, `FOmar`, `FOmarl`, `FOnewm`, `FOnewearl`).
- **Level role** — `Rookie` (Lvl 1–9), then `LVL10`, `LVL20`, … `LVL200`.
- **Section ID role** — one of `Viridia`, `Greenill`, `Skyly`, `Bluefull`, `Purplenum`, `Pinkal`, `Redria`, `Oran`, `Yellowboze`, `Whitill`.
- **Nickname** — the character's live level is appended as `LVL<level>`, e.g. `Hunter Joe LVL142`.
- **Lurker Badge** — linked members who have never commented or reacted on the server get the `👀` badge prepended to their nickname, while active members get the `💠` badge. Swaps automatically on their first activity.
- **Display color** — comes from the **Section ID** role (Discord uses the highest *colored* role).

How it runs:
- **Automatic poll** on an interval (default 5 min). If the online feed exposes a Discord ID it syncs those players directly; otherwise it falls back to polling a persisted roster of known-linked members and syncs whoever is online.
- **`!sync`** for an instant, on-demand refresh of yourself.
- **`!sync all`** (admin) to force-sync everyone linked, online or offline.

Per-user opt-outs (`!lock`):
- **`!lock secid`** keeps the member's current **Section ID role** — sync neither strips it nor assigns a new one.
- **`!lock nickname`** leaves the member's **nickname** alone — sync won't append/update the `LVL<level>` suffix.
- Locks are stored per Discord ID in `memory/role_sync_locks.json` and apply to both the automatic tick and `!sync` / `!sync all`.

Design guarantees:
- **Assign-existing-only** — the bot never creates or recolors roles. An admin creates them once; the bot only adds/removes by name (case-insensitive).
- **Permission-driven cleanup** — on every sync (character swap or `!sync`) it strips **all** of the member's permission-less cosmetic roles (any role with *Permissions: none*, plus the known managed identity names) and reapplies the correct ones. Roles that grant any permission, integration/booster roles, roles above the bot in the hierarchy, and any role in `role_sync.protected_roles` are never touched.
- **No-op skipping** — a per-member signature cache avoids redundant Discord API calls when nothing changed.
- **Fails safe** — role/nickname errors (e.g. hierarchy or owner-rename limits) are logged and skipped; the bot keeps running.

### Action log
A central log of every backend action the bot takes — **excluding the AI chatbot conversation** (user message bodies and the model's generated replies are not recorded here). Implemented in [`src/actionLog.js`](src/actionLog.js).

What's captured, by category:

| Category | Examples |
| --- | --- |
| `SYSTEM` | Bot startup / ready. |
| `COMMAND` | `!sync`, `!sync all`, `!lock`/`!unlock`, `!commands`, `!roles`, `!channels`, `!log`, `!quest` (deprecated), `!stats`/`!quests`/`!progress` — with who ran them. |
| `ROLE-SYNC` | Per-member sync results, missing/unmanageable roles, nickname changes, roster additions, tick summaries, errors. |
| `API` | Every PSOBB API call (success + failure). |
| `DROPS` | Drop-table fetches / cache fallbacks. |
| `SESSION` | Online-session lookups for drop queries. |
| `TOOL` | Every AI tool execution and its arguments (e.g. `search_drops`, `update_social_memory`). |

Each entry is written to three places: the **console**, an in-memory **ring buffer** (the live "batch window", last 2000 actions), and a persistent file at `/psobb-bot/memory/actions.log` (auto-trimmed — capped at 10000 lines, trimmed back to 8000). Entry format:

```
[2026-06-06T18:03:11.244Z] [INFO] [ROLE-SYNC] Synced Hunter Joe#1234: [Hunter, HUmar, LVL140, Skyly] Lvl 142
```

Admins retrieve recent actions over DM with **`!log [lines]`** — default 50, capped at 10000, read from the persistent file so history survives restarts.

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
| `src/roleSync.js` | Role & nickname sync system + admin audit commands (`!sync`, `!roles`, `!channels`). |
| `src/actionLog.js` | Central action-log system (ring buffer + persistent file) and the `!log` command. |
| `src/system.js` | Process-level admin commands (the `!restart` command). |
| `src/messageHandler.js` | DM relay + main message/command/AI handler. |
| `src/interactions.js` | Persistent user interaction logging and admin commands. |
| `knowledge.md` | Core lore / server knowledge loaded into the system prompt. |
| `rag/*.md` | Knowledge-base sources (classes, quests, drops, government tasks, etc.). |
| `/psobb-bot/discord_config.json` | Runtime configuration (not in the repo). |
| `/psobb-bot/memory/<discordId>.json` | Per-user social memory. |
| `/psobb-bot/memory/linked_roster.json` | Persisted set of Discord IDs known to be linked (role-sync fallback). |
| `/psobb-bot/memory/last_character.json` | Last active character name seen per Discord ID while online — pins **offline** syncs to the player's last-used character. |
| `/psobb-bot/memory/interactions.json` | `{ users: { id: lastInteractionMs }, meta: { lastFullScanAt } }` (legacy flat `{ id: ts }` / boolean maps are migrated on load). |
| `/psobb-bot/memory/questions.log` | Append-only log of incoming questions. |
| `/psobb-bot/memory/actions.log` | Persistent backend action log surfaced by `!log` (auto-trimmed to ~8–10k lines). |

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

### Running as a service
The `!restart` command works by **exiting the process cleanly** and relying on a supervisor to relaunch it — so the bot must run under a process manager with an auto-restart policy (without one, `!restart` would simply stop the bot for good).

This deployment uses **systemd**. Example unit (`/etc/systemd/system/psobb-bot.service`):

```ini
[Unit]
Description=PSOBB Discord Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/psobb-discord-bot
ExecStart=/usr/bin/node bot.js
Restart=always
RestartSec=3
# Allow the manual !restart (and crash-loops) to recover without tripping the rate limiter:
StartLimitIntervalSec=0

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now psobb-bot
journalctl -u psobb-bot -f    # follow logs
```

`Restart=always` is what makes `!restart` (which calls `process.exit(0)`) bring the bot back automatically. `StartLimitIntervalSec=0` prevents systemd from refusing to restart after several quick restarts.

On startup you should see (action-log entries are tagged `[LEVEL] [CATEGORY]`):
```
[INIT] Loaded RAG content from N files.
[<timestamp>] [INFO] [SYSTEM] Bot is live: <bot tag>
[<timestamp>] [INFO] [ROLE-SYNC] Active in "<guild>". Interval: 5 min. Roster: N linked. Protected roles: N.
```

### Verifying the role sync
1. Run `!sync` as a linked account → confirm the 4 roles apply, the nickname gains ` LVL<level>`, and the color matches the Section ID. Run again → it should be a no-op (no role churn). Then `!lock secid` and `!lock nickname`, change Section ID / level in-game, and `!sync` again → the Section ID role and nickname stay put while other roles update.
2. Level up / change class or Section in-game, wait one interval (or `!sync`) → old managed roles are removed and new ones applied; the nickname level updates.
3. Run `!sync` as an unlinked account → it returns the link-your-account instructions and changes nothing.
4. Run `!roles` (as an admin) to see the full role audit — which managed roles are ready, missing, or positioned above the bot — or watch for `[WARN] [ROLE-SYNC] Missing role "…"` warnings in the console/`actions.log`.
