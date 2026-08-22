/**
 * Enemy and NPC artificial intelligence.
 *
 * Enemies run a lightweight utility/state hybrid:
 *   perception (staggered LOS + hearing) -> memory (last seen position,
 *   decaying alertness) -> behavior selection -> locomotion (direct steering
 *   or A* waypoints).
 *
 * All randomness flows through the simulation-owned `ai` RNG stream so runs
 * are fully deterministic given seed + input script.
 */
import { angleDiff, vdist, vlen, vnorm, vsub, clamp } from "../core/math.js";
import type { Vec2 } from "../core/math.js";
import type { Entity, SimState } from "./state.js";
import type { Simulation } from "./simulation.js";
import { findPath } from "../world/pathfind.js";
import { hasLineOfSight } from "../world/los.js";

export interface NoiseEvent {
  x: number;
  y: number;
  radius: number;
}

const LOSE_INTEREST_SEC = 5;
const REPATH_INTERVAL = 0.65;
const PERCEPTION_PERIOD_TICKS = 9; // 0.15s at 60Hz

export function updateEnemies(sim: Simulation, noises: NoiseEvent[], dt: number): void {
  const state = sim.state;
  const player = state.entities.get(state.playerId);
  if (!player || state.status !== "playing") return;

  // Staggered perception: each enemy perceives on its own tick phase.
  for (const e of state.entities.values()) {
    if (e.kind !== "enemy" || e.dead) continue;
    hearNoises(e, noises);
    if ((state.tick + e.id) % PERCEPTION_PERIOD_TICKS === 0) {
      perceive(sim, e, player);
    }
    decideAndAct(sim, e, player, dt);
  }
}

function hearNoises(e: Entity, noises: NoiseEvent[]): void {
  if (!e.ai || noises.length === 0) return;
  for (const n of noises) {
    const d = vdist(e.pos, { x: n.x, y: n.y });
    if (d <= n.radius) {
      e.ai.alertness = Math.min(1, e.ai.alertness + 0.45);
      e.ai.targetPos = { x: n.x, y: n.y };
      if (e.ai.state === "idle" || e.ai.state === "patrol") e.ai.state = "investigate";
    }
  }
}

function perceive(sim: Simulation, e: Entity, player: Entity): void {
  const mem = e.ai!;
  const def = sim.enemyDef(e.defId!);
  if (!def) return;
  const d = vdist(e.pos, player.pos);
  if (
    d <= def.perceptionRadius &&
    hasLineOfSight(sim.state.map, e.pos.x, e.pos.y, player.pos.x, player.pos.y)
  ) {
    mem.lastSeenPlayerAt = sim.state.timeSec;
    mem.targetPos = { x: player.pos.x, y: player.pos.y };
    mem.alertness = Math.min(1, mem.alertness + 0.55);
  } else {
    mem.alertness = Math.max(0, mem.alertness - 0.08);
  }
}

function decideAndAct(sim: Simulation, e: Entity, player: Entity, dt: number): void {
  const def = sim.enemyDef(e.defId!)!;
  const mem = e.ai!;
  const d = vdist(e.pos, player.pos);
  const seenRecently =
    mem.lastSeenPlayerAt !== null &&
    sim.state.timeSec - mem.lastSeenPlayerAt < LOSE_INTEREST_SEC;

  // Windups are uninterruptible commitments.
  if (mem.state === "windup") {
    e.windupTimer = (e.windupTimer ?? 0) - dt;
    e.vel.x *= 0.8;
    e.vel.y *= 0.8;
    if ((e.windupTimer ?? 0) <= 0) {
      if (def.behavior === "charger") {
        // Launch the charge along the locked direction toward the player.
        mem.state = "charge";
        mem.chargeVec = vnorm(vsub(player.pos, e.pos));
        mem.chargeTimeLeft = 0.55;
      } else {
        executeAttack(sim, e, player, def.attackRange, def.damage, def.behavior === "ranged");
        mem.state = "chase";
      }
    }
    return;
  }

  switch (def.behavior) {
    case "melee":
      behaveMelee(sim, e, player, dt, d, seenRecently);
      break;
    case "ranged":
      behaveRanged(sim, e, player, dt, d, seenRecently);
      break;
    case "charger":
      behaveCharger(sim, e, player, dt, d, seenRecently);
      break;
  }

  decayAlertness(mem, dt);
}

function decayAlertness(mem: NonNullable<Entity["ai"]>, dt: number): void {
  if (mem.state === "idle" || mem.state === "patrol" || mem.state === "investigate") {
    mem.alertness = Math.max(0, mem.alertness - 0.05 * dt);
  }
}

// ---------------------------------------------------------------------------
// Behaviors
// ---------------------------------------------------------------------------

function behaveMelee(
  sim: Simulation, e: Entity, player: Entity, dt: number, d: number, seenRecently: boolean,
): void {
  const def = sim.enemyDef(e.defId!)!;
  const mem = e.ai!;
  e.attackTimer = Math.max(0, (e.attackTimer ?? 0) - dt);

  if (seenRecently && mem.alertness >= 0.5) {
    mem.state = "chase";
    faceToward(e, player.pos, dt);

    if (d <= def.attackRange && (e.attackTimer ?? 0) <= 0) {
      // Commit to a telegraphed swing.
      mem.state = "windup";
      e.windupTimer = 0.38;
      return;
    }
    steerAlongPathOrDirect(sim, e, player.pos, dt, def.speed);
  } else if (mem.targetPos && mem.alertness >= 0.25) {
    mem.state = "investigate";
    investigate(sim, e, dt, def.speed * 0.8);
  } else {
    patrol(sim, e, dt, def.speed * 0.5);
  }
}

function behaveRanged(
  sim: Simulation, e: Entity, player: Entity, dt: number, d: number, seenRecently: boolean,
): void {
  const def = sim.enemyDef(e.defId!)!;
  const mem = e.ai!;
  e.attackTimer = Math.max(0, (e.attackTimer ?? 0) - dt);

  if (seenRecently && mem.alertness >= 0.5) {
    mem.state = d <= def.perceptionRadius * 0.8 ? "strafe" : "chase";
    faceToward(e, player.pos, dt);
    const los = hasLineOfSight(sim.state.map, e.pos.x, e.pos.y, player.pos.x, player.pos.y);

    if (los && d <= def.attackRange && (e.attackTimer ?? 0) <= 0) {
      mem.state = "windup";
      e.windupTimer = 0.42;
      return;
    }

    // Maintain preferred band [attackRange*0.55 .. attackRange].
    const idealMin = def.attackRange * 0.55;
    if (!los || d > def.attackRange * 0.95) {
      steerAlongPathOrDirect(sim, e, player.pos, dt, def.speed);
    } else if (d < idealMin) {
      // Back away while strafing.
      const away = vnorm(vsub(e.pos, player.pos));
      const side = { x: -away.y * mem.strafeDir, y: away.x * mem.strafeDir };
      moveEnemy(sim, e, {
        x: away.x * 0.8 + side.x * 0.6,
        y: away.y * 0.8 + side.y * 0.6,
      }, def.speed);
    } else {
      // Orbit.
      const away = vnorm(vsub(e.pos, player.pos));
      const side = { x: -away.y * mem.strafeDir, y: away.x * mem.strafeDir };
      moveEnemy(sim, e, side, def.speed * 0.7);
    }
  } else if (mem.targetPos && mem.alertness >= 0.25) {
    mem.state = "investigate";
    investigate(sim, e, dt, def.speed * 0.8);
  } else {
    patrol(sim, e, dt, def.speed * 0.5);
  }
}

function behaveCharger(
  sim: Simulation, e: Entity, player: Entity, dt: number, d: number, seenRecently: boolean,
): void {
  const def = sim.enemyDef(e.defId!)!;
  const mem = e.ai!;
  e.attackTimer = Math.max(0, (e.attackTimer ?? 0) - dt);

  if (mem.state === "charge") {
    mem.chargeTimeLeft -= dt;
    moveEnemy(sim, e, mem.chargeVec!, def.speed * 3.1);
    // Contact damage during charge.
    if (vdist(e.pos, player.pos) <= e.radius + player.radius + 0.08) {
      hitPlayer(sim, def.damage, `${def.name} charge`);
      mem.state = "chase";
      e.attackTimer = def.attackCooldownSec;
      mem.chargeVec = null;
    }
    if ((mem.chargeTimeLeft ?? 0) <= 0 || hitWallThisMove(sim, e)) {
      mem.state = "chase";
      e.attackTimer = def.attackCooldownSec;
      mem.chargeVec = null;
    }
    return;
  }

  if (seenRecently && mem.alertness >= 0.5) {
    mem.state = "chase";
    faceToward(e, player.pos, dt);
    const los = hasLineOfSight(sim.state.map, e.pos.x, e.pos.y, player.pos.x, player.pos.y);

    if (los && d >= 2 && d <= def.attackRange * 2.2 && (e.attackTimer ?? 0) <= 0) {
      mem.state = "windup";
      e.windupTimer = 0.5;
      return;
    }
    steerAlongPathOrDirect(sim, e, player.pos, dt, def.speed);
  } else if (mem.targetPos && mem.alertness >= 0.25) {
    mem.state = "investigate";
    investigate(sim, e, dt, def.speed * 0.8);
  } else {
    patrol(sim, e, dt, def.speed * 0.5);
  }
}

export function initEnemyMemory(): NonNullable<Entity["ai"]> {
  return {
    state: "idle",
    targetPos: null,
    lastSeenPlayerAt: null,
    alertness: 0,
    path: null,
    repathTimer: 0,
    patrolTarget: null,
    strafeDir: 1,
    chargeVec: null,
    chargeTimeLeft: 0,
  };
}// ---------------------------------------------------------------------------
// Attack execution
// ---------------------------------------------------------------------------

function executeAttack(
  sim: Simulation, e: Entity, player: Entity, range: number, damage: number, ranged: boolean,
): void {
  const def = sim.enemyDef(e.defId!)!;
  if (ranged) {
    const dir = vnorm(vsub(player.pos, e.pos));
    sim.spawnEnemyProjectile(e, dir, damage, def.projectileSpeed ?? 7);
    e.attackTimer = def.attackCooldownSec;
    return;
  }
  // Melee: strikes anything in arc at moment of resolution.
  if (inArc(e, player.pos, range)) {
    hitPlayer(sim, damage, def.name);
  }
  e.attackTimer = def.attackCooldownSec;
}

function inArc(from: Entity, target: Vec2, range: number): boolean {
  return vdist(from.pos, target) <= range + from.radius + 0.25;
}

function hitPlayer(sim: Simulation, rawDamage: number, sourceName: string): void {
  sim.damagePlayer(rawDamage, sourceName);
}

function hitWallThisMove(sim: Simulation, _e: Entity): boolean {
  // Approximation used to end charges; precise check happens in collision
  // resolution which zeroes velocity on contact.
  return false;
}

// ---------------------------------------------------------------------------
// Locomotion
// ---------------------------------------------------------------------------

function faceToward(e: Entity, target: Vec2, dt: number): void {
  const desired = Math.atan2(target.y - e.pos.y, target.x - e.pos.x);
  e.facing += angleDiff(e.facing, desired) * clamp(dt * 10, 0, 1);
}

function steerAlongPathOrDirect(sim: Simulation, e: Entity, target: Vec2, dt: number, speed: number): void {
  const mem = e.ai!;
  faceToward(e, target, dt);

  const directLos = hasLineOfSight(sim.state.map, e.pos.x, e.pos.y, target.x, target.y);
  if (directLos) {
    mem.path = null;
    moveEnemy(sim, e, vnorm(vsub(target, e.pos)), speed);
    return;
  }

  mem.repathTimer -= dt;
  const targetMovedFar =
    !mem.targetPos || vdist(target, mem.targetPos) > 1.6;
  if (!mem.path || mem.repathTimer <= 0 || targetMovedFar) {
    mem.path = findPath(sim.state.map, e.pos.x, e.pos.y, target.x, target.y);
    mem.repathTimer = REPATH_INTERVAL;
    mem.targetPos = { x: target.x, y: target.y };
  }
  const next = mem.path?.[0];
  if (next) {
    if (vdist(e.pos, next) < 0.4) mem.path!.shift();
    const dirToWaypoint = vnorm(vsub(next, e.pos));
    moveEnemy(sim, e, dirToWaypoint, speed);
  }
}

function investigate(sim: Simulation, e: Entity, dt: number, speed: number): void {
  const mem = e.ai!;
  const target = mem.targetPos;
  if (!target) {
    mem.state = "patrol";
    return;
  }
  const arrived = vdist(e.pos, target) < 0.6;
  if (arrived) {
    mem.targetPos = null;
    mem.state = "patrol";
    return;
  }
  steerAlongPathOrDirect(sim, e, target, dt, speed);
}

function patrol(sim: Simulation, e: Entity, dt: number, speed: number): void {
  const mem = e.ai!;
  mem.state = mem.state === "idle" ? "patrol" : mem.state;
  if (!mem.patrolTarget || vdist(e.pos, mem.patrolTarget) < 0.5) {
    // Pick a new wander point near current position.
    const angle = sim.rngAi.next() * Math.PI * 2;
    const dist = sim.rngAi.range(1.5, 4);
    const p: Vec2 = { x: e.pos.x + Math.cos(angle) * dist, y: e.pos.y + Math.sin(angle) * dist };
    if (sim.state.map.isWalkableWorld(p.x, p.y)) {
      mem.patrolTarget = p;
    }
    mem.state = "idle";
    return;
  }
  mem.state = "patrol";
  moveEnemy(sim, e, vnorm(vsub(mem.patrolTarget, e.pos)), speed);
}

/** Integrate desired direction into velocity with knockback preservation. */
function moveEnemy(sim: Simulation, e: Entity, dir: Vec2, speed: number): void {
  const knockback = vlen(e.vel) > speed ? vlen(e.vel) - speed : 0;
  e.vel.x = dir.x * speed + (vlen(e.vel) > 0.001 ? (e.vel.x / vlen(e.vel)) * knockback : 0);
  e.vel.y = dir.y * speed + (vlen(e.vel) > 0.001 ? (e.vel.y / vlen(e.vel)) * knockback : 0);
  sim.markEnemyMoved(e);
}

export function updateNpc(sim: Simulation, npc: Entity, dt: number): void {
  npc.talkCooldown = Math.max(0, (npc.talkCooldown ?? 0) - dt);
  // Gentle wander around home.
  const home = npc.homePos ?? npc.pos;
  if (vlen(npc.vel) < 0.01 && sim.rngMisc.chance(dt * 0.4)) {
    const angle = sim.rngMisc.next() * Math.PI * 2;
    const dist = sim.rngMisc.range(0.5, 1.6);
    const target = { x: home.x + Math.cos(angle) * dist, y: home.y + Math.sin(angle) * dist };
    if (sim.state.map.isWalkableWorld(target.x, target.y)) {
      const dir = vnorm(vsub(target, npc.pos));
      npc.vel.x = dir.x * 0.6;
      npc.vel.y = dir.y * 0.6;
      npc.facing = Math.atan2(dir.y, dir.x);
    }
  }
}

export type { SimState };
