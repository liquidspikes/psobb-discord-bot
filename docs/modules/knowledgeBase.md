# `src/knowledgeBase.js` — Knowledge-base builder

> Concatenates the core lore file and every `rag/*.md` into one string fed into the model's system instruction.

## Responsibility
At `require` time, build `knowledgeBase`:
1. `=== CORE LORE & SERVER KNOWLEDGE ===` + contents of `MAIN_KNOWLEDGE_PATH` (`knowledge.md`).
2. `=== TECHNICAL DATA & DEEP DIVES ===` + each `*.md` under `RAG_PATH`, wrapped with `--- SOURCE: <file> ---`.

## Exports
| Symbol | Type | Description |
| --- | --- | --- |
| `knowledgeBase` | string | The assembled KB text. |

## Depends on
[`config`](config.md) — `RAG_PATH`, `MAIN_KNOWLEDGE_PATH`. `fs`.

## Depended on by
[`model`](model.md).

## Key behaviors / gotchas
- Runs **once at startup** — adding/editing `rag/*.md` requires a restart to take effect.
- Missing files/dirs are tolerated (logged, skipped).
- The entire KB is sent in the system prompt on every chat, so its size directly affects token cost/latency.
- Logs `[INIT] Loaded RAG content from N files.` to the console.
