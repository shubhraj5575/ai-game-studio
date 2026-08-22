# Cinder Foundry — Game Design Document

> A top-down action roguelite (dungeon descent) where you descend 4 procedurally generated depths, fighting mysterious creatures, completing survivor quests, and carrying your ember to the bottom.

## Pillars

- **Readable combat** — Every threat telegraphs before it hurts you; damage always has an address.
- **Meaningful choices** — Gold, potions, gear, relics, and quests trade off against risk every floor.
- **Escalating descent** — Each depth is measurably more dangerous and measurably more rewarding.

## Core Loop

1. Enter a generated floor; survey rooms, threats, and opportunities.
2. Fight or avoid enemies to earn XP, gold, and drops.
3. Accept and complete survivor quests for bonuses.
4. Spend gold at the merchant; manage potions and gear.
5. Find the key (and slay any guardian), then take the portal down.
6. Repeat until the final floor's guardian falls.

## Mechanics

### Movement & dodge

Free top-down movement; dodge roll grants invulnerability frames at a stamina cost.

| Parameter | Value |
|---|---|
| dodgeSpeedMult | 3 |
| dodgeDurationSec | 0.28 |
| staminaCost | 28 |

### Melee combat

Aimed arc swings with cooldowns, critical hits, knockback, and telegraphed enemy windups.

| Parameter | Value |
|---|---|
| attackRange | 1.55 |
| attackArcDeg | 100 |
| critChance | 0.06 |

### Enemy behaviors

Three behavior families: melee chasers, ranged kiters, and chargers with committed lunges.

| Parameter | Value |
|---|---|
| families | 3 |

### Perception & memory

Enemies see via line-of-sight cones and hear combat noise; they investigate last-known positions.

| Parameter | Value |
|---|---|
| perceptionPeriodSec | 0.15 |
| loseInterestSec | 5 |

### Quests

Procedurally parameterized slay/collect/explore quests from NPC survivors; collect targets are guaranteed obtainable.

| Parameter | Value |
|---|---|
| kindsCount | 3 |

### Economy

Gold from kills, chests, and quests buys potions/gear/relics at variable prices.

| Parameter | Value |
|---|---|
| sellRatio | 0.4 |
| priceVariancePct | 20 |

### Progression

XP levels raise HP and damage; equipment and up to two relics customize builds per run.

| Parameter | Value |
|---|---|
| relicSlots | 2 |

### Key & guardian gating

Deeper floors require a key; the final floor's portal opens only when its boss dies.

### Save shrines

One-shot full heal plus autosave per shrine; manual save available from pause menu.

## Progression

- Player growth: Levels every ~floor mid-run; +HP/+damage per level; gear carries runs.
- Difficulty arc: 4 depths; budget 5+1.6/depth (steady escalation, meaningful resource pressure).
- Economy: Potions are the sink; relics are the splurge; selling keeps bad luck runs alive.

## Win / Lose

- **Win:** Defeat the guardian of the final depth and take its portal.
- **Lose:** Health reaches zero. The run ends; saves persist only if made at shrines.

## QA Coverage Goals

- combat exchanges in ≥90% of QA seeds
- quest accept + completion observed across suite
- shop purchase in ≥1 seed
- key retrieval on gated floors
- save/load determinism spot check each seed
- descend on every seeded run

---

## Generated Content Summary

- **Title:** Cinder Foundry
- **Depths:** 4 (B1, B2, B3, B4☠)
- **Enemies:** Cinder Ooze, Ash Imp, Vault Skitterer, Soot Spitter, Gloom Brute, Gloom Wisp, Kiln Hulk, The Ashen Warden, Hearth-Mother
- **Items:** 14 across rarities
- **Quests:** slay, collect, explore templates
- **NPCs:** Rowan, Marla

### Systems tuning highlights

| Knob | Value |
|---|---|
| Player HP | 32 |
| Player damage | 6 |
| XP curve | base 22, growth 1.138 |
| Depth HP scale | +18%/depth |
| Depth damage scale | +12%/depth |

### Floor plan

| Depth | Size | Rooms | Budget | Key | Boss | Shrine | NPCs | Quests |
|---|---|---|---|---|---|---|---|---|
| B1 | 41×41 | 5–6 | 5.0+1.6/d | — | — | ✔ | 2 | 2 |
| B2 | 44×44 | 5–7 | 5.4+1.6/d | ✔ | — | ✔ | 1 | 1 |
| B3 | 47×47 | 5–7 | 5.8+1.6/d | ✔ | — | ✔ | 0 | 1 |
| B4 | 50×50 | 5–8 | 6.2+1.6/d | ✔ | warden | ✔ | 0 | 0 |

