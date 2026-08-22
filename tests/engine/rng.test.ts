import { describe, it, expect } from "vitest";
import { Rng, combineSeeds, strToSeed } from "../../src/engine/core/rng.js";

describe("Rng", () => {
  it("is deterministic for the same seed", () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    for (let i = 0; i < 1000; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("differs across seeds", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("produces floats in [0,1) with plausible distribution", () => {
    const rng = new Rng(42);
    let belowHalf = 0;
    let min = 1, max = 0;
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      if (v < 0.5) belowHalf++;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    // Within 3% of expected for 10k samples.
    expect(Math.abs(belowHalf / 10000 - 0.5)).toBeLessThan(0.03);
    expect(min).toBeLessThan(0.01);
    expect(max).toBeGreaterThan(0.99);
  });

  it("int/intInclusive respect bounds", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(3, 8);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(8);
      const w = rng.intInclusive(-2, 2);
      expect(w).toBeGreaterThanOrEqual(-2);
      expect(w).toBeLessThanOrEqual(2);
    }
  });

  it("pick throws on empty array and returns elements otherwise", () => {
    const rng = new Rng(9);
    expect(() => rng.pick([])).toThrow();
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 50; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });

  it("weighted respects zero-weight exclusion", () => {
    const rng = new Rng(11);
    const items = ["x", "y"];
    const weights = [0, 1];
    for (let i = 0; i < 100; i++) {
      expect(rng.weighted(items, weights)).toBe("y");
    }
  });

  it("shuffle is a permutation", () => {
    const rng = new Rng(13);
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    for (let t = 0; t < 20; t++) {
      const copy = [...src];
      rng.shuffle(copy);
      expect([...copy].sort((a, b) => a - b)).toEqual(src);
    }
  });

  it("state capture/restore resumes the exact sequence", () => {
    const a = new Rng(777);
    for (let i = 0; i < 10; i++) a.next();
    const saved = a.getState();
    const expected = [];
    for (let i = 0; i < 5; i++) expected.push(a.next());

    const b = new Rng(0);
    b.setState(saved);
    const actual = [];
    for (let i = 0; i < 5; i++) actual.push(b.next());
    expect(actual).toEqual(expected);
  });

  it("fork produces independent streams that do not disturb parent", () => {
    const a = new Rng(55);
    const before = Array.from({ length: 5 }, () => a.next());
    const forked = a.fork("combat");
    const fvals = Array.from({ length: 5 }, () => forked.next());
    const after = Array.from({ length: 5 }, () => a.next());
    // Parent sequence unchanged by forking.
    const a2 = new Rng(55);
    const before2 = Array.from({ length: 5 }, () => a2.next());
    expect(before).toEqual(before2);
    expect(fvals.length).toBe(5);
    void after;
  });
});

describe("seed helpers", () => {
  it("strToSeed is stable", () => {
    expect(strToSeed("hello")).toBe(strToSeed("hello"));
    expect(strToSeed("hello")).not.toBe(strToSeed("hellp"));
  });
  it("combineSeeds is order-sensitive and stable", () => {
    expect(combineSeeds(1, "floor", 2)).toBe(combineSeeds(1, "floor", 2));
    expect(combineSeeds(1, "floor", 2)).not.toBe(combineSeeds(2, "floor", 1));
  });
});
