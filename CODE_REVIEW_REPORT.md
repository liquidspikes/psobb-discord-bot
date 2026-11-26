# Code Review & Verification Report — PSOBB Discord Bot + psobb.io Website

_Generated: 2026-06-08 · Updated: 2026-06-08 (follow-up session)_

> **Follow-up changes since generation** (this session): tekker activity scanner gated behind `isFeatureUp('tekker')` + `tekker_db` error logging made circuit-breakered (log flood fixed); lurker badges reworked into tiers (`👀`/`⚠️👀`/`❗👀`); `!sync all` and `!interactions` **fully separated** (sync = linked players/💠 only; `!interactions build [deep]` owns the scan + census + eyes badges); 💠 now always overwrites eyes when a member becomes linked; vestigial roleSync exports trimmed; all living docs updated to match. Items below reflect the current state.

## Scope reviewed
- **Bot** (`psobb-discord-bot`): `bot.js` + all 25 modules under `src/` (including `jsonStore.js`), `tests/smoke.test.js`, configuration, and docs.
- **Website** (`psobb.io-website-public`): every bot-facing API endpoint — `bot_api.php`, `bot_tekker_db.php`, `get_drops.php`, `summary.php`, the `.htaccess` rewrite layer, and the section-ID/class maps the bot consumes.

All bot JavaScript passes `node --check` (no syntax errors). The architecture is clean: `bot.js` only wires events; each concern is isolated in its own module with consistent action-logging and defensive `try/catch` so one subsystem failing can't take down the others.

---

## Implemented features (verified functional)

| Feature | Status | Notes |
|---|---|---|
| **AI assistant (Gemini + tool-calling)** | ✅ | 11 tools wired with handlers; tool loop capped at 5 iterations; reply chunking under 2000 chars; per-user public-channel history isolation. |
| **Role & nickname sync** | ✅ | Assign-existing-only, permission-driven cleanup, no-op signature cache, per-user `!lock`, offline last-character cache. `!sync all` now syncs **linked players (💠) only**; 💠 always overwrites any lurker eyes (applied even on a role-assignment error). Solid. |
| **Boot self-check** (`selfCheck`) | ✅ | Genuinely good — exercises the sync hot path on a fixture at startup and DMs admins the result. |
| **Tekker Challenge minigame** | ✅ | Bot logic ↔ `bot_tekker_db.php` op surface matches 1:1; token mint/gift/claim/admin ops all present. |
| **Interaction log + badges** | ✅ | Tiered idle classification — `👀` (14–45d), `⚠️👀` (45d+), `❗👀` (never; deep scan only) — with disk-write throttling. Owned end-to-end by `!interactions build [deep]` (separated from `!sync`). |
| **LFG announcer** | ✅ | Cursor seeding avoids backlog dump; mention allowlist prevents `@everyone` injection from post text. |
| **Party voice rooms** | ✅ | Private per-game channels, state persisted, grace-period teardown, reconcile on boot. |
| **Admin commands** (`!sync all`, `!roles`, `!channels`, `!log`, `!clear`, `!pull`, `!restart`, `!tekker …`, `!interactions`) | ✅ | All routed, all permission-gated, DM-chunked reports. |
| **Website bot API** | ✅ | Dual-tier bearer auth (legacy secret + bcrypt `bot_tokens`), fatal-error JSON shielding, 20-slot character parsing, live-overlay merge. Well-built. |

---

## Bugs found

### 🔴 1. `!quests` shadowed by deprecated `!quest` handler — ✅ FIXED
> **Resolved.** `src/commands.js` now uses word-boundary matching (`/^[!$]quest(\s|$)/i`) for the deprecated `!quest`/`$quest` entry, so `!quests` passes cleanly through to the AI handler (`tests/smoke.test.js` verifies this).

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

1. **Gemini model configuration & fallback (`src/model.js` + `src/messageHandler.js`)** — ✅ **RESOLVED**. Replaced the stale single model ID with an ordered `candidateModelNames` fallback chain (respecting optional `config.gemini_model` override), per-model `thinkingConfig`, HTTP `429` cooldown tracking, and role-safe `functionResponse` turns.

2. **Hardcoded absolute path for the vote tools** (`src/tools.js` — `VOTE_SCRIPTS_DIR = '/home/alexzimmerman/gemini-psobb-scripts'`): centralized in one constant and gated by `healthcheck.js`, though still hardcoded to one host path.

3. **`agent_state.json` is not in the website repo** — only `agent_state.json.bak` exists statically. `get_decryption_status` fetches the live `.json` produced externally and fails gracefully if absent.

4. **Hardcoded Discord IDs**: `BOOSTER_ROLE_ID` (`tekkerChallenge.js`) and `ADMIN_AGENT_CHANNEL_ID` default (`messageHandler.js`) — document when deploying to a different guild.

5. **Legacy SDK**: `@google/generative-ai` is superseded by `@google/genai`, though functional today with the multi-model fallback wrapper in `messageHandler.js`.

6. **Automated smoke test runner (`tests/smoke.test.js`)** — ✅ **ADDED** (`npm test` runs `NODE_ENV=test node tests/smoke.test.js` without needing external network/Discord tokens). Removed obsolete manual root scratch probes (`diag_get_player.js`, `test_api.js`, `get_player_all_slots.patch`).

7. **Minor**: `handledMessages` dedup set is hard-cleared at >1000 entries (`messageHandler.js`), creating a tiny window where a just-seen message could be reprocessed. Low impact; a FIFO/TTL eviction would be cleaner.

8. **`!help` doc mismatch** — ✅ FIXED (2026-06-08). The README previously said "`!help` is intentionally left for the website," but `commands.js` routes `!help` (alias of `!commands`) to `handleHelpCommand`.

---

## Bottom line

The codebase is **well-structured, defensively written, and largely functional** — failure isolation, mention-injection guards, permission gating, smoke tests, and the boot self-check are all in place. Remaining items to tackle later are externalizing the hardcoded vote paths / booster role (risks #2, #4) and eventually migrating from `@google/generative-ai` to `@google/genai` (risk #5).
