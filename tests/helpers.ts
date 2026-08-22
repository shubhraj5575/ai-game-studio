/** Shared test helpers. */
import { fnv1a } from "../src/engine/core/hash.js";
import type { Simulation } from "../src/engine/sim/simulation.js";
import type { FrameInput } from "../src/engine/sim/simulation.js";
import { emptyInput } from "../src/engine/sim/simulation.js";
import { snapshot } from "../src/engine/sim/save.js";
import { Rng } from "../src/engine/core/rng.js";

/** Deterministic state fingerprint (uses the save serializer's canonical form). */
export function stateHash(sim: Simulation): string {
  const env = JSON.parse(snapshot(sim)) as { data: unknown };
  return fnv1a(stableStringify(env.data));
}

/** Deterministic JSON stringify with sorted object keys. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Scripted bot input generator: deterministic per seed.
 * Wanders, attacks often, dodges sometimes, interacts occasionally.
 */
export class BotDriver {
  private rng: Rng;
  constructor(seed: number) {
    this.rng = new Rng(seed);
  }
  next(frame: number): FrameInput {
    const input = emptyInput();
    // Change wander direction every ~40-90 frames.
    const phase = Math.floor(frame / this.rngPhase(frame));
    void phase;
    if (frame % 60 === 0 || this.rng.chance(0.02)) {
      this.dirX = this.rng.range(-1, 1);
      this.dirY = this.rng.range(-1, 1);
      const l = Math.hypot(this.dirX, this.dirY) || 1;
      this.dirX /= l;
      this.dirY /= l;
    }
    input.moveX = this.dirX;
    input.moveY = this.dirY;
    input.attackHeld = frame % 17 === 0;
    input.dodgePressed = this.rng.chance(0.008);
    input.interactPressed = frame % 240 === 120;
    return input;
  }
  private dirX = 1;
  private dirY = 0;
  private rngPhase(_frame: number): number {
    return 50;
  }
}
