# Tekker Challenge — Claim Integration Guide

The Tekker Challenge is **fully live except for in-game redemption**. Players earn
reward **tokens** by solving `/guess` puzzles; tokens are persisted per user and
can be gifted. Actually dropping the item in-game is **deferred** until the
website exposes a claim endpoint. This document explains exactly how to wire that
up when you're ready.

## Current state (what works today)

- **Earning:** winning a `/guess` puzzle calls `db.createToken(...)`, persisting a
  row in the website's `tekker_tokens` table — written by the bot through
  `api/bot_tekker_db.php` (op `createToken`). The bot has **no local
  database**; the website's SQLite DB is the single store.
- **Storage:** tokens survive restarts and are never auto-expired.
- **Viewing:** `!tokens` lists a user's unclaimed tokens (op `getUnclaimedTokens`).
- **Gifting:** `!gift <token_id> @user` transfers ownership (op `transferToken`).
- **Admin:** `!tekker tokens` DMs every token across players (op `getAllTokens`).
- **Claiming:** `!claim <token_id>` currently **does not drop an item**. It verifies
  ownership and replies that the token is saved and redemption is coming soon. No
  claim-drop call is made (the `claim_tekker_drop` action below isn't built yet).

### `tekker_tokens` schema (the source of truth)

| Column | Meaning |
|---|---|
| `token_id` | Public code, e.g. `T-ABCD23` |
| `owner_id` | Discord user id who currently holds it (changes on gift) |
| `stat_native / stat_abeast / stat_machine / stat_dark / stat_hit` | guaranteed percentages (0–100, Hit 0–50), all divisible by 5 |
| `is_claimed`, `claimed_by`, `claimed_at` | redemption bookkeeping (set when claiming goes live) |
| `created_at` | when the token was earned |

> The token deliberately carries **no weapon** — the tekker game only generates
> attribute/hit percentages. Which weapon those guaranteed stats apply to is a
> decision for the future claim page, not the bot.

## The integration seam (bot side)

Everything funnels through **`claimReward(userId, tokenId)`** in
[`src/tekkerChallenge.js`](src/tekkerChallenge.js). It already contains the
ready-to-go POST to the website, gated behind a config flag:

```js
if (!(config.tekker && config.tekker.claim_enabled)) {
    // returns { success:false, pending:true, message } — no network call
}
// ...otherwise it POSTs to action=claim_tekker_drop and, on success,
// calls db.markTokenClaimed(tokenId, userId).
```

When claiming is live, the bot sends (the weapon is the claim page's decision):

```
POST  <psobb_api_url>&action=claim_tekker_drop
Headers: Authorization: Bearer <psobb_api_secret>
         Content-Type: application/json
Body:   { "discord_id": "<id>", "token_id": "T-ABCD23",
          "stats": { "native":0, "abeast":90, "machine":0, "dark":55, "hit":20 } }
```

and expects back `{ "success": true, "message": "..." }` or
`{ "success": false, "error": "..." }`.

## What to build on the website (`api/bot_api.php`)

Add a Bearer-authed `action=claim_tekker_drop`, mirroring the existing actions.
Since claims mutate game state, accept a **POST** and read the JSON body:

```php
} elseif ($action === 'claim_tekker_drop') {
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $discord_id = $input['discord_id'] ?? '';
    $token_id   = $input['token_id'] ?? '';
    $stats      = $input['stats'] ?? null;   // { native, abeast, machine, dark, hit }
    if (!$discord_id || !$token_id || !$stats) { echo json_encode(["success"=>false,"error"=>"Missing data"]); exit; }

    // 1. Resolve the linked account (same lookup as get_player) and re-verify the
    //    token in tekker_tokens (owner matches, not already claimed) server-side.
    // 2. Decide WHICH weapon these guaranteed stats apply to — this is the claim
    //    page's job (e.g. a fixed reward weapon, a player choice from an allowed
    //    list, or a roll). The bot intentionally does not pick this.
    // 3. Verify the player is ONLINE in-game (check /y/clients for their AccountID),
    //    then grant the chosen weapon with the token's stats via the newserv
    //    interface (e.g. /y/shell-exec give-item).
    // 4. Mark the token claimed and echo json_encode(["success"=>true,"message"=>"..."]);
}
```

Notes / recommendations:
- **The weapon is chosen here, not stored on the token.** The token only guarantees
  the five attribute/hit percentages; the claim page maps those onto an actual item.
- **Make it atomic/idempotent** (see hardening below) and document the exact
  give-item format newserv expects.

## Turning it on

1. Implement `action=claim_tekker_drop` and deploy the website.
2. (Recommended) make the bot's claim **atomic/idempotent** — see below.
3. Add to `/psobb-bot/discord_config.json`:
   ```json
   "tekker": { "claim_enabled": true }
   ```
4. Restart the bot. `!claim <token>` now drops the item in-game and marks the token
   `is_claimed`.

## Hardening to do when you flip the switch

These are known gaps in the deferred path — address them as part of going live:

- **Atomicity / double-claim:** today `claimReward` checks `is_claimed`, then POSTs,
  then marks claimed. Two fast `!claim`s, or a POST that succeeds while
  `markTokenClaimed` fails, can double-drop. Reserve the token first (e.g.
  `UPDATE ... SET is_claimed=1 WHERE token_id=? AND is_claimed=0` and proceed only if
  one row changed; roll back on backend failure), or have the backend be idempotent.
- **Online check:** the drop should require the player to be logged in; return a
  friendly "log in and retry" error otherwise.
- **Linked check:** `claimReward` uses `isUserLinked()`, which reads
  `linked_roster.json` (the role-sync roster) — a linked website user who hasn't been
  picked up by role sync yet would be wrongly rejected. Prefer verifying via
  `get_player` (discord_id) like the rest of the bot, or have the PHP endpoint be the
  single source of truth and drop the bot-side check.
- **Gift validation:** `!gift` accepts a raw id and has no self-gift guard; tighten if
  abuse appears.

## File map

| Concern | Location |
|---|---|
| Claim seam + flag | `src/tekkerChallenge.js` → `claimReward()` |
| Storage client (HTTP) | `src/tekkerDb.js` — thin client for `api/bot_tekker_db.php` (no local DB) |
| Storage backend + tables | `psobb.io-website-public/api/bot_tekker_db.php` + `api/db.php` (`tekker_*` tables) |
| Commands (`!claim`/`!gift`/`!tokens`/`!tekker`) | `src/messageHandler.js` |
| Claim-drop endpoint (to add) | `psobb.io-website-public/api/bot_api.php` (`action=claim_tekker_drop`) |
