/** Derived player stats and progression math. */
import type { SimState } from "./state.js";
import type { ContentPack, XpCurveDef } from "../content/types.js";
import { itemDef, relicEffects } from "./inventory.js";
import { gameBus } from "./game-events.js";

export interface PlayerStats {
  maxHp: number;
  damage: number;
  defense: number;
  speed: number;
  critChance: number;
  goldMult: number;
}

export function xpToNext(curve: XpCurveDef, level: number): number {
  return Math.round(curve.base * Math.pow(level, curve.growth));
}

/** Full derived stat block for the current player configuration. */
export function computePlayerStats(state: SimState, pack: ContentPack): PlayerStats {
  const t = pack.systems.player;

  let maxHp = t.baseMaxHp + (state.level - 1) * t.hpPerLevel;
  let damage = t.baseDamage + (state.level - 1) * t.damagePerLevel;
  let defense = t.baseDefense;
  let speed = t.baseSpeed;
  let critChance = t.critChance;
  let goldMult = 1;

  const weapon = state.equipment.weapon ? itemDef(pack, state.equipment.weapon) : undefined;
  if (weapon?.power) damage += weapon.power;

  const armor = state.equipment.armor ? itemDef(pack, state.equipment.armor) : undefined;
  if (armor?.defense) defense += armor.defense;

  for (const fx of relicEffects(state, pack)) {
    switch (fx.kind) {
      case "maxHp": maxHp += fx.amount; break;
      case "damageMult": damage = Math.round(damage * fx.mult); break;
      case "moveSpeedMult": speed *= fx.mult; break;
      case "critChance": critChance += fx.amount; break;
      case "goldGainMult": goldMult *= fx.mult; break;
    }
  }

  return {
    maxHp,
    damage,
    defense,
    speed,
    critChance: Math.min(critChance, 0.75),
    goldMult,
  };
}

/** Apply XP gain, resolving any level-ups (may cascade). Returns levels gained. */
export function grantXp(state: SimState, pack: ContentPack, amount: number): number {
  let levelsGained = 0;
  state.xp += amount;
  while (state.xp >= xpToNext(pack.systems.xpCurve, state.level)) {
    state.xp -= xpToNext(pack.systems.xpCurve, state.level);
    state.level++;
    levelsGained++;
    const stats = computePlayerStats(state, pack);
    const player = state.entities.get(state.playerId);
    if (player) {
      player.maxHp = stats.maxHp;
      // Level-up heals a third of max — feels good, keeps runs moving.
      player.hp = Math.min(stats.maxHp, player.hp + Math.round(stats.maxHp / 3));
    }
    gameBus.emit("levelUp", { level: state.level });
  }
  return levelsGained;
}
