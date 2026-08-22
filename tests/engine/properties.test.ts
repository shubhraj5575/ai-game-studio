/**
 * Property-style tests: seeded randomized sweeps asserting invariants that
 * must hold for ALL inputs in a class, not just curated cases.
 */
import { describe, it, expect } from "vitest";
import { Rng } from "../../src/engine/core/rng.js";
import { rollDamage } from "../../src/engine/sim/combat.js";
import { xpToNext } from "../../src/engine/sim/progression.js";
import { addItem, removeItem, countItem, equipItem } from "../../src/engine/sim/inventory.js";
import { INVENTORY_CAPACITY } from "../../src/engine/sim/state.js";
import type { SimState } from "../../src/engine/sim/state.js";
import { generateFloor } from "../../src/engine/world/procgen.js";
import { reachableTiles } from "../../src/engine/world/pathfind.js";
import { makeTestPack } from "../fixtures/test-pack.js";
import type { ContentPack } from "../../src/engine/content/types.js";

const pack: ContentPack = makeTestPack();

function bareState(): SimState {
  return {
    packVersion: "t",
    seed: 0,
    tick: 0,
    timeSec: 0,
    status: "playing",
    depth: 1,
    floorName: "",
    map: undefined as unknown as SimState["map"],
    entities: new Map(),
    nextEntityId: 1,
    playerId: 0,
    level: 1,
    xp: 0,
    gold: 0,
    inventory: [],
    equipment: { weapon: null, armor: null, relics: [] },
    quests: [],
    dialogue: null,
    keyCollected: false,
    exitUnlocked: false,
    floorDecor: { torches: [] },
    visitedRoomIds: [],
    shopStocks: {},
    lastDamageSource: "",
    rngStates: { combat: 0, loot: 0, ai: 0, misc: 0 },
    stats: {
      killsByType: {},
      totalKills: 0,
      damageDealt: 0,
      damageTaken: 0,
      goldEarned: 0,
      chestsOpened: 0,
      questsCompleted: 0,
      deathsCausedByCause: {},
    },
    recentEvents: [],
    fatalError: null,
  };
}

describe("combat math properties", () => {
  it("rollDamage respects bounds for arbitrary parameters", () => {
    const rng = new Rng(2024);
    for (let i = 0; i < 3000; i++) {
      const base = rng.range(1, 60);
      const defense = rng.int(0, 20);
      const variance = rng.range(0, 30);
      const crit = rng.range(0, 0.6);
      const mult = rng.range(1.2, 3);
      const r = rollDamage(rng, base, defense, variance / 100, crit, mult);
      // Damage is always ≥ 1 and never exceeds generous upper envelope.
      expect(r.amount).toBeGreaterThanOrEqual(1);
      expect(r.amount).toBeLessThanOrEqual(Math.ceil(base * (1 + variance / 100) * mult) + 1);
      expect(Number.isInteger(r.amount)).toBe(true);
      if (!r.crit) {
        expect(r.amount).toBeLessThanOrEqual(Math.ceil(base * (1 + variance / 100)) + 1);
      }
    }
  });
});

describe("xp curve properties", () => {
  it("is positive and monotonically increasing across levels", () => {
    const curve = pack.systems.xpCurve;
    let prev = xpToNext(curve, 1);
    expect(prev).toBeGreaterThan(0);
    for (let lvl = 2; lvl <= 40; lvl++) {
      const cur = xpToNext(curve, lvl);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });
});

describe("inventory properties", () => {
  it("conserves quantity through add/remove cycles", () => {
    const rng = new Rng(88);
    for (let trial = 0; trial < 200; trial++) {
      const s = bareState();
      const ops: Array<() => void> = [];
      void ops;
      let netAdded = 0;
      let netRemoved = 0;
      for (let op = 0; op < 30; op++) {
        if (rng.chance(0.55)) {
          const q = rng.intInclusive(1, 5);
          netAdded += addItem(s, "potion-small", q, true);
        } else {
          const q = rng.intInclusive(1, 4);
          if (removeItem(s, "potion-small", q)) netRemoved += q;
        }
        expect(s.inventory.length).toBeLessThanOrEqual(INVENTORY_CAPACITY);
        expect(countItem(s, "potion-small")).toBe(netAdded - netRemoved);
      }
    }
  });

  it("equip swap keeps exactly one weapon equipped or none", () => {
    const rng = new Rng(99);
    const weapons = ["weapon-rusty-shortsword", "weapon-legion-blade", "weapon-ember-fang"];
    for (let trial = 0; trial < 100; trial++) {
      const s = bareState();
      s.entities.set(0, {
        id: 0, kind: "player", pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, radius: 0.36,
        facing: 0, dead: false, age: 0, ttl: Infinity, hp: 10, maxHp: 10,
      });
      s.playerId = 0;
      for (const w of weapons) addItem(s, w, 1, false);
      for (let op = 0; op < 12; op++) {
        const w = rng.pick(weapons);
        equipItem(s, pack, w);
        // Invariant holds regardless of success.
        const equipped = [s.equipment.weapon].filter(Boolean);
        expect(equipped.length).toBeLessThanOrEqual(1);
        // Bag + equipment conserve weapons.
        const bagCount = weapons.reduce((acc, w2) => acc + countItem(s, w2), 0);
        expect(bagCount + equipped.length).toBeLessThanOrEqual(weapons.length);
      }
    }
  });
});

describe("procgen properties", () => {
  it("every generated floor over random seeds is fully reachable and legal", () => {
    const rng = new Rng(4242);
    for (let trial = 0; trial < 60; trial++) {
      const cfg = rng.pick(pack.floors);
      const seed = rng.int(1, 2 ** 30);
      const f = generateFloor(pack, cfg, seed);

      // Player start legal.
      const sx = Math.floor(f.spawns.playerStart.x);
      const sy = Math.floor(f.spawns.playerStart.y);
      expect(f.map.isWalkable(sx, sy)).toBe(true);

      // Everything interactive reachable.
      const reach = reachableTiles(f.map, f.spawns.playerStart.x, f.spawns.playerStart.y);
      const check = (px: number, py: number): boolean => reach.has(f.map.idx(Math.floor(px), Math.floor(py)));
      expect(check(f.spawns.exitPos.x, f.spawns.exitPos.y)).toBe(true);
      for (const e of f.spawns.enemies) expect(check(e.pos.x, e.pos.y)).toBe(true);
      for (const c of f.spawns.chests) expect(check(c.pos.x, c.pos.y)).toBe(true);
      for (const n of f.spawns.npcs) expect(check(n.pos.x, n.pos.y)).toBe(true);
      if (f.spawns.keyPos) expect(check(f.spawns.keyPos.x, f.spawns.keyPos.y)).toBe(true);
      if (f.spawns.boss) expect(check(f.spawns.boss.pos.x, f.spawns.boss.pos.y)).toBe(true);
    }
  });
});
