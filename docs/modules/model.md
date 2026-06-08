# `src/model.js` — Configured Gemini model

> Builds the Gemini `GenerativeModel`: persona + strategic directive + knowledge base + tool declarations.

## Responsibility
Instantiate `GoogleGenerativeAI(config.gemini_api_key)` and return a model whose `systemInstruction` = `config.system_prompt` + a large hard-coded **STRATEGIC DIRECTIVE** + the assembled **KNOWLEDGE BASE**, with `tools` attached.

## Exports
| Symbol | Type | Description |
| --- | --- | --- |
| `model` | `GenerativeModel` | Used by `messageHandler` via `model.startChat()`. |

## Depends on
[`config`](config.md), [`knowledgeBase`](knowledgeBase.md), [`tools`](tools.md), `@google/generative-ai`.

## Depended on by
[`messageHandler`](messageHandler.md).

## Key behaviors / gotchas
- **Model id is `gemini-3.5-flash`** — verify this is a real/enabled model on the key; a wrong id makes every reply throw (see `CODE_REVIEW_REPORT.md`, risk #1).
- The STRATEGIC DIRECTIVE encodes a lot of product behavior (tone by level, "never reveal Discord ID", "use clean URLs without `.php`", which tool to call for which question). Edit it here to change AI behavior — it is not in the config file.
- Uses the legacy `@google/generative-ai` SDK (superseded by `@google/genai`).
