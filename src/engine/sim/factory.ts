/** Entity construction helpers. */
import type { Vec2 } from "../core/math.js";
import { vec } from "../core/math.js";
import type { Entity, SimState } from "./state.js";

export function makeEntity(state: SimState, kind: Entity["kind"], pos: Vec2, radius: number): Entity {
  const e: Entity = {
    id: state.nextEntityId++,
    kind,
    pos: vec(pos.x, pos.y),
    vel: vec(0, 0),
    radius,
    facing: 0,
    dead: false,
    age: 0,
    ttl: Infinity,
    hp: 1,
    maxHp: 1,
  };
  state.entities.set(e.id, e);
  return e;
}

export function logEvent(state: SimState, kind: string, detail?: string): void {
  state.recentEvents.push({ t: Math.round(state.timeSec * 100) / 100, kind, detail });
  if (state.recentEvents.length > 240) state.recentEvents.splice(0, state.recentEvents.length - 240);
}
