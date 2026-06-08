# PSOBB Discord Bot Command Reference

A comprehensive list of all player-facing and administrator commands available on the bot.

---

## 🎮 Player Commands

*   **`!commands`** (alias **`!help`**)
    *   *Usage*: `!commands`
    *   *Purpose*: Lists all player-facing commands in the server.
*   **`!sync`**
    *   *Usage*: `!sync`
    *   *Purpose*: Instantly syncs your character roles (Class, Subclass, Level, Section ID) and nickname format (badges and level suffix) with your linked website account.
*   **`!lock`**
    *   *Usage*: `!lock` or `!lock [secid | nickname]`
    *   *Purpose*: Without arguments, lists your current sync locks. Locks prevent the bot from overwriting specific fields:
        *   `!lock secid`: Lock your current Section ID role.
        *   `!lock nickname`: Lock your nickname level-suffix (stops appending `LVL <level>`).
*   **`!unlock`**
    *   *Usage*: `!unlock [secid | nickname]`
    *   *Purpose*: Removes a lock to let the bot manage that role/field on syncs again.
*   **`!nickname`** (alias **`!nick`**)
    *   *Usage*: `!nickname <new_name>`
    *   *Purpose*: Updates your server nickname while keeping the bot-managed elements (`👀`/`💠` badges and `LVL` suffix).
*   **`/guess`** (accepts prefix **`!guess`**)
    *   *Usage*: `/guess <Native> <A.Beast> <Machine> <Dark> <Hit>` (e.g. `/guess 0 90 0 55 20`)
    *   *Purpose*: Submits a guess to resolve the hidden stats of the active **`❓ SPECIAL WEAPON`** drop challenge.
*   **`!tokens`**
    *   *Usage*: `!tokens`
    *   *Purpose*: Displays a list of all your saved unclaimed reward tokens.
*   **`!gift`**
    *   *Usage*: `!gift <token_id> @Player`
    *   *Purpose*: Transfers ownership of one of your reward tokens to another player.
*   **`!claim`**
    *   *Usage*: `!claim <token_id>`
    *   *Purpose*: Redeems a reward token (spawns the item in-game at your feet once claim integration is live).
*   **`!stats` / `!quests` / `!progress` / `!progression`**
    *   *Usage*: `!stats`
    *   *Purpose*: Commands starting with these prefixes are forwarded to the AI assistant to query and report your live character information, levels, and warps.

---

## 🔐 Admin Commands
*Require the **Administrator** permission. Audit reports are delivered via **DM** to the sender to prevent channel clutter.*

*   **`!sync all`**
    *   *Usage*: `!sync all`
    *   *Purpose*: Forces a full re-sync of all linked players in the server (online and offline) to correct their roles/nicknames.
*   **`!roles`**
    *   *Usage*: `!roles`
    *   *Purpose*: Audits server roles to ensure they match expected names and lists permissions and position hierarchy relative to the bot.
*   **`!channels`**
    *   *Usage*: `!channels`
    *   *Purpose*: Audits server channel permission overwrites and DMs the report.
*   **`!log`**
    *   *Usage*: `!log [lines]` (e.g. `!log 200`)
    *   *Purpose*: DMs the most recent bot action logs (sync triggers, errors, API counts).
*   **`!restart`**
    *   *Usage*: `!restart`
    *   *Purpose*: Gracefully exits the process so systemd/supervisor manager relaunches it.
*   **`!clear`** (alias **`!purge`**)
    *   *Usage*: `!clear <count>` (e.g. `!clear 50`)
    *   *Purpose*: Bulk deletes messages from the current channel (requires confirmation for counts over 100).
*   **`!pull`** (aliases **`!gitpull`**, **`!update`**)
    *   *Usage*: `!pull`
    *   *Purpose*: Runs git pull and exits to automatically restart with the latest codebase updates.

### 🗡️ Tekker Admin Controls
*   **`!tekker`** (without arguments)
    *   *Usage*: `!tekker`
    *   *Purpose*: Shows the status of the current drop puzzle or active unique users trigger pool.
*   **`!tekker roll`** (alias **`!tekker start`**)
    *   *Usage*: `!tekker roll`
    *   *Purpose*: Force-generates a new active drop puzzle instantly, resetting the trigger pool.
*   **`!tekker tokens`**
    *   *Usage*: `!tekker tokens`
    *   *Purpose*: DMs a registry of all reward tokens across all players in the server.
*   **`!tekker grant`**
    *   *Usage*: `!tekker grant @User <Native> <A.Beast> <Machine> <Dark> <Hit>`
    *   *Purpose*: Mints and assigns a custom token directly to a player's inventory.
*   **`!tekker revoke`** (alias **`!tekker delete`**)
    *   *Usage*: `!tekker revoke <token_id>`
    *   *Purpose*: Deletes/voids an active token.
*   **`!tekker give`** (alias **`!tekker setowner`**)
    *   *Usage*: `!tekker give <token_id> @User`
    *   *Purpose*: Reassigns an existing token's ownership to another player.
*   **`!tekker setclaimed`**
    *   *Usage*: `!tekker setclaimed <token_id> <on | off>`
    *   *Purpose*: Manually marks a token claimed or unclaimed.
*   **`!tekker threshold`**
    *   *Usage*: `!tekker threshold [number]`
    *   *Purpose*: Views or updates the threshold count of unique active users required for a 100% trigger probability.

### 🗒️ Interaction Log Controls
*   **`!interactions`** (without arguments)
    *   *Usage*: `!interactions`
    *   *Purpose*: Displays summary statistics for the server's user interaction log.
*   **`!interactions build`** (optional `deep`)
    *   *Usage*: `!interactions build` or `!interactions build deep`
    *   *Purpose*: Scans message history (45 days, or full history with `deep`), censuses all non-bot members into `interactions.json`, **and applies the tiered lurker badges** to unlinked members: `👀` (idle 14–45d), `⚠️👀` (idle 45d+), and — `deep` only — `❗👀` (never interacted). This is the only command that writes lurker badges; `!sync all` handles linked players (`💠`).
*   **`!interactions check`**
    *   *Usage*: `!interactions check @User`
    *   *Purpose*: Reports the user's tier: `✅` active, `👀` (14–45d idle), `⚠️👀` (45d+ idle), or `❗👀` (never interacted).
