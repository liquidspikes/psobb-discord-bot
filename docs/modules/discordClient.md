# `src/discordClient.js` — Shared Discord client

> The single `discord.js` `Client` instance imported by every module that talks to Discord.

## Responsibility
Construct and export one `Client` with a broad intents bitfield (`3276799`) and all numeric `Partials` enabled.

## Exports
| Symbol | Type | Description |
| --- | --- | --- |
| `client` | `Client` | The shared gateway client. |

## Depended on by
[`bot.js`](bot.md), [`messageHandler`](messageHandler.md), [`tools`](tools.md), [`system`](system.md), [`partyRooms`](partyRooms.md), [`tekkerChallenge`](tekkerChallenge.md), [`lfg`](lfg.md).

## Key behaviors / gotchas
- Intents `3276799` includes the **privileged** Server Members + Message Content intents — these must also be enabled in the Discord Developer Portal or login fails.
- Partials are enabled so DM channels / uncached reactions still deliver events (the DM relay in [`messageHandler`](messageHandler.md) relies on this).
- This module only constructs the client; **login happens in [`bot.js`](bot.md)**.
