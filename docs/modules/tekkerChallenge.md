# `src/tekkerChallenge.js` — Tekker Challenge minigame

> Game logic for the `❓ SPECIAL WEAPON` guessing minigame: rolling puzzles, scoring guesses, minting/gifting/claiming reward tokens.

## Responsibility
- Roll legal random stats (forced-0% hint, ≤3 non-zero attributes), announce a drop, score `/guess` attempts (Higher/Lower/Correct), and mint a token on a win.
- Activity-driven spawning: linked users' messages/reactions/voice roll a chance to trigger a new drop.
- Token operations: gift, claim (gated), admin grant.

## Exports
| Symbol | Description |
| --- | --- |
| `generateDrop()` | Roll + persist a new drop. |
| `announceDrop(drop)` | Post the drop embed to `channel_id`. |
| `processGuess(message, args)` | Validate + score a `/guess`; mint token on win. |
| `trackActivity(userId, guild, type)` | Cooldown-gated chance to spawn a drop. |
| `giftReward(ownerId, tokenId, targetId)` | Transfer a token. |
| `claimReward(userId, tokenId)` | Redeem (currently gated off). |
| `adminGrantToken(ownerId, stats[5])` | Mint a token with set stats. |
| `isUserLinked(userId)` | Reads `linked_roster.json`. |
| `MASKED_WEAPON` | The `❓ SPECIAL WEAPON` label. |

## Depends on
[`config`](config.md), [`tekkerDb`](tekkerDb.md) (all persistence), [`actionLog`](actionLog.md), [`discordClient`](discordClient.md), `axios`. Reads `MEMORY_DIR/linked_roster.json` directly for the linked check.

## Depended on by
[`messageHandler`](messageHandler.md) (commands + activity), [`bot.js`](bot.md) (voice `trackActivity`).

## Key behaviors / gotchas
- **Hard-coded `BOOSTER_ROLE_ID = '1500893249861324832'`** with no config override (boosters get 8 attempts vs 5). See `CODE_REVIEW_REPORT.md` risk #4.
- Stat legality: divisible by 5, Hit ≤ 50, others ≤ 100, ≤ 3 non-zero, hint attribute forced 0%.
- Trigger chance = `min(1, uniqueActiveUsers / threshold)`; threshold default 30, configurable via `!tekker threshold`.
- **Claiming is intentionally not live**: `claimReward` returns a "saved, redeem later" message unless `config.tekker.claim_enabled` is set. The `claim_tekker_drop` POST is the ready-to-go seam (see `TEKKER_CLAIM_INTEGRATION.md`).
- Guess messages auto-delete after 10s (needs Manage Messages); win/loss reports post to the channel (not as replies).

## Related website endpoints
- [`bot_tekker_db.php`](../website-api/bot_tekker_db.md) — all state, via [`tekkerDb`](tekkerDb.md).
- `bot_api.php?action=claim_tekker_drop` — future claim endpoint (not yet implemented).
