import { describe, it, expect } from "vitest";
import { generateFloor } from "../../src/engine/world/procgen.js";
import { reachableTiles } from "../../src/engine/world/pathfind.js";
import { findPath } from "../../src/engine/world/pathfind.js";
import { hasLineOfSight } from "../../src/engine/world/los.js";
import type { ContentPack } from "../../src/engine/content/types.js";
import { makeTestPack } from "../fixtures/test-pack.js";

describe("procedural floor generation", () => {
  const pack: ContentPack = makeTestPack();

  it.each([1, 2, 3])("generates a valid floor for depth %i across many seeds", (depth) => {
    const cfg = pack.floors.find((f) => f.depth === depth)!;
    for (let seed = 1; seed <= 40; seed++) {
      const floor = generateFloor(pack, cfg, seed * 7919);

      // Map integrity
      expect(floor.map.width).toBe(cfg.mapWidth);
      expect(floor.map.height).toBe(cfg.mapHeight);

      // Player start must be walkable.
      const startTile = floor.map.tileAt(Math.floor(floor.spawns.playerStart.x), Math.floor(floor.spawns.playerStart.y));
      expect(startTile === 1 || startTile === 2).toBe(true);

      // Exit reachable from player start.
      const reach = reachableTiles(floor.map, floor.spawns.playerStart.x, floor.spawns.playerStart.y);
      const exitIdx = floor.map.idx(Math.floor(floor.spawns.exitPos.x), Math.floor(floor.spawns.exitPos.y));
      expect(reach.has(exitIdx)).toBe(true);

      // Key reachable when required.
      if (floor.spawns.keyPos) {
        const keyIdx = floor.map.idx(Math.floor(floor.spawns.keyPos.x), Math.floor(floor.spawns.keyPos.y));
        expect(reach.has(keyIdx)).toBe(true);
      }

      // All enemies on walkable tiles & reachable.
      for (const e of floor.spawns.enemies) {
        const idx = floor.map.idx(Math.floor(e.pos.x), Math.floor(e.pos.y));
        expect(reach.has(idx)).toBe(true);
      }

      // Spawn table respected.
      const validIds = new Set(cfg.spawnTable.map((s) => s.enemyId));
      for (const e of floor.spawns.enemies) {
        expect(validIds.has(e.enemyId)).toBe(true);
      }

      // Enemies never spawn on top of the player start.
      for (const e of floor.spawns.enemies) {
        const dx = e.pos.x - floor.spawns.playerStart.x;
        const dy = e.pos.y - floor.spawns.playerStart.y;
        expect(dx * dx + dy * dy).toBeGreaterThan(36);
      }
    }
  });

  it("is deterministic per seed", () => {
    const cfg = pack.floors.find((f) => f.depth === 1)!;
    const a = generateFloor(pack, cfg, 999);
    const b = generateFloor(pack, cfg, 999);
    expect(a.floorName).toBe(b.floorName);
    expect(a.seedUsed).toBe(b.seedUsed);
    expect(a.spawns).toEqual(b.spawns);
    expect(Array.from(a.map.tiles)).toEqual(Array.from(b.map.tiles));
  });

  it("key floors place a key; boss floors place a boss", () => {
    const d2 = pack.floors.find((f) => f.depth === 2)!;
    const d3 = pack.floors.find((f) => f.depth === 3)!;
    const f2 = generateFloor(pack, d2, 12345);
    expect(f2.spawns.keyPos).not.toBeNull();
    const f3 = generateFloor(pack, d3, 12345);
    expect(f3.spawns.boss).not.toBeNull();
    expect(f3.spawns.boss!.enemyId).toBe("warden");
  });
});

describe("pathfinding", () => {
  it("finds a path through connected rooms and returns tile centers", () => {
    const pack = makeTestPack();
    const cfg = pack.floors[0]!;
    const floor = generateFloor(pack, cfg, 4242);
    const path = findPath(
      floor.map,
      floor.spawns.playerStart.x, floor.spawns.playerStart.y,
      floor.spawns.exitPos.x, floor.spawns.exitPos.y,
    );
    expect(path.length).toBeGreaterThan(0);
    // Every waypoint walkable.
    for (const p of path) {
      expect(floor.map.isWalkableWorld(p.x, p.y)).toBe(true);
    }
    // Endpoint near goal.
    const goal = path[path.length - 1]!;
    expect(Math.abs(goal.x - Math.floor(floor.spawns.exitPos.x) - 0.5)).toBeLessThan(1.01);
  });

  it("returns empty path to unreachable/wall targets without crashing", () => {
    const pack = makeTestPack();
    const cfg = pack.floors[0]!;
    const floor = generateFloor(pack, cfg, 17);
    // Wall corner (0,0) is always wall by construction margin.
    const path = findPath(floor.map, floor.spawns.playerStart.x, floor.spawns.playerStart.y, 0.5, 0.5);
    expect(path).toHaveLength(0);
  });
});

describe("line of sight", () => {
  it("blocks sight through walls", () => {
    const pack = makeTestPack();
    const cfg = pack.floors[0]!;
    const floor = generateFloor(pack, cfg, 88);
    // Same-room points see each other.
    const r0 = floor.map.rooms[0]!;
    const ax = r0.x + 0.5, ay = r0.y + 0.5;
    const bx = r0.x + r0.w - 1.5, by = r0.y + r0.h - 1.5;
    expect(hasLineOfSight(floor.map, ax, ay, bx, by)).toBe(true);
    // A point deep outside the map cannot see inside.
    expect(hasLineOfSight(floor.map, 0.2, 0.2, ax, ay)).toBe(false);
  });
});
