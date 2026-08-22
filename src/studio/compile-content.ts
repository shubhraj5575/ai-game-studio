/**
 * Content compilation — derives concrete EnemyDefs and ItemDefs from the
 * banks + systems tuning. Owned jointly by Systems Designer (stats) and
 * Asset Manager (visuals); invoked by the pipeline during DESIGN.
 */
import { Rng } from "../engine/core/rng.js";
import type { EnemyDef, ItemDef } from "../engine/content/types.js";
import { ENEMY_BANK, BOSS_BANK, ITEM_BANK } from "./content-banks.js";

export function deriveEnemyDefs(rng: Rng, depthCount: number): EnemyDef[] {
  const defs: EnemyDef[] = [];
  for (const bank of ENEMY_BANK) {
    if (bank.tier === 99) continue; // bosses handled separately
    const tierScale = 1 + (bank.tier - 1) * 0.35;
    defs.push({
      id: bank.id,
      name: bank.name,
      minDepth: Math.min(bank.tier, depthCount),
      hp: Math.round(10 * tierScale + rng.range(-1, 2)),
      speed: round2((bank.behavior === "ranged" ? 2.7 : bank.behavior === "charger" ? 1.8 : 2.15) + rng.range(-0.1, 0.1)),
      damage: Math.round((bank.behavior === "charger" ? 8 : 4) * tierScale),
      radius: bank.shape === "brute" ? 0.44 : bank.shape === "blob" ? 0.34 : 0.3,
      attackRange: bank.behavior === "ranged" ? 6 : bank.behavior === "charger" ? 2.4 : 0.9,
      attackCooldownSec: bank.behavior === "charger" ? 1.8 : bank.behavior === "ranged" ? 1.6 : 1.15,
      perceptionRadius: bank.behavior === "ranged" ? 8.5 : 7.5,
      hearingRadius: 5.5,
      behavior: bank.behavior,
      projectileSpeed: bank.behavior === "ranged" ? 7.5 : undefined,
      xpReward: Math.round(7 * tierScale),
      goldDropMin: Math.round(1 * tierScale),
      goldDropMax: Math.round(4 * tierScale) + 2,
      color: hslString(bank.hue),
      shape: bank.shape,
    });
  }
  // Boss(es) available for the final floor.
  for (const boss of BOSS_BANK) {
    defs.push({
      id: boss.id,
      name: boss.name,
      minDepth: 90,
      hp: 95,
      speed: 2.4,
      damage: 10,
      radius: 0.52,
      attackRange: 1.9,
      attackCooldownSec: 1.05,
      perceptionRadius: 10,
      hearingRadius: 8,
      behavior: boss.behavior,
      xpReward: 70,
      goldDropMin: 30,
      goldDropMax: 65,
      color: hslString(boss.hue),
      shape: boss.shape,
    });
  }
  return defs;
}

export function deriveItemDefs(): ItemDef[] {
  return ITEM_BANK.map((b) => {
    const base: ItemDef = {
      id: b.id,
      name: b.name,
      kind: b.kind === "relic" && b.id.startsWith("quest-") ? "quest" : b.kind,
      rarity: b.rarity,
      value: b.value,
      stackable: b.kind === "potion" || b.id.startsWith("quest-"),
      description: b.description,
    };
    if (b.kind === "weapon") {
      base.power = b.rarity === "common" ? 3 : b.rarity === "uncommon" ? 6 : b.rarity === "rare" ? 9 : 13;
      base.attackSpeed = b.id.includes("maul") ? 0.62 : 0.38;
    }
    if (b.kind === "armor") {
      base.defense = b.rarity === "common" ? 1 : b.rarity === "uncommon" ? 3 : 5;
    }
    if (b.kind === "potion") {
      base.healAmount = b.rarity === "common" ? 18 : 42;
    }
    if (b.kind === "relic" && !b.id.startsWith("quest-")) {
      switch (b.id) {
        case "relic-heart-of-ash": base.relicEffect = { kind: "maxHp", amount: 12 }; break;
        case "relic-hawkeye-charm": base.relicEffect = { kind: "critChance", amount: 0.08 }; break;
        case "relic-swiftstep-sigil": base.relicEffect = { kind: "moveSpeedMult", mult: 1.12 }; break;
        case "relic-tollkeepers-mark": base.relicEffect = { kind: "goldGainMult", mult: 1.35 }; break;
      }
    }
    return base;
  });
}

function hslString(h: number): string {
  return `hsl(${h}, 72%, 56%)`;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
