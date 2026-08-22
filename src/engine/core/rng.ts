/**
 * Deterministic seeded pseudo-random number generator.
 *
 * The whole simulation must be reproducible from a single seed so that:
 *  - QA can replay a failing run exactly (seed + input script),
 *  - regression tests can pin specific failure scenarios,
 *  - procedural content is auditable.
 *
 * Implementation: mulberry32 (small, fast, good enough distribution for
 * gameplay; NOT cryptographic). Multiple independent streams are derived
 * from the master seed via splitmix32 so that e.g. combat rolls never
 * disturb map generation state.
 */

/** Fast 32-bit hash (splitmix32 finalizer). Used to derive stream seeds. */
export function hashSeed(seed: number): number {
  let z = seed | 0;
  z = (z + 0x9e3779b9) | 0;
  let t = z ^ (z >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15);
  t = Math.imul(t, 0x735a2d97);
  return (t ^ (t >>> 15)) >>> 0;
}

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = hashSeed(seed | 0);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [minInclusive, maxExclusive). */
  int(min: number, maxExclusive: number): number {
    return min + Math.floor(this.next() * (maxExclusive - min));
  }

  /** Integer in [min, max] inclusive. */
  intInclusive(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pick a random element; array must be non-empty. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("Rng.pick on empty array");
    return arr[this.int(0, arr.length)]!;
  }

  /** Weighted pick. Weights must be non-negative and sum > 0. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) throw new Error("Rng.weighted requires positive weight sum");
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  /** Fisher-Yates shuffle (in place, returns same array). */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }

  /** Approximately normal via central limit; mean/stdDev params. */
  normal(mean: number, stdDev: number): number {
    const u = this.next() + this.next() + this.next() + this.next();
    return mean + (u - 2) * stdDev * 1.732;
  }

  /** Derive an independent sub-stream (does not disturb this stream). */
  fork(label: string): Rng {
    return new Rng(hashSeed(hashSeed(this.s ^ strToSeed(label))));
  }

  /** Capture internal state for save games / replay determinism. */
  getState(): number {
    return this.s >>> 0;
  }

  /** Restore internal state. */
  setState(s: number): void {
    this.s = s >>> 0;
  }
}

/** String to 32-bit seed (fnv1a). */
export function strToSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Combine multiple seeds deterministically. */
export function combineSeeds(...parts: Array<number | string>): number {
  let acc = 0;
  for (const p of parts) {
    const n = typeof p === "string" ? strToSeed(p) : p | 0;
    acc = hashSeed(acc ^ n);
  }
  return acc >>> 0;
}
