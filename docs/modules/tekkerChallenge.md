# `src/tekkerChallenge.js` — Tekker Challenge minigame

> Game logic for the `❓ SPECIAL WEAPON` guessing minigame: rolling puzzles, scoring `/guess` attempts, minting/gifting reward tokens, and the despawn watcher. The backend (`bot_tekker_db.php`) is authoritative for stats; this module drives the Discord experience.

## Responsibility
- **Backend-authoritative drops:** `generateDrop()` asks the website to roll the stats, locked zeros + public hint, and despawn window, then announces *that* record (rolling locally would show a mismatched hint).
- **Score `/guess`:** the live path is the **slash command** `processSlashGuess(interaction)` — validates, applies the appraisal lock, scores Higher/Lower/Correct, runs the discovery + shift mechanics, and mints a token on a win.
- **Activity-driven spawning:** linked users' messages/reactions/voice roll a chance to trigger a new drop.
- **Despawn watcher:** a 30s interval expires drops past their `despawn_time` and posts the "signal lost" reveal.
- **Token ops:** gift (`giftReward`) and admin grant (`adminGrantToken`).

## Exports
| Symbol | Description |
| --- | --- |
| `generateDrop()` | Roll + persist a new drop (backend-authoritative); returns `null` if backend is down. |
| `announceDrop(drop)` | Post the drop embed to the tekker channel, pinging the online role. |
| `processSlashGuess(interaction)` | **Live path** — validate + score `/guess`; mint token on win. |
| `processGuess(message, args)` | **Legacy** prefix-`!guess` scorer; no longer routed (the `!guess` command now just redirects to `/guess`). |
| `trackActivity(userId, guild, type)` | Cooldown-gated chance to spawn a drop (linked users only). |
| `startDespawnWatcher()` | Start the 30s expiry/despawn interval (called once by `bot.js`). |
| `giftReward(ownerId, tokenId, targetId)` | Transfer a token. |
| `claimReward(userId, tokenId)` | **Legacy/unused** claim seam, still gated behind `config.tekker.claim_enabled`. No command calls it — `!claim` now points players to the website. |
| `adminGrantToken(ownerId, stats[5])` | Mint a token with set stats. |
| `isUserLinked(userId)` | Reads `linked_roster.json`. |
| `MASKED_WEAPON` | The `❓ SPECIAL WEAPON` label. |

## Depends on
[`config`](config.md), [`tekkerDb`](tekkerDb.md) (all persistence), [`actionLog`](actionLog.md), [`discordClient`](discordClient.md), `axios`. Reads `MEMORY_DIR/linked_roster.json` directly for the linked check.

## Depended on by
[`commands`](commands.md) (`!gift`/`!tekker grant`/`!tekker roll`), [`messageHandler`](messageHandler.md) (`/guess` slash + activity hooks), [`bot.js`](bot.md) (voice `trackActivity` + `startDespawnWatcher`).

## Config keys
`tekker.channel_id` (or `tekker_channel_id`), `role_sync.online_role_id` (the drop ping), `tekker.claim_enabled` (legacy claim seam — off).

## Key behaviors / gotchas
- **Channel-confined:** drops announce in, and guesses are only accepted in, the tekker channel (`tekker.channel_id`, fallback id hard-coded).
- **Attempts:** 5 base / **8 boosters** (`BOOSTER_ROLE_ID` is hard-coded, no config override — see `CODE_REVIEW_REPORT.md` risk #4). The slash path also **lazily regenerates 1 attempt/hour** since the last guess.
- **Stat legality** — every attribute, **Hit included**, is *divisible by 5 and 0–90%*. This mirrors the backend roll (`base` 15–80 + `±10` variance ⇒ hard ceiling 90; the PHP `min(100,…)` is a harmless over-clamp). The slash `/guess` options also set `min_value:0`/`max_value:90` so Discord rejects out-of-range input client-side. Enforced consistently in `processSlashGuess`, the legacy `processGuess`, and `adminGrantToken`.
- **Drop mechanics (slash path):**
  - **Appraisal lock** — a guesser holds a 10s lock (+5s fumble) so others can't snipe mid-inspection.
  - **Second-zero discovery** — one zero is the public hint; a hidden second zero is revealed publicly (`discoverSecondZero`) when a player guesses it 0 with ≤2 zeros total.
  - **Stat shifts / "instability"** — `incrementDropGuesses` can trigger a syndicate (public) shift, and exhausting a personal attempt budget triggers a silent individual shift (`shiftActiveDropStats`); both clear phase messages.
  - **Despawn pulse** — each guess calls `pulseDespawnTime` (adds time, capped); the watcher expires the drop when `despawn_time` passes.
- **Tokens carry no weapon** — only the five guaranteed percentages. A win mints a token (`createToken`); the winner sees it in the channel embed (and the slash path's persistent ephemeral reply). **Redemption happens on the website** (https://psobb.io/, while online in-game, combining up to 3 tokens); the bot never drops the item. *(The old per-win and per-guess hint DMs were removed — the ephemeral `/guess` reply already persists the player's result.)*
- Guild guess messages and per-attempt feedback auto-delete after 5s (needs Manage Messages); the win announcement and public wrong-guess line persist. All channel posts use `MessageFlags.SuppressNotifications` (the `@mention` highlights without pushing).

- **Test mode:** when [`tekkerDb`](tekkerDb.md) `LOCAL_MODE` is on (the in-process [`tekkerLocalStore`](tekkerLocalStore.md)), the drop announcement carries a **🧪 TEST MODE** field and every win embed appends a notice that the token is a **local test token** and **real rewards aren't generated until the website is brought up to date**. Default off; production never shows these.

## Related website endpoints
- [`bot_tekker_db.php`](../website-api/bot_tekker_db.md) — all state, via [`tekkerDb`](tekkerDb.md).
