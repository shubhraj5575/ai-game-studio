/** Combat math: damage rolls, arc hit tests, knockback. */
import { angleDiff } from "../core/math.js";
import type { Vec2 } from "../core/math.js";
import type { Rng } from "../core/rng.js";
import type { Entity, SimState } from "./state.js";

export interface DamageRoll {
  amount: number;
  crit: boolean;
}

export function rollDamage(
  rng: Rng,
  base: number,
  defense: number,
  variancePct: number,
  critChance: number,
  critMultiplier: number,
): DamageRoll {
  const variance = 1 + rng.range(-variancePct, variancePct);
  const crit = rng.chance(critChance);
  let amount = Math.round(base * variance * (crit ? critMultiplier : 1));
  amount -= defense;
  if (amount < 1) amount = 1;
  return { amount, crit };
}

/** True when target is inside the melee arc centered on `angle` from `from`. */
export function inMeleeArc(from: Vec2, angle: number, range: number, arcDeg: number, targetPos: Vec2): boolean {
  const dx = targetPos.x - from.x;
  const dy = targetPos.y - from.y;
  const d2 = dx * dx + dy * dy;
  if (d2 > (range + 0.35) * (range + 0.35)) return false; // small grace radius
  const toTarget = Math.atan2(dy, dx);
  return Math.abs(angleDiff(angle, toTarget)) <= (arcDeg * Math.PI) / 360;
}

/** Apply damage to an entity. Caller handles death consequences via return value. */
export function applyDamage(state: SimState, target: Entity, roll: DamageRoll): boolean {
  if (target.dead) return false;
  target.hp -= roll.amount;
  if (target.kind === "player") {
    state.stats.damageTaken += roll.amount;
  }
  return true;
}

export function addImpulse(e: Entity, dirX: number, dirY: number, force: number): void {
  e.vel.x += dirX * force;
  e.vel.y += dirY * force;
}
