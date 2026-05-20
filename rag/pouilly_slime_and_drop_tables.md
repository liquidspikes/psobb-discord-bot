# Pouilly Slime Rare Enemy & Drop Rates Deep Dive

## 1. Pofuilly Slime vs. Pouilly Slime
*   **Pofuilly Slime (Blue Slime):** The standard, common enemy encountered in the Caves (Episode 1).
*   **Pouilly Slime (Red Slime):** The rare variant. There is a default **1/512 (approx. 0.195%)** chance that any spawned Pofuilly Slime will manifest as a rare red Pouilly Slime.

## 2. Slime Splitting Mechanic
*   A blue Pofuilly Slime can divide into up to 4 slimes when struck by a physical attack (like the first or second hit of a weak combo) or a low-level technique (like Rabarta).
*   Each time a slime divides, the new spawn undergoes an independent rare enemy check (**1/512** base rate).
*   This makes splitting blue slimes the most efficient way to hunt rare red slimes!

## 3. Server Event & Multiplier Mathematics
*   **Pouilly Slime Surge (9x Rare Spawn Rate):**
    *   Increases the rare spawn check from **1/512 (~0.195%)** to **9/512 (~1.76%)**.
    *   If you fully split a blue slime into 4, the cumulative chance of encountering at least one red Pouilly Slime is `1 - (1 - 9/512)^4` = **~6.86%** per split slime.
*   **Drop Boost (e.g., 3x Drop Rate):**
    *   Multiplies the rare item drop rate of the red slime by 3x.
*   **Hunting Mathematics (Spread Needle Example):**
    *   Base rate for Spread Needle from Pouilly Slime (Redria, Ultimate): **1/21.3 (~4.68%)**.
    *   Without boosts: Cumulative chance of finding it per Pofuilly spawn check is `(1/512) * (1/21.3) = ~1/10,900` (requires killing ~10,900 slimes on average).
    *   With 9x Surge and 3x Drop Boost: Cumulative chance is `(9/512) * (3/21.3) = 27/10,900 = ~1/403` (requires checking only ~403 slimes on average!).

## 4. Pouilly Slime (Red Slime) Drop Table by Difficulty

### Ultimate Difficulty
The red slime drops the most coveted endgame items in Ultimate Caves:
*   **Redria:** **Spread Needle** at **1/21** (The most famous and sought-after Hunter/Ranger crowd control weapon).
*   **Purplenum:** **Psycho Wand** at **1/22** (The ultimate Force weapon for spelling power).
*   **Skyly / Yellowboze / Whitill:** **Lavis Cannon** at **1/22** (Precursor to the Lavis Blades/Double Cannon).
*   **Greenill:** **Heaven Punisher** at **1/22** (Ranger handgun that fires satellite lasers on even beat times).
*   **Viridia / Pinkal:** **Agito (1975)** at **1/22** (Required to unseal the Orotiagito).
*   **Oran:** **Twin Brand** at **1/22**.
*   **Bluefull:** **Imperial Pick** at **1/22**.

### Normal Difficulty
*   **All Section IDs (except Purplenum):** Highly famous for dropping **Addslot** (adds slots to armor) at a massive **1/2** rate!
*   **Purplenum:** Drops **Def Material** at **1/2** rate.

### Hard Difficulty
*   Drops utility units such as **God/Arm** or high-grade slot adders and materials.

### Very Hard Difficulty
*   Drops premium units such as **Hero/Ability** or specific rare materials.
