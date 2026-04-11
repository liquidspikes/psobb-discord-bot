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

### Evolution Tiers
1.  Level 10: First evolution based on Class.
2.  Level 35: Second evolution based on highest stat.
3.  Level 50: Third evolution based on Class, Section ID, and stats. Changes form every 5 levels if conditions change.
4.  Level 100 (4th Evolution): Requires specific stat equations (e.g., DEF + MIND = POW + DEX). Mags like Sato, Nidra, or Pushan are prized for superior Triggers.

### Photon Blasts (PB) & Triggers
*   Photon Blasts: Unleashed at 100% PB gauge. Max 3.
*   Triggers: % chance to activate effects at 100% PB, 10% HP, or entering a Boss Room.
*   Effects: Invincibility, Resta, or Shifta & Deband. Mags like Sato and Nidra offer 50% chance of Invincibility at 100% PB and 10% HP.

### Server Info
*   This bot supports the psobb.io private server.
*   Feedback can be posted to the Discord forum. You can always DM @liquidSpikes as well.
