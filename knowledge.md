# Phantasy Star Online Blue Burst (PSOBB) Knowledge Base

## 1. Character Classes & Species
Characters are defined by three aspects: Profession (Hunter, Ranger, Force), Species (Human, Newman, Android), and Gender.

### Species Differences
*   **Humans (HUmar, HUnl, RAmar, RAmarl, FOmar, FOmarl):** Balanced stats. They have the highest Material Limit (250), making them the most flexible. They cannot regenerate HP/TP naturally and cannot use traps.
*   **Newmans (HUnewearl, FOnewm, FOnewearl):** Tech-focused. They naturally regenerate TP while standing still. They have a lower Material Limit (150).
*   **Androids (HUcast, HUcaseal, RAcast, RAcaseal):** Cannot use Techniques but can use Traps. They regenerate HP while standing still and are immune to Poison and Paralysis. 
    *   *Ultimate Difficulty Bonus:* +30% to EXP steal and status effect activation rates (Freeze/Paralyze/Confuse).
    *   *Penalty:* Reduced effectiveness for HP-cut specials (Devil’s/Demon’s).

### Class Roles
*   **Hunters (Melee):** HUcast has the highest ATP (Attack Power); HUcaseal has the highest ATA (Accuracy) and EVP (Evasion) among Hunters.
*   **Rangers (Ranged):** RAmar has the highest ATA potential; RAcaseal has the highest DFP (Defense) potential in the game.
*   **Forces (Techniques/Support):** FOnewearl has the highest MST (Mental Strength/TP); FOmarl is the most balanced for weapon use and support.

## 2. Section IDs
Section IDs are assigned at character creation based on the character's name. They determine item drop tables.
*   **Permanence:** The ID becomes permanent at Level 20. Before then, it can be changed once using the `/modsecid` command on some servers.
*   **Hunting Focus:**
    *   Viridia: Shots and Partisans.
    *   Greenill: Rifles and Daggers.
    *   Skyly: Swords and Rifles (Famous for the Sealed J-Sword).
    *   Bluefull: Partisans and Rods.
    *   Purplenum: Mechguns and Daggers (Famous for Yasminkov 9000M).
    *   Pinkal: Wands and Partisans (Tech-user focused).
    *   Redria: Frames, Barriers, and Slicers (High utility ID).
    *   Oran: Daggers and Swords.
    *   Yellowboze: Balanced drops, increased Meseta, and higher attribute chances.
    *   Whitill: Slicers and Mechguns.

## 3. Mag Mechanics
Mags are robotic companions that boost your stats and provide support.

### Core Stats & Feeding
*   Stats: DEF (1 DFP), POW (2 ATP), DEX (0.5 ATA), and MIND (2 MST). Max Level: 200.
*   Feeding Timer: Feed up to 3 items every 3 minutes and 30 seconds.
*   Synchro (0-120%): Affects Photon Blast damage and trigger rates. Drops by 5% if you die.
*   IQ (0-200): Affects the strength of Mag-cast support spells.

### Evolution Tiers (via ragol.co.uk/guides/mags/)
Mag evolution triggers at specific level milestones. A Mag's form dictates its active Triggers (Invincibility/Resta/Shifta) and what Photon Blasts it learns.
1.  **Level 10 (1st Evolution):** Dictated entirely by the Hunter's Class. 
    *   Hunters -> Varuna
    *   Rangers -> Kalki
    *   Forces -> Vritra
2.  **Level 35 (2nd Evolution):** Dictated by the Mag's highest core combat stat (POW, DEX, or MIND). Examples include Ashvinau, Marutah, Mitra, Namuci, Rudra, Sumba, Surya, and Tapas.
3.  **Level 50 (3rd Evolution):** Dictated by a complex triangle of Class, Section ID group (A or B), and stat balance equations (e.g., POW > DEX > MIND). The Mag will dynamically re-evaluate and potentially change its form every 5 levels (55, 60, 65...) if these conditions shift.
4.  **Level 100 (4th Evolution / Rare Mags):** Requires perfect mathematical stat equations (e.g., DEF + MIND = POW + DEX) fed by specific Class/Section ID combos. Rare Mags (like Sato, Nidra, Diqqaq) permanently lock their form and boast superior Trigger activations.
5.  **Cell Evolutions:** Mags can be force-evolved utilizing special "Mag Cell" items (e.g., Panther's Spirit, Heart of Chao) irrespective of level/stat math, permanently locking their aesthetic but halting PB acquisition.

### Photon Blasts (PB) & Triggers
*   Photon Blasts: Unleashed at 100% PB gauge. Max 3.
*   Triggers: % chance to activate effects at 100% PB, 10% HP, or entering a Boss Room.
*   Effects: Invincibility, Resta, or Shifta & Deband. Mags like Sato and Nidra offer 50% chance of Invincibility at 100% PB and 10% HP.

## 4. Episode 4 Lore Summary (Blue Burst Exclusive)
Episode 4 shifts the focus back to the surface of the planet Ragol after the defeat of Dark Falz and Olga Flow. 
A massive meteor suddenly crashes onto the planet's surface, carving out the massive "Crater". Pioneer 2 immediately establishes a forward operating base to investigate the anomaly.

### The Crater and Subterranean Desert
*   **The Crater:** The meteor impact radically mutated the local flora and fauna. The area is infested with highly aggressive reptilian and insectoid bio-weapons (e.g., Astarks, Zu, Satellite Lizards).
*   **The Subterranean Desert:** Digging below the Crater, Hunters discover an ancient, hyper-advanced underground facility buried in the sands. It predates the Pioneer project by millennia and houses ancient civilization technology.
*   **The Meteor's Core:** The meteor wasn't just a rock; it was a cosmic vessel or seal. Slumbering within the deepest parts of the Subterranean Desert is the ancient D-Cell beast known as **Saint-Million** (or its variants, Shambertin and Kondrieu).

### Black Paper & Human Conflict
Unlike Ep1 and Ep2 which focused on D-Cell monsters, Ep4 focuses heavily on human-to-human syndicate conflict. 
*   **Black Paper:** A dangerous underground criminal syndicate operating on Pioneer 2. Led by the highly enigmatic **Leo Grahart**, Black Paper seeks to exploit the ancient technology and meteor debris in the Subterranean Desert to overthrow the Principal and assume control of the ship.
*   **Rupika:** A young girl with mystical connections to the ancient forces of Ragol, who becomes a central figure caught between the Hunter's Guild investigation and Black Paper's violent ambitions.

### Server Info
*   This bot supports the psobb.io private server.
*   Feedback can be posted to the Discord forum. You can always DM @liquidSpikes as well.
