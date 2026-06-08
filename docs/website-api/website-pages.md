# Website pages — generic content fetch

> No single canonical file — this documents how the bot reads **arbitrary** psobb.io pages as plain text.

## Consumed by (bot)
[`tools.js`](../modules/tools.md) `fetch_website_content({ path })`.

## Behavior
- `GET https://psobb.io<path>` (path forced to start with `/`).
- Strips `<script>`/`<style>` blocks and all tags, collapses whitespace, truncates to **8000 chars**.
- The STRATEGIC DIRECTIVE in [`model.js`](../modules/model.md) instructs the AI to use this for `/missions` (bounties), `/lfg` (groups), and `/about`, and to share **clean URLs without `.php`**.

## Relevant pages (rendered by the website repo)
| Path | Source file | Purpose |
| --- | --- | --- |
| `/missions` | `missions.php` | Active bounties / missions. |
| `/lfg` | `lfg.php` | Looking-for-group terminal. |
| `/about` | `about.php` | Server info. |
| `/drops`, `/legends`, `/stats`, … | respective `*.php` | Other public pages. |

## Key behaviors / gotchas
- Clean URLs work via the `.htaccess` rewrite (`/missions` → `missions.php`); the bot passes clean paths.
- This is a best-effort text scrape, not a structured API — for structured data prefer the dedicated tools (`search_drops`, `get_server_events`, etc.).
- 10s timeout; failures return `{ error }`.
