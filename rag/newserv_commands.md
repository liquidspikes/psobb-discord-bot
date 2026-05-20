# PSOBB newserv In-Game Chat Commands (Player Reference)

This document provides a comprehensive list of standard, player-facing chat commands available to regular (non-admin) players on the `newserv` server.

---

## 1. How to Use In-Game Commands
*   **Command Prefix:** Type any command in the standard game chat box prefixed with a dollar sign (**`$`**).
*   **Escaping `$`:** If you want to type a normal chat message starting with `$`, type **`$$`** to prevent the server from interpreting it as a command.
*   **Command Output:** The results or status of your commands will appear directly in your local chat feed.

---

## 2. Standard Chat Commands (Always Available)

### `$li` (Lobby / Session Information)
*   **Description:** Displays basic information about the current lobby, game room, or proxy session you are in.
*   **Output:** Shows your current remote Guild Card ID, Client ID, and connection details.

### `$gc` (Guild Card Retrieval)
*   **Description:** Sends your own Guild Card directly to yourself.
*   **Usage:** Extremely useful if you forgot your Guild Card ID (account ID) or need to confirm it in-game.

### `$persist` (Room Persistence)
*   **Description:** Toggles whether the current room remains active even when all players leave.
*   **Usage:** Can be used to keep lobbies or specific game rooms open for friends to join later.

### `$surrender` (Episode 3 / Card Battle)
*   **Description:** Instantly forfeits the current Episode 3 Card Battle game.
*   **Usage:** Ends a card match early and awards the victory to your opponent.

### `$inftime` (Episode 3 / Card Battle)
*   **Description:** Sets turn timers to "no limit" in Episode 3 matches.
*   **Usage:** Allows you and your opponent to play without being restricted by turn time-limits.

---

## 3. Standard Navigation & Character Commands

### `/alt` or `/account`
*   **Description:** Switches characters on the fly without having to log out.
*   **Usage:** Type `/alt` followed by your character index or name to hot-swap.

### `/lobby`
*   **Description:** Immediately teleports your character back to the Pioneer 2 Lobby.
*   **Usage:** Can be used from Ragol to return home instantly.

### `/modsecid` (Subject to Server Rules)
*   **Description:** Modifies your character's Section ID to alter drop rates.
*   **Usage:** Check with server administrators on availability and rules regarding this command.

---

## 4. Cheat Mode Commands (Require Cheat Mode Enabled)
If the server has **cheat mode** enabled in its configuration, the following commands are available to all players:

### `$warp <area>`
*   **Description:** Instantly warps your character to a specified area or level on Ragol.
*   **Usage:** `$warp Forest1` or `$warp 1` (by Area ID).

### `$edit level <N>`
*   **Description:** Attempts to change your character's level to `<N>`.
*   **Note:** Changing level directly can sometimes cause issues with experience values. It is highly recommended to use `$edit exp` instead.

### `$edit exp <N>`
*   **Description:** Sets your total experience points to `<N>`, naturally adjusting your level.
*   **Usage:** `$edit exp 100000`.

### `$quest <partialName>`
*   **Description:** Initiates a specific quest from anywhere (requires leader status).
*   **Usage:** `$quest Mop-up`.
