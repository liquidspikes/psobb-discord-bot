# Phantasy Star Online Blue Burst (PSOBB) Core Mechanics & Drop Rates

## Combat & Gameplay Core
*   **The 3-Hit Combo System**: Combat is rhythm-based. Every weapon allows a sequence of up to 3 attacks. Timing your inputs with the end of the previous attack's animation is critical to chaining combos without being interrupted.
*   **Attack Types**:
    *   **Normal (N)**: Fast, high accuracy, low damage.
    *   **Heavy (H)**: Slower, medium accuracy, high damage.
    *   **Special (S)**: Slowest, low accuracy, applies unique weapon effects (e.g., freezing, instant kill, HP steal).
*   **Accuracy (ATA) is King**: In Ultimate difficulty, enemies have massive Evasion (EVP). Without sufficient ATA, Heavy and Special attacks will constantly miss. A Hunter hitting 0 damage due to a miss is worse than a Normal attack hitting for moderate damage.

## The MAG System
Mags are floating robotic companions that are fed items (like Monomates, Antidotes, etc.) to grow. A Level 200 Mag is the most important piece of equipment for a character.
*   **DEF**: 1 Mag DEF = 1 DFP (Defense).
*   **POW**: 1 Mag POW = 2 ATP (Attack Power).
*   **DEX**: 1 Mag DEX = 0.5 ATA (Accuracy).
*   **MIND**: 1 Mag MIND = 2 MST (Mental Strength / Magic Power).
*   **Photon Blasts (PB)**: At 100% PB gauge (filled by taking/dealing damage), Mags unleash ultimate attacks. The most critical is **Mylla & Youlla (Twins)**, which casts high-level Shifta/Deband (Attack/Defense buffs) on the entire party.

## Weapon Attributes & Tekkers
*   Weapons drop with untekked ("????") status and can possess percentage bonuses (0% to 100%) against four enemy types: **Native (Forest), A.Beast (Caves), Machine (Mines), Dark (Ruins/Bosses)**.
*   **Hit %**: The "secret" fifth attribute. Hit% directly adds to ATA. A 50% Hit weapon provides +50 ATA, making it astronomically more valuable than a weapon with 50% Native.
*   **The Tekker Trick**: When identifying a weapon at the Tekker, the percentages can fluctuate by +/- 10%. Players can cancel and re-tekk the weapon until they roll the +10% maximum possible outcome.

## Newserv v4 Drop Paradigm & Server-Side Drops
Unlike ancient versions of PSO where the client decided what items dropped (leading to rampant cheating), PSOBB running on Newserv v4 utilizes authoritative Server-Side Drops.
*   **SERVER_PRIVATE (Instanced Drops)**: The default standard for modern servers. When an enemy dies, the server rolls the drop. If an item drops, it is assigned exclusively to ONE player in the party. Other players cannot see or pick up the item. This eliminates "ninja looting" and toxic party behavior.
*   **SERVER_SHARED**: The classic PSO experience. An item drops, everyone sees it, and the first person to grab it keeps it.
*   **SERVER_DUPLICATE**: A rare server configuration where an item drops and is replicated so every player in the party gets a copy.

### How Drops are Calculated
1.  **Dar (Drop Anything Rate)**: When an enemy dies, the server rolls its "Dar". If it fails, nothing drops. If it passes, the enemy will drop *something*.
2.  **Rare Roll**: If the Dar passes, the server rolls the enemy's Rare Item chance based strictly on the **Party Leader's Section ID**. If this passes, the Red Box drops!
3.  **Tool/Weapon/Armor Roll**: If the Rare Roll fails, the server then rolls to see if it drops a Tool (Mate/Fluid), a generic Weapon, or generic Armor/Shield/Meseta.
4.  **Area Modifiers**: Higher difficulties (Very Hard, Ultimate) dramatically decrease the Dar (enemies drop fewer overall items) but vastly increase the quality of the generic weapons (e.g., dropping Caliburs instead of Sabers) and introduce the Ultimate Rare drop tables.

## Section IDs
Your character's name mathematically determines their Section ID (e.g., Redria, Skyly, Purplenum).
*   **Redria**: The premier armor/unit ID. Finds God/Battle, God/Power, and excellent Shields.
*   **Skyly**: The Hunter weapon ID. Finds Swords, Partisans, and the legendary Sealed J-Sword.
*   **Purplenum**: The Ranger weapon ID. Finds Mechguns, Rifles, and the Psycho Wand.
*   **Pinkal**: The Force ID. Finds Wands, high-level Technique Disks, and Agito.
*   **Whitill**: A balanced ID famous for Slicers and the Red Ring.
*   *Note: In multiplayer, the entire lobby uses the Section ID of the player who created the room (the Party Leader) for all rare drop calculations.*