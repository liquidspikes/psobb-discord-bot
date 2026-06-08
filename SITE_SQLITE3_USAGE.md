# psobb.io Website — SQLite3 vs PDO Usage Report

_Generated: 2026-06-08_

## Summary

The **entire psobb.io website backend is built on the SQLite3 _extension class_** (`new SQLite3`, `SQLITE3_*` constants, `fetchArray()`, `querySingle()`, `changes()`), **not** PDO.

- **~64 PHP files** touch the database this way, across **~413 call sites**.
- The hub is `api/db.php` → `get_db()`, which returns a **`SQLite3`** object that every other file consumes.
- `api/config.php`'s `SQLiteSessionHandler` (the PHP session backend) also uses that `SQLite3` object directly.

## Architectural caveat

You **cannot** simply change `get_db()` to return a PDO object. Its return value's method surface — `querySingle()`, `fetchArray(SQLITE3_ASSOC)`, `bindValue(..., SQLITE3_TEXT)`, `changes()` — is used directly in all 64 files. Changing `get_db()` would break every consumer at once.

A site-wide migration to PDO therefore means rewriting each consumer (all ~413 call sites) individually — best done incrementally (one endpoint per change, `php -l` + smoke-test each) rather than touching `get_db()` directly.

## Files using the SQLite3 extension, by area

| Area | Files |
|---|---|
| **Core / shared** | `api/db.php` (`get_db()`), `api/config.php` (`SQLiteSessionHandler`), `api/functions.php` |
| **Bot API** | `api/bot_api.php` |
| **Cron jobs** | `api/cron_community.php`, `api/cron_missions.php`, `api/cron_streak_alert.php` |
| **Auth / accounts** | `api/login.php`, `api/register.php`, `api/change_password.php`, `api/forgot_password.php`, `api/reset_password.php`, `api/delete_account.php`, `api/admin_delete_account.php`, `api/discord_callback.php`, `api/discord_unlink.php` |
| **Economy / gameplay** | `api/claim_daily.php`, `api/claim_streak.php`, `api/claim_unlock.php`, `api/redeem_bounty.php`, `api/redeem_community.php`, `api/redeem_special_delivery.php`, `api/abandon_bounty.php`, `api/my_bounties.php`, `api/my_bounties_all.php`, `api/get_streak.php`, `api/get_unlocks.php`, `api/get_events.php`, `api/event_roster.php` |
| **LFG** | `api/lfg_requests.php`, `api/lfg_games.php`, `api/lfg_leave.php` |
| **Mods** | `api/submit_mod.php`, `api/mods.php`, `api/get_mods.php`, `api/rate_mod.php` |
| **Admin** | `api/admin_bot_tokens.php`, `api/admin_get_accounts.php`, `api/admin_get_claimed_characters.php`, `api/admin_reset_claim.php`, `api/admin_special_delivery.php`, `api/admin_user_search.php`, `admin/dashboard.php`, `admin/mods.php`, `admin/mission_manager.php` |
| **Misc / maintenance scripts** | `api/patch_all_missions.php`, `api/patch_boss_missions.php`, `api/patch_floor0_missions.php`, `api/patch_and_restore_abandoned.php`, `api/repair_floor_ids.php`, `fix_mission.php`, `fix_sildragon.php`, `seed_community_event.php`, `promote_admin.php`, `db/init_db.php`, `api/test_db.php` |
| **Frontend pages** | `legends.php`, `missions.php`, `top_hunters.php`, `api/get_display_name.php`, `api/set_display_name.php`, `api/set_lang.php`, `api/toggle_discord_streak.php`, `api/toggle_system_mail.php` |

## Note on the Tekker DB

`api/bot_tekker_db.php` was briefly converted to PDO, then **rolled back to SQLite3** at the user's request to stay consistent with the rest of the site (which is entirely SQLite3-based). The single, isolated PDO endpoint offered no benefit while diverging from the established `get_db()` pattern used everywhere else.
