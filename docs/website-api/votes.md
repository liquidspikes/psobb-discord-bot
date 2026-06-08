# External dependency — Mission Control vote files

> **Not a website endpoint and not in either repo.** The "server event voting" system (a.k.a. Mission Control vote) is driven by a **separate external script repo** that the bot only *reads from*. This doc describes how the bot is **currently** wired to that system and the issues that wiring has.

## What it is
Players react to a Discord poll message to choose the next server event/scenario (the EXP/drop "boost" events). The bot surfaces the live tally and the previous winner through two AI tools.

## Current data flow (as set up today)
```
[external gemini-psobb-scripts repo]                          [bot — src/tools.js]
  generates the vote                                           get_active_vote_status:
  posts the poll message to Discord                              reads current_vote.json,
  writes  current_vote.json  { message_id, candidates, date } ─► fetches message_id from
  on apply, writes:                                               config.channel_id,
    current_vote.json.applied                                     tallies message.reactions.cache
    pending_event.json.applied { scenario_id, title, ... }     get_recent_votes:
                                                                  + reads the two *.applied files
```

## Where the bot reads from (current, hard-coded)
- Single shared constant: **`VOTE_SCRIPTS_DIR = '/home/alexzimmerman/gemini-psobb-scripts'`** (`src/tools.js`, exported).
- Files: `current_vote.json`, `current_vote.json.applied`, `pending_event.json.applied`.
- Handlers: `get_active_vote_status`, `get_recent_votes` in [`tools.js`](../modules/tools.md).
- The poll **message is fetched from `config.channel_id`** — the bot's primary channel.

## Health-check gating (current)
The startup [health check](../modules/healthcheck.md) probes the **directory** `VOTE_SCRIPTS_DIR` for readability and gates the `vote` feature (both vote tools):
- **Dir unreadable/missing** → `vote` feature disabled → the tools return a "voting integration is offline" error the model relays, and it's logged + shown in the admin startup DM.
- **Dir present, no `current_vote.json`** → feature stays **up**; the tool returns its normal "No active vote found" message (an empty state, not an outage).
- Admins can re-probe with `!health` after fixing the path/permissions — no restart needed.

> The probe deliberately checks the **directory**, not the vote file, because an absent `current_vote.json` is the normal "no vote running" state.

## ⚠️ Known issues with the current setup
1. **Hard-coded path to another user's home dir.** The bot runs under `/psobb-bot/` (config `/psobb-bot/discord_config.json`, `!pull` cwd `/psobb-bot`), but the vote files are read from `/home/alexzimmerman/gemini-psobb-scripts/`. If that directory isn't present on the bot's host, or the bot's service user can't read it (home dirs are often `0700`), **every vote lookup returns "No active vote found."** This is the most likely cause of an outage and is now caught by the `vote_integration` health probe. (Also tracked as risk #2 in [`CODE_REVIEW_REPORT.md`](../../CODE_REVIEW_REPORT.md).)
2. **Channel coupling.** The poll message is fetched from `config.channel_id`. A Discord `message_id` only resolves in the channel it was posted in — if the external script posts the poll to a different channel than `config.channel_id`, `messages.fetch()` throws *Unknown Message* and the tool returns a generic error. **Not** caught by the health probe (the directory check passes; this fails later, inside the tool).
3. **External generator dependency.** The directory probe confirms the path is readable, **not** that the external script is actually running and producing fresh votes. A stale/abandoned `current_vote.json` still passes and would be reported as a live vote.
4. **JSON-shape coupling.** The bot hard-expects exactly `message_id`, `candidates`, `date` (and `scenario_id`, `title`, `desc`, `selection_method` in the applied files). If the external script renames a key, the bot reads `undefined` and returns an empty/garbled tally with no error.
5. **Tally baseline + custom emoji.** `reaction.count` includes whatever account seeded the option emojis, so tallies can be offset by one; the handler doesn't subtract a baseline. If the poll uses **custom emojis**, `reaction.emoji.name` is the shortcode, which may not line up with how `candidates` are keyed, so the model can't map votes to options.
6. **Upstream model age.** The bot uses `gemini-3.5-flash`, but the website's related `cron_community.php` still calls the retired `gemini-pro`. If the external vote generator shares that outdated model id, vote generation could be failing upstream (→ no `current_vote.json` produced).

## If you want to harden it further (not yet done)
See **[`VOTING_SYSTEM.md`](../../VOTING_SYSTEM.md)** in the repo root for the full proposed fix (tiered):
- **Tier 1:** make `VOTE_SCRIPTS_DIR` and the vote channel **configurable** in `discord_config.json` (defaulting to the current values), plus distinct logged errors per failure mode.
- **Tier 2 (recommended):** serve the vote over the website API (`bot_api.php?action=get_active_vote`) so the bot reads it over HTTP like every other dependency, instead of a foreign filesystem.
- **Tier 3:** the bot owns the poll end-to-end (post, tally, apply) and retires the external Discord-side script.
