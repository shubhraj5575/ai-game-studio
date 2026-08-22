import { describe, it, expect } from "vitest";
import { makeTestPack } from "../fixtures/test-pack.js";
import { Simulation } from "../../src/engine/sim/simulation.js";
import { emptyInput } from "../../src/engine/sim/simulation.js";
import { snapshot, restoreFromSnapshot, SaveError } from "../../src/engine/sim/save.js";
import { stateHash } from "../helpers.js";
import type { ContentPack } from "../../src/engine/content/types.js";

const pack: ContentPack = makeTestPack();

describe("save/load", () => {
  it("round-trips and continues deterministically", () => {
    const a = new Simulation(pack, 2024);
    const b = new Simulation(pack, 2024);

    // Drive both identically for 600 frames.
    for (let f = 0; f < 600; f++) {
      const input = emptyInput();
      input.moveX = Math.sin(f * 0.05);
      input.moveY = Math.cos(f * 0.033);
      input.attackHeld = f % 23 === 0;
      a.step(input);
      b.step(input);
    }
    expect(stateHash(a)).toBe(stateHash(b));

    // Snapshot A, restore into C, continue both for 900 more frames.
    const saveStr = snapshot(a);
    const c = restoreFromSnapshot(pack, saveStr);
    expect(stateHash(c)).toBe(stateHash(a));

    for (let f = 600; f < 1500; f++) {
      const input = emptyInput();
      input.moveX = Math.sin(f * 0.041);
      input.moveY = Math.cos(f * 0.052);
      input.attackHeld = f % 19 === 0;
      input.interactPressed = f % 300 === 150;
      a.step(input);
      c.step(input);
    }
    expect(stateHash(a)).toBe(stateHash(c));
  });

  it("rejects tampered saves via checksum", () => {
    const sim = new Simulation(pack, 555);
    for (let i = 0; i < 100; i++) sim.step(emptyInput());
    const saveStr = snapshot(sim);
    const parsed = JSON.parse(saveStr);
    parsed.data.gold = 999999;
    const tampered = JSON.stringify(parsed);
    expect(() => restoreFromSnapshot(pack, tampered)).toThrow(SaveError);
  });

  it("rejects foreign magic and wrong versions", () => {
    const sim = new Simulation(pack, 1);
    const saveStr = snapshot(sim);

    const badMagic = JSON.parse(saveStr);
    badMagic.magic = "NOT-A-SAVE";
    expect(() => restoreFromSnapshot(pack, JSON.stringify(badMagic))).toThrow(/magic/i);

    const badVersion = JSON.parse(saveStr);
    badVersion.version = -1;
    // Checksum still matches data but version gate fires first.
    expect(() => restoreFromSnapshot(pack, JSON.stringify(badVersion))).toThrow(/version/);
  });

  it("rejects saves from mismatched content packs", () => {
    const sim = new Simulation(pack, 42);
    const saveStr = snapshot(sim);
    const otherPack: ContentPack = { ...makeTestPack(), meta: { ...makeTestPack().meta, version: "9.9.9-other" } };
    expect(() => restoreFromSnapshot(otherPack, saveStr)).toThrow(/content v/);
  });
});
