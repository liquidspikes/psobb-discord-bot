# `src/model.js` — Configured Gemini model

> Builds the Gemini `GenerativeModel`: persona + strategic directive + knowledge base + tool declarations.

## Responsibility
Instantiate `GoogleGenerativeAI(config.gemini_api_key)` and return a model whose `systemInstruction` = `config.system_prompt` + a large hard-coded **STRATEGIC DIRECTIVE** + the assembled **KNOWLEDGE BASE**, with `tools` attached.

## Exports
| Symbol | Type | Description |
| --- | --- | --- |
| `model` | `GenerativeModel` | Default cached `GenerativeModel` (`candidateModelNames[0]`). |
| `getModel(name)` | Function | Returns a cached `GenerativeModel` configured with `15000ms` request timeout and per-model `thinkingConfig`. |
| `buildGenerationConfig(name)` | Function | Sets `thinkingConfig: { thinkingLevel: 'MINIMAL' }` on supported Gemini 3.1/3.5/3.6 & Gemma 4 models. |
| `candidateModelNames` | `string[]` | Ordered fallback chain (`config.gemini_model || 'gemini-3.5-flash-lite'`, `'gemini-3.6-flash'`, `'gemini-flash-lite-latest'`, `'gemini-3.1-flash-lite'`, `'gemini-2.5-flash-lite'`, `'gemini-2.5-flash'`, `'gemma-4-31b-it'`). |
| `genAI` | `GoogleGenerativeAI` | Shared client instance. |

## Depends on
[`config`](config.md), [`knowledgeBase`](knowledgeBase.md), [`tools`](tools.md), `@google/generative-ai`.

## Depended on by
[`messageHandler`](messageHandler.md).

## Key behaviors / gotchas
- **High-capacity default fallback chain** prioritizes `gemini-3.5-flash-lite` -> `gemini-3.6-flash` -> `gemini-flash-lite-latest` -> `gemini-3.1-flash-lite` (avoiding the tighter `20 RPD` cap on `2.5` models while retaining `2.5` and `gemma-4-31b-it` as reserve fallbacks); `config.gemini_model` in `discord_config.json` remains optional as slot 1 override.
- Passes `{ timeout: 15000 }` as the **2nd argument** (`requestOptions`) to `genAI.getGenerativeModel()` so `@google/generative-ai` honors the HTTP timeout.
- The STRATEGIC DIRECTIVE encodes a lot of product behavior (tone by level, "never reveal Discord ID", "use clean URLs without `.php`", which tool to call for which question). Edit it here to change AI behavior — it is not in the config file.
- Uses the `@google/generative-ai` SDK alongside direct `generateContent({ contents })` turn management in [`messageHandler`](messageHandler.md).
