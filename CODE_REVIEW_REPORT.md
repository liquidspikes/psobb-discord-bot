# Code Review & Verification Report — PSOBB Discord Bot + psobb.io Website

_Generated: 2026-06-08_

## Scope reviewed
- **Bot** (`psobb-discord-bot`): `bot.js` + all 18 modules under `src/`, configuration, and docs.
- **Website** (`psobb.io-website-public`): every bot-facing API endpoint — `bot_api.php`, `bot_tekker_db.php`, `get_drops.php`, `summary.php`, the `.htaccess` rewrite layer, and the section-ID/class maps the bot consumes.

All bot JavaScript passes `node --check` (no syntax errors). The architecture is clean: `bot.js` only wires events; each concern is isolated in its own module with consistent action-logging and defensive `try/catch` so one subsystem failing can't take down the others.

---

## Implemented features (verified functional)

| Feature | Status | Notes |
|---|---|---|
| **AI assistant (Gemini + tool-calling)** | ✅ | 11 tools wired with handlers; tool loop capped at 5 iterations; reply chunking under 2000 chars; per-user public-channel history isolation. |
| **Role & nickname sync** | ✅ | Assign-existing-only, permission-driven cleanup, no-op signature cache, per-user `!lock`, lurker/linked badge swap, offline last-character cache. Solid. |
| **Boot self-check** (`selfCheck`) | ✅ | Genuinely good — exercises the sync hot path on a fixture at startup and DMs admins the result. |
| **Tekker Challenge minigame** | ✅ | Bot logic ↔ `bot_tekker_db.php` op surface matches 1:1; token mint/gift/claim/admin ops all present. |
| **Interaction log + badges** | ✅ | 2-week active window with disk-write throttling. |
| **LFG announcer** | ✅ | Cursor seeding avoids backlog dump; mention allowlist prevents `@everyone` injection from post text. |
| **Party voice rooms** | ✅ | Private per-game channels, state persisted, grace-period teardown, reconcile on boot. |
| **Admin commands** (`!sync all`, `!roles`, `!channels`, `!log`, `!clear`, `!pull`, `!restart`, `!tekker …`, `!interactions`) | ✅ | All routed, all permission-gated, DM-chunked reports. |
| **Website bot API** | ✅ | Dual-tier bearer auth (legacy secret + bcrypt `bot_tokens`), fatal-error JSON shielding, 20-slot character parsing, live-overlay merge. Well-built. |

---

## Bugs found

### 🔴 1. `!quests` is broken — shadowed by the deprecated `!quest` handler
`src/messageHandler.js:245`
```js
if (message.content.startsWith('!quest') || message.content.startsWith('$quest')) {
    return await message.reply("📡 Notice: ...deprecated...");
}
```
`"!quests".startsWith("!quest")` is `true`, so `!quests` returns the *deprecated* notice and never reaches the AI handler at line 286. The README (lines 54, 121) and the line-286 routing both clearly intend `!quests` to call `get_player_info`. **A documented player command is dead.**

**Fix:** make the deprecation match exactly — e.g. `/^!quest(\s|$)/` / `/^\$quest(\s|$)/`, or move the `!quests`/`!progress`/`!progression`/`!stats` check above the `!quest` check.

### 🔴 2. Greenill-section players never get their Section ID role or color — ✅ FIXED (2026-06-08)
> **Resolved.** `bot_api.php` `$SECID_MAP` now returns single-n `Greenill`, and the online-overlay path normalizes the raw newserv `Greennill → Greenill`. The bot's `normalizeSectionId` (`src/pso.js`) now also accepts the double-n form as a guard. Verified.

The website is internally inconsistent on the spelling:
- `api/bot_api.php:89` (`$SECID_MAP`) returns **`Greennill`** (double-n) for `get_player` — the endpoint the bot uses.
- `api/get_drops.php:89` and `api/character_viewer.php` use **`Greenill`** (single-n), with `get_drops.php` explicitly patching `'Greennill' → 'Greenill'` ("Fix Newserv typo").

The bot's `src/pso.js` only knows `Greenill`:
```js
const norm = sectionId.charAt(0).toUpperCase() + sectionId.slice(1).toLowerCase();
return SECTION_ID_NAMES.includes(norm) ? norm : null;   // 'Greennill' → null
```
So `normalizeSectionId('Greennill')` returns `null` → no Section ID role assigned, and since color derives from the Section role, **no display color** either. Affects every Greenill player, online and offline.

**Fix (cleanest):** make `bot_api.php` normalize `Greennill → Greenill` like `get_drops.php` already does, so the whole site is consistent. (Or, as a bot-side guard, have `normalizeSectionId` accept the double-n variant.)

### 🟠 3. Latent: `pso.js` numeric class map disagrees with the canonical newserv map — ✅ FIXED (2026-06-08)
> **Resolved.** `src/pso.js` `CLASS_ID_MAP` IDs 5/10/11 corrected to `RAcaseal`/`FOmar`/`RAmarl` to match `bot_api.php` `$CLASS_MAP`. Verified.

`src/pso.js` `CLASS_ID_MAP` vs `bot_api.php` `$CLASS_MAP` (the comment in the PHP says it's verified against newserv `StaticGameData.cc`):

| ID | bot `pso.js` | website (canonical) |
|----|----|----|
| 5  | `RAmarl` ❌ | `RAcaseal` |
| 10 | `RAcaseal` ❌ | `FOmar` |
| 11 | `FOmar` ❌ | `RAmarl` |

Currently **dormant**, because `bot_api.php` returns class as a *string name*, and `normalizeClass` matches strings by name before ever hitting the numeric map. But it's a trap: if any code path ever feeds the bot a numeric `class2`, three subclasses get mislabeled.

**Fix:** correct IDs 5/10/11 in `pso.js` to match the canonical map.

---

## Foreseeable issues / risks

1. **Gemini model id `"gemini-3.5-flash"`** (`src/model.js:10`) — **verify this is a real, enabled model** on your API key. If the id is wrong, *every* AI reply throws and users only ever see the "Communication Interrupted" fallback. This is the single highest-impact thing to confirm before trusting the AI features.

2. **Hardcoded absolute paths for the vote tools** (`src/tools.js:130,162,190`): `/home/alexzimmerman/gemini-psobb-scripts/current_vote.json`. Tied to one machine/user. If the deploy path differs, `get_active_vote_status` / `get_recent_votes` silently return "No active vote." Move to config.

3. **`agent_state.json` is not in the repo** — only `agent_state.json.bak`. `get_decryption_status` fetches the live `.json`, which an external pipeline must generate. Also note the `.htaccess` `^([^\.]+)$` rewrite won't touch a path containing a dot, so the real file must physically exist at `api/agent_state.json`. Fails gracefully if absent, but the decryption tool is non-functional until that file is produced.

4. **Hardcoded Discord IDs**: `BOOSTER_ROLE_ID` (`tekkerChallenge.js:32`) has **no config override** (unlike the party/LFG/community IDs, which at least fall back through config). These tie the code to one specific guild — fine for a single-server deploy, but document it.

5. **Legacy SDK**: `@google/generative-ai` is the deprecated package (superseded by `@google/genai`). Works today; plan a migration.

6. **No real test runner**: `package.json` `test` is a stub; the only tests are manual scratch scripts (`scratch/test_*.js`). The boot `selfCheck` partially compensates for the role-sync path.

7. **Minor**: `handledMessages` dedup set is hard-cleared at >1000 entries (`messageHandler.js:49`), creating a tiny window where a just-seen message could be reprocessed. Low impact; a FIFO/TTL eviction would be cleaner.

8. **`!help` doc mismatch**: README line 53 says "`!help` is intentionally left for the website," but `messageHandler.js:271` routes `!help` to `handleHelpCommand`. Behavior is fine — just update the README.

---

## Bottom line

The codebase is **well-structured, defensively written, and largely functional** — failure isolation, mention-injection guards, permission gating, and the boot self-check are all above the bar for a hobby bot. Nothing is architecturally broken.

Before calling it fully verified, address in priority order:

1. **Confirm the Gemini model id** (risk #1) — gates all AI functionality.
2. ~~Fix the `Greennill`/`Greenill` mismatch (bug #2)~~ — ✅ fixed 2026-06-08.
3. **Fix the `!quests` shadowing** (bug #1) — one-line change restoring a documented command. _(still open)_
4. ~~Correct the `pso.js` class IDs (bug #3)~~ — ✅ fixed 2026-06-08. Still open: externalize the hardcoded vote paths / booster role (risks #2, #4).
