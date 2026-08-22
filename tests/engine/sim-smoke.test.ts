import { describe, it, expect } from "vitest";
import { makeTestPack } from "../fixtures/test-pack.js";
import { Simulation } from "../../src/engine/sim/simulation.js";
import { emptyInput } from "../../src/engine/sim/simulation.js";
import { stateHash, BotDriver } from "../helpers.js";
import { makeEntity } from "../../src/engine/sim/factory.js";
import { initEnemyMemory } from "../../src/engine/sim/ai.js";
import { grantXp } from "../../src/engine/sim/progression.js";

describe("simulation smoke + invariants", () => {
  it("runs 30s of bot play with no fatal errors and sane state", () => {
    const sim = new Simulation(makeTestPack(), 31337);
    const driver = new BotDriver(99);

    for (let f = 0; f < 1800; f++) {
      sim.step(driver.next(f));

      if (f % 60 === 0) {
        const s = sim.state;
        expect(s.fatalError).toBeNull();
        const p = sim.player();
        expect(p).toBeDefined();

        // Player inside walkable space.
        expect(sim.circleFree(p!.pos.x, p!.pos.y, p!.radius)).toBe(true);
        // HP bounds.
        expect(p!.hp).toBeGreaterThan(0);
        expect(p!.hp).toBeLessThanOrEqual(p!.maxHp + 1e-9);
        // No NaN anywhere.
        for (const e of s.entities.values()) {
          expect(Number.isFinite(e.pos.x)).toBe(true);
          expect(Number.isFinite(e.pos.y)).toBe(true);
          if (e.kind === "enemy") {
            expect(Number.isFinite(e.hp)).toBe(true);
            expect(e.hp).toBeLessThanOrEqual(e.maxHp + 1e-9);
          }
        }
        // Gold never negative.
        expect(s.gold).toBeGreaterThanOrEqual(0);
      }

      if (sim.state.status !== "playing") break;
    }
  });

  it("is deterministic across identical seeds and inputs", () => {
    const run = () => {
      const sim = new Simulation(makeTestPack(), 424242);
      const driver = new BotDriver(7);
      for (let f = 0; f < 2400 && sim.state.status === "playing"; f++) {
        sim.step(driver.next(f));
      }
      return {
        hash: stateHash(sim),
        status: sim.state.status,
        depth: sim.state.depth,
        kills: sim.state.stats.totalKills,
        gold: sim.state.gold,
      };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });

  it("different seeds diverge", () => {
    const run = (seed: number) => {
      const sim = new Simulation(makeTestPack(), seed);
      const driver = new BotDriver(7);
      for (let f = 0; f < 1200 && sim.state.status === "playing"; f++) sim.step(driver.next(f));
      return stateHash(sim);
    };
    expect(run(1)).not.toBe(run(2));
  });
});

describe("combat & progression sanity", () => {
  it("attacking an adjacent enemy damages and can kill it", () => {
    const pack = makeTestPack();
    const sim = new Simulation(pack, 777);

    // Place a slime directly right of the player for a controlled duel.
    const p = sim.player()!;
    const def = sim.enemyDef("slime")!;
    const slime = makeEntity(sim.state, "enemy", { x: p.pos.x + 1.0, y: p.pos.y }, def.radius);
    slime.defId = "slime";
    slime.hp = def.hp;
    slime.maxHp = def.hp;
    slime.team = "hostile";
    const mem = initEnemyMemory();
    slime.ai = mem;

    const hpBefore = slime.hp;
    // Face right (angle 0) and swing.
    p.facing = 0;
    const input = emptyInput();
    input.attackHeld = true;
    sim.step(input);
    input.attackHeld = false;
    for (let i = 0; i < 30; i++) sim.step(emptyInput());

    expect(sim.state.stats.damageDealt).toBeGreaterThan(0);
    expect(slime.hp).toBeLessThan(hpBefore);
  });

  it("xp and level-ups behave per curve", () => {
    const pack = makeTestPack();
    const sim = new Simulation(pack, 31);
    const s = sim.state;
    const beforeLevel = s.level;
    grantXp(s, pack, 24); // exactly level 2 threshold
    expect(s.level).toBe(beforeLevel + 1);
    expect(s.xp).toBe(0);
  });
});
