# PSOBB Section IDs & Server Information

## Section IDs
Determined by character name at creation. Affects item drop tables.

| ID | Focus / Notable Drops |
| :--- | :--- |
| **Viridia** | Shots, Partisans. Good for RA. |
| **Greenill** | Rifles, Daggers. Standard RA ID. |
| **Skyly** | Swords, Rifles. Famous for **Sealed J-Sword**. Best for HU. |
| **Bluefull** | Partisans, Rods. Generally considered weaker for endgame. |
| **Purplenum** | Mechguns, Daggers. Famous for **Yasminkov 9000M** and **Psycho Wand**. |
| **Pinkal** | Wands, Partisans. Force-centric, higher Tech Disk drops. |
| **Redria** | Units, Frames, Barriers, Slicers. Excellent utility/armor ID. |
| **Oran** | Daggers, Swords, Twin Sabers. High drop rate for **Aura Field**. |
| **Yellowboze** | Balanced drops, high Meseta, increased Attribute chances. |
| **Whitill** | Slicers, Mechguns. Consistent all-rounder ID. |

---

## Server Information: PSOBB.io
- **Server Version:** Blue Burst (Episode 1, 2, and 4).
- **Rates:** Check `!rates` or the website sidebar for live EXP and Drop multipliers.
- **Commands:**
  - `/alt` or `/account`: Switch characters on the fly.
  - `/lobby`: Return to lobby.
  - `/modsecid`: (Note: Check server-specific rules for availability).
- **Community:** Feedback can be posted to the Discord forum.
- **Admins:** Contact @liquidSpikes for technical issues.

---

## Coren Tsu, The Wandering Tekker 🎲
**Coren Tsu** is a wandering merchant NPC located outside the shopping district in Pioneer 2 City / Lab. 
- He allows players to gamble Meseta for a chance at winning rare and powerful items!
- **Gamble Tiers:**
  - **1,000 Meseta**
  - **10,000 Meseta**
  - **100,000 Meseta**
- **Weekly Prize Schedule:** The available prize pool varies depending on the day of the week, with different rare item pools rotating each day.

---

## High-Frequency Boss & Floor Tracker ⏱️
Our server utilizes a high-frequency background daemon (running at 5-second intervals) that actively tracks player transitions and performance:
- **Boss Kill Tracking:** Automatically logs boss room entries, exits, and character EXP/item changes to verify boss kills and achievements.
- **Speedrun & Floor Clearing:** Records exact floor-to-floor transition times to track speeds and speedruns.
- Logs and progress are consumed by the server's mission system (`cron_missions.php`).
