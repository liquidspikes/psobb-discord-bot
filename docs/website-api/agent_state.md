# Website API — `api/agent_state.json`

> **Canonical source:** generated on the server into `psobb.io-website-public/api/agent_state.json` by an external decryption pipeline. **Not in the repo** (only an `agent_state.json.bak` sample exists).

A static JSON status file for the "Agent Decryption Matrix" feature.

## Consumed by (bot)
[`tools.js`](../modules/tools.md) `get_decryption_status` — `GET https://psobb.io/api/agent_state.json`.

## Fields the bot reads
`status`, `model`, `eta`, `unknown_fns`, `total_fns` (default 19362), `unknown_vars`, `total_vars`, `pipeline_phase`, `recompiler_status`, `recompiler_attempts`, `compile_errors`, `total_mods_all_time`, `modifications[]` (first 5 → `recent_impacts`).

The tool derives `percent_solved` = `(solvedFns + solvedVars) / (totalFns + totalVars) * 100`.

## Key behaviors / gotchas
- This is a real `.json` file served directly; the `.htaccess` `^([^\.]+)$` rewrite does **not** touch dotted paths, so the file must physically exist at `api/agent_state.json`.
- If the file is absent/unreadable, `get_decryption_status` returns `{ error }` and the feature is simply unavailable — no crash.
- Numeric fields may arrive as comma-formatted strings; the tool strips commas before parsing.
