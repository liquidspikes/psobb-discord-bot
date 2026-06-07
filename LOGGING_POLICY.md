# PSOBB Discord Bot — Logging Policy & Diagnostics

This document outlines the logging strategy implemented in the bot, detailing which gateway events, commands, and background loops produce logs under `/psobb-bot/memory/actions.log` vs. which are kept silent to prevent log bloat.

---

## 🟢 Logged Events (Active)

These events are actively written to the console and to the action log for auditing and debugging:

### 1. Bot Startup & Integrity Check (`SYSTEM`)
*   **Trigger**: When the bot is successfully ready and connected.
*   **Logs**:
    *   Websocket connection success and bot tag identifier.
    *   Startup self-check integrity diagnostics.
    *   Number of loaded RAG markdown files.
    *   Active guild name, polling interval, linked roster count, and protected cosmetic roles.
*   **Example**: `[INFO] [SYSTEM] Bot is live: PSOBB Bot#1234`

### 2. Command Executions (`COMMAND`)
*   **Trigger**: Any text command beginning with `!` or `/` executed in a server channel.
*   **Logs**: Command name, arguments (if any), user tag, and user Discord ID.
*   **Example**: `[INFO] [COMMAND] !sync by User#1234 (123456789)`

### 3. Role & Nickname Sync Updates (`ROLE-SYNC`)
*   **Trigger**: Whenever a linked character is synced (automatically on tick or manually via `!sync`).
*   **Logs**:
    *   Successful character profile detection and role mapping.
    *   Role comparison errors (such as hierarchy blockages or missing roles).
    *   Nicknaming errors.
    *   Summary of updated members at the end of each sync tick.
*   **Example**: `[INFO] [ROLE-SYNC] Synced User#1234: [Hunter, HUmar, LVL140] Lvl 140`

### 4. Tekker Challenge Events (`TEKKER`)
*   **Trigger**: Solves, manual drops, or token modifications.
*   **Logs**:
    *   Successful guesses and token generation details.
    *   Manual admin roll triggers.
    *   Token grants, revokes, ownership transfers, and claim status edits.
*   **Example**: `[INFO] [TEKKER] Win: User#1234 solved stats 15/0/35/0/10 on attempt 3/5 → token T-ABCD23`

### 5. Website API Failures & Diagnostic Warnings (`API` / `API-ERROR`)
*   **Trigger**: Any HTTP connection failures, 500 server-side errors, or timeouts when calling the `psobb.io` API.
*   **Example**: `[ERROR] [API] claim_tekker_drop [500] → Internal Server Error`

---

## 🔇 Muted Events (Silent)

To protect the server disk space and keep log logs readable, the following events are processed **silently** and do not write to the action logs on success:

### 1. Chat Message & Reaction Activity Triggers
*   **Policy**: Silent by default.
*   **Detail**: Every user message and reaction contribution flips their interaction state to `true` (removing the `👀` lurker badge) and rolls a random chance to spawn a puzzle. This background loop is silent.
*   **Exception**: A log entry is only created if the activity trigger successfully succeeds and rolls a new puzzle:
    *   `[INFO] [TEKKER] Activity trigger succeeded: unique contributors = N/T. Launching drop...`

### 2. Voice Channel Scanning Loops
*   **Policy**: Silent by default.
*   **Detail**: Guild voice channels are scanned every 1 minute to index active linked users. Checks and idle passes write no logs.
*   **Exception**: An entry is only logged if a voice user's check triggers a puzzle, or if the scan encounters a process/API error.

### 3. LFG Watcher & Roster Synchronization Ticks
*   **Policy**: Silent on success.
*   **Detail**: The bot polls looking-for-group posts and linked accounts list periodically. Successful queries write no logs.
*   **Exception**: Logs are written when a new LFG post is matched and mirrored to the channel, or if the API endpoint becomes unreachable.
