# `src/lfg.js` — LFG announcer

> Polls the website's `get_lfg` endpoint and posts each NEW Looking-For-Group request to a Discord channel, pinging the requested class roles.

## Responsibility
- Poll `get_lfg` (with `since_id` for incremental fetch), seed a cursor on first run to avoid dumping the backlog, and announce new posts.
- Resolve `looking_for` tokens (`HU/RA/FO`) to the `Hunter/Ranger/Force` roles and ping only those.

## Exports
| Symbol | Description |
| --- | --- |
| `startLfgWatcher()` | Resolve the channel and start the poll loop. |
| `buildAnnouncement(guild, post)` | Pure: `{ content, roleIds }` for a post. |

## Data / files touched
- `MEMORY_DIR/last_lfg_id.json` — `{ lastId }` cursor.

## Config keys
`lfg_sync.{enabled,channel_id,interval_seconds}` (or top-level `lfg_channel_id`). Floors: interval ≥ 15s. **Hard-coded channel-id fallback** `1502345296737337474`.

## Depends on
[`config`](config.md), [`discordClient`](discordClient.md), [`api`](api.md), [`actionLog`](actionLog.md).

## Depended on by
[`bot.js`](bot.md).

## Key behaviors / gotchas
- `allowedMentions` restricts pings to the resolved class role ids — never `@everyone`/users, even if embedded in the post description.
- First-ever run (no cursor) seeds to the server's `latest_id` and announces nothing.
- The endpoint returns raw (non-HTML-escaped) text because the consumer is Discord; mention safety is enforced bot-side.

## Related website endpoints
- [`bot_api.php` — `get_lfg`](../website-api/bot_api.md).
