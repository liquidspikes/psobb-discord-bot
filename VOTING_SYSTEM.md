# Mission Control Voting System — Current Setup & Proposed Better Fix

_Last updated: 2026-06-08_

This document covers how the bot currently consumes the server event ("boost") voting
system, confirms the recent changes are read-through compatible, and proposes a better fix.

Per-file detail of the current wiring + the full list of known issues lives in
[`docs/website-api/votes.md`](docs/website-api/votes.md). This doc is the **fix proposal**.

---

## 1. How it works today (unchanged)

The vote is produced by an **external script repo on the host** at
`/home/alexzimmerman/gemini-psobb-scripts/`, which posts the poll to Discord and writes
state files. The bot only **reads** them, via two AI tools in `src/tools.js`:

| File (under `VOTE_SCRIPTS_DIR`) | Read by | Keys the bot consumes |
| --- | --- | --- |
| `current_vote.json` | `get_active_vote_status`, `get_recent_votes` | `message_id`, `candidates`, `date` |
| `current_vote.json.applied` | `get_recent_votes` | `candidates`, `date` |
| `pending_event.json.applied` | `get_recent_votes` | `scenario_id`, `title`, `desc`, `selection_method` |

The poll message itself is fetched from `config.channel_id` and reactions are tallied live.

## 2. Read-through is preserved by the recent changes ✅

The recent work (a) hoisted the hard-coded path into one exported constant
`VOTE_SCRIPTS_DIR = '/home/alexzimmerman/gemini-psobb-scripts'` and (b) added a startup
health probe that gates the `vote` feature on that **directory** being readable.

- The constant resolves to the **exact same paths/files/keys** as before — no behavior
  change on the happy path.
- The health probe checks the **directory**, not `current_vote.json`, so "no vote running"
  is still a normal state, and **if the host owner fixes/restores the directory the bot
  reads through it again automatically** (next boot, or an admin `!health` with no restart).

In other words: these changes only add a clean "voting offline" signal when the path is
broken; they do not change or block access once it's working.

## 3. Why the current setup is fragile (summary)

See [`docs/website-api/votes.md`](docs/website-api/votes.md) for the full list. The headline
problems:

1. **Cross-user filesystem coupling.** The bot runs under `/psobb-bot/`, but reads vote
   files from another user's home dir (`/home/alexzimmerman/...`). This only works if the
   bot and the generator are co-located on the same host **and** the bot's service user can
   read that home dir (often `0700`). This is the most likely cause of an outage.
2. **Channel coupling.** A Discord `message_id` only resolves in the channel it was posted
   in; if the generator posts somewhere other than `config.channel_id`, the fetch fails.
3. **Shape coupling.** The bot hard-expects specific JSON keys; an upstream rename silently
   yields empty/garbled tallies.
4. **Tally accuracy.** `reaction.count` includes the seed reaction and custom-emoji names
   may not match `candidates` keys.

---

## 4. Proposed better fix

Three tiers, smallest first. **Tier 2 is the recommended target**; Tier 1 is a safe interim
that can ship immediately.

### Tier 1 — Make it configurable (quick win, low risk)
Move the hard-coded values into `discord_config.json`, defaulting to the current ones so
nothing changes until set:

```jsonc
"vote": {
  "dir": "/home/alexzimmerman/gemini-psobb-scripts", // default = current path
  "channel_id": "<id of the channel the poll is posted in>" // default = config.channel_id
}
```

- `src/tools.js`: `VOTE_SCRIPTS_DIR = (config.vote && config.vote.dir) || '/home/alexzimmerman/gemini-psobb-scripts'`,
  and use `config.vote.channel_id || config.channel_id` for the message fetch.
- Add **distinct, logged** errors in the two handlers (`logWarn('VOTE', …)`): missing dir vs.
  message-fetch-failed vs. bad JSON — so `!log` shows *which* failure occurred.
- **Removes the #1 fragility** (a wrong path/permission becomes a config change, not a code
  edit) and fixes the channel-coupling issue.

### Tier 2 — Serve the vote over the website API (recommended target)
Stop reading a foreign filesystem entirely. Have the **website** own the vote record (the
external generator writes the vote into the website DB, or posts it to a new endpoint), and
add a bot-API action the bot reads over HTTP like every other dependency:

- New action e.g. `bot_api.php?action=get_active_vote` → `{ message_id, channel_id, candidates, date, winner? }`.
- `src/tools.js` vote handlers call `apiCall('get_active_vote')` instead of `fs.readFileSync`.
- The health check's `vote_integration` probe becomes a normal **HTTP probe** (consistent
  with `bot_api`, `get_lfg`, etc.) — no filesystem/permission/co-location assumptions.

Benefits: removes cross-user filesystem coupling and the "must be the same host" constraint,
unifies auth + error handling with the rest of the bot's API usage, and lets the website be
the single source of truth for the vote (it already owns `community_events`).

### Tier 3 — Bot owns the poll end-to-end (largest, optional)
Since the bot already has Discord access, it could **post the poll itself**, persist the
`message_id` in its own `MEMORY_DIR`, tally reactions (subtracting the seed reaction, handling
custom emojis), and apply the winner via an API call — eliminating the external Discord-side
script. Biggest change; only worth it if you want to retire `gemini-psobb-scripts` for voting.

---

## 5. Recommendation

1. Ship **Tier 1** now — it directly removes the outage's root cause (hard-coded cross-user
   path) and adds diagnostics, with near-zero risk because defaults preserve current behavior.
2. Plan **Tier 2** as the durable fix so the bot consumes the vote the same way it consumes
   every other dependency (HTTP + the existing health-check pattern), instead of reaching into
   another process's home directory.

Until then, the current changes mean a fixed/restored directory is read through automatically,
and a broken one is clearly reported via `!health`, the startup admin DM, and the `vote`
feature's "temporarily unavailable" notice — instead of silently claiming "no active vote".
