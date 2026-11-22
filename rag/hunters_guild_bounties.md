# Hunter's Guild Bounty Board & Mission Guide

Pioneer 2's **Hunter's Guild** (`https://psobb.io/missions` and the **Guild** tab on `https://psobb.io/`) automatically assigns and tracks bounties while you play on the server. When you complete an objective, claim your reward in the **Guild Claim Center** on `https://psobb.io/missions` while logged into the **exact character** shown on the bounty and standing inside an **active game** (not a lobby).

---

## 1. Bounty Pools, Active Slots, Caps & Resets

All slots and earning caps are tracked **per character**:

| Pool | Active Slots | How Bounties Are Earned | Limit | Expires at Reset? |
| :--- | :---: | :--- | :---: | :--- |
| **Daily** | 3 | Being online (10%/min), +1 when completing a Daily | 5 earned / day | Yes (`00:00 America/Chicago`) |
| **Weekly** | 3 | Being online (3%/min), +1 when completing a Weekly | 10 earned / week | Yes (Monday `00:00 America/Chicago`) |
| **Drop** | 5 (dedicated) | Boss kills (5% Normal / 8% Hard / 12% VH / 18% Ult) & Rare enemies (10% / 15% / 20% / 30%) | Max 10 held (active + waiting) | Yes (Daily or Weekly depending on tier) |
| **Battle Mode** | 3 (Dailies) | Playing Battle Mode (25%/min) or Normal/Solo (10%/min), +1 on completion | 3 earned / day | Yes (`00:00 America/Chicago`) |
| **Challenge Mode** | 3 (Weeklies) | Playing Challenge Mode (25%/min) or Normal/Solo (3%/min), +1 on completion | 3 earned / week | Yes (Monday `00:00 America/Chicago`) |
| **Contract** | 3 held (dedicated) | 25% of Ultra Rare & Mythic Rare drops roll as Contracts instead | Max 3 held (no queue) | **Never expires** |

- **Up Next Queue:** Bounties earned while a pool's active slots are full wait under **Up Next** on `/missions`. When a slot opens, the oldest waiting bounty activates and generates its objective, story, and area reward scaled to your character's current level. Waiting bounties can be discarded anytime.
- **No Cap-Farming via Abandon:** Earning caps count every bounty *earned* during the period, regardless of whether you finish or abandon it.
- **What Never Expires:** Finished bounties waiting in **`Ready to Redeem`** and all **Contracts** never expire. (Pre-rework legacy bounties keep a 30-day grace period.)
- Nothing drops inside Battle Mode or Challenge Mode games. If you already hold 3 Contracts, an Ultra/Mythic drop becomes a normal Weekly Drop Bounty instead.

---

## 2. Rarity Tiers, Rewards & Hidden Stats

| Tier | Where It Comes From | Primary Reward & Bonuses |
| :--- | :--- | :--- |
| **Common** | Free (60%), Drops, Battle, Challenge (45%) | 2–3 level-scaled tool/consumable stacks + Meseta; 15% chance for Photon Drops |
| **Uncommon** | Free (30%), Drops, Battle, Challenge (30%) | 1–2 class-usable gear pieces (+10 levels ahead) with light stats + Meseta; 25% Photon Drops; 20% Exchange Token |
| **Rare** | Free (10%), Drops (50% Daily / 50% Weekly), Battle, Challenge (17%) | Class-usable Rare from the bounty's area (1/5,000–1/20,000 server-wide band, at least 10x your Section ID's best per-kill rate); 40% Photon Drops; 35% Exchange Token |
| **Ultra Rare** | Drops in **parties of 2+** (Weekly), Challenge (6%) | Any-class Very Rare drop (<1/20,000 per kill server-wide, 10x rule) from the bounty's area; 60% Photon Drops; 5% **Photon Sphere**; 60% Exchange Token |
| **Mythic Rare** | Drops **when solo** (Solo mode, or alone in a Multi-mode room at 1.5x odds; Weekly) & Challenge full runs (2%) | Quest-reward exclusive for any class (or 3% chance of an exchange-only prize like *Liberta Kit* or *Tablet*); Challenge full runs & Mythic Run Contracts pay 1/75,000+ endgame rares; 80% Photon Drops (20–60 at Lv 200); 15% **Photon Sphere**; **100% Exchange Token** |

- **Hidden Stats Roll on Claim:** Weapon attributes (up to 2 area-themed attributes up to 90% + up to 50% Hit; Challenge full-run weapons guarantee two 60–90% attributes + 30–50% Hit), armor slots, and DEF/EVP bonuses stay hidden until you claim the bounty, rolling once permanently at claim time.
- **Exchange Tokens:** Uncommon–Mythic bounties can award Dr. Osto **Enemy Parts** (19 tradable parts in Ep1/Ep2), **Item Tickets** (*Item Present* shop — including classic Mag Cells), **Secret Tickets** (*Good Luck!* lottery), **Photon Tickets** (*Gallon's Plan*), **Photon Crystals** (*Black Paper's Dangerous Deal*), or **Weapons Badges** (*AOL CUP*).
- **Exclusions & Normal Play:** Bounties never directly award Challenge Mode S-Rank prizes, combination results (Merges, combined weapons/Mags), or common rares (1/5,000 or better) that drop quickly in normal play. Stackable rewards drop neatly in stacks.

---

## 3. Objectives, Party Rules & Contracts

### Daily Bounties (Effort Matched to Tier)
- **Common** *(any difficulty)*: Visit an Episode 1 area, patrol a floor for 10 real minutes, find a target item, learn a new technique, or play 1 hour. (Old *Hold Meseta* and *Use Materials* objectives are retired.)
- **Uncommon** *(Hard from Lv 20 / below Rare difficulty)*: Defeat a boss, clear a floor within a time limit, or gain 1–2 levels (offered only when achievable in ~1h of play).
- **Rare** *(Hard from Lv 20, Very Hard from Lv 40)*: Boss speedrun, **Carry** (with a hunter 5+ levels lower), **Hardcore Carry**, or **Diverse Party**.

### Team Bounty Rules & Free Reroll
- **Diverse Party (`HU, RA, FO`):** At least one Hunter, one Ranger, and one Force in the party (`3-player` = `HU + RA + FO`; `4-player` = all three roles + any 4th class).
- **Hardcore Carry & Carry:** Level differences (**3+ players 10+ levels below** you for Hardcore Carry, or **5+ levels below** for Mentor Carry) are recorded **when each player joins the game**, so carried hunters leveling up mid-run still qualify when the boss falls!
- **Free Reroll:** Any active team-dependent bounty (**Mentor Carry**, **Hardcore Carry**, **Diverse Party**) can be rerolled **once for free** from `/missions` or your Portal Guild tab, keeping its tier, slot, and reward while generating a solo-completable objective next time you are online.

### Weekly Bounties & Whole-Game Kill Credit
- Objectives include **Episode Area Sweeps**, **Boss Hunts**, **Enemy Hunts**, **Rare-Enemy Hunts**, and **3–5 Level Gains** (for levels achievable in a week's play). Ultra Rare and Mythic Rare weeklies are always **hunts** (bosses, enemies, or rare enemies).
- Counts only in Normal-mode or Solo games at the listed difficulty or higher (only Mythic Rare weeklies require Ultimate).
- **Whole-Game Credit:** On Weekly Boss/Enemy/Rare-Enemy Hunts and Contract Hunts, **any kill made by anyone in your game counts** toward everyone's active hunts! (Your personal killing blows are also logged permanently in your Character Viewer's **Kill Counts** panel.)

### Battle & Challenge Mode Bounties
- **Battle Mode:** Requires 1–3 wins under one of Battle 1–8's specific rule sets (credited when leaving the match).
- **Challenge Mode:** Targets stages you have unlocked (up to highest cleared + 1) at **B** (any clear), **A pace** (Ep1 13h / Ep2 7h limits), **S pace** (Ep1 7h / Ep2 5h limits), multi-stage combined time, or a **Full S-Rank Run** (Mythic Rare). Best stage times since the bounty started count, so replaying a slow stage improves your combined time.

### Contracts & Party Shares (`Drop Share: 25% of Ultra/Mythic Drops`)
- **Episode Runs:** Clear every field area and every boss of an episode in **one game** — Ultra Rare with **Diverse Party (`HU, RA, FO`)** at every boss, or Mythic Rare with **Hardcore Carry** at every boss or **Timed** (`2h 30m` for Ep1/Ep2, `1h 30m` for Ep4 from entering the first area). Pays **2x** Photon Drops and Meseta.
- **Rare-Creature Hunts:** Hunt specific rare spawns (*Del Rappy*, *Nar Lily*, *Pouilly Slime*, *Merissa AA*, *Love Rappy*, *Kondrieu*, *Pazuzu*, *Al Rappy*, *Dorphon Eclair*, *Hildeblue*). Pays **1.5x** PDs/Meseta plus a rare drop from that creature's own pool.
- **Contract Shares & LFG:** When a Contract finishes, **everyone else in the game** (who was present for at least half the bosses on a Run) receives a **Contract Share** bounty reward one tier lower (`Ultra -> Rare`, `Mythic -> Ultra`) rolled for their own character in the Claim Center. Active Contracts and co-op bounties can be posted directly to `/lfg` (`https://psobb.io/lfg`).
