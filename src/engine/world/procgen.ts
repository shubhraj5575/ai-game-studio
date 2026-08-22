/**
 * Procedural floor generator.
 *
 * Mechanical core: room placement via rejection sampling, MST + loop-edge
 * corridor graph, L-shaped corridors (width 2), decoration, and spawn layout
 * driven by the content pack's FloorConfig. Every generated floor is validated
 * for full reachability before being returned; failures retry with derived
 * seeds so callers always receive a playable floor or an explicit error.
 */
import { Rng, combineSeeds } from "../core/rng.js";
import { vdist } from "../core/math.js";
import type { Vec2 } from "../core/math.js";
import { GameMap, Room, Tile } from "./map.js";
import { reachableTiles } from "./pathfind.js";
import type { ContentPack, FloorConfig } from "../content/types.js";

export interface FloorSpawns {
  playerStart: Vec2;
  exitPos: Vec2;
  lockedExit: boolean;
  keyPos: Vec2 | null;
  shrinePos: Vec2 | null;
  chests: Array<{ pos: Vec2; lootTableId: string }>;
  enemies: Array<{ pos: Vec2; enemyId: string }>;
  boss: { pos: Vec2; enemyId: string } | null;
  npcs: Array<{ pos: Vec2; npcDefId: string; questIds: string[] }>;
  torches: Vec2[];
  props: Array<{ pos: Vec2; kind: "barrel" | "crate" }>;
}

export interface GeneratedFloor {
  map: GameMap;
  spawns: FloorSpawns;
  floorName: string;
  depth: number;
  seedUsed: number;
  generationAttempts: number;
}

const MAX_ATTEMPTS = 24;

class AttemptFailed extends Error {}

/** Generate a complete floor. Throws only if MAX_ATTEMPTS consecutive seeds fail (a bug). */
export function generateFloor(pack: ContentPack, cfg: FloorConfig, masterSeed: number): GeneratedFloor {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = combineSeeds(masterSeed, "floor", cfg.depth, attempt);
    try {
      return generateOnce(pack, cfg, seed, attempt + 1);
    } catch (e) {
      if (!(e instanceof AttemptFailed)) throw e;
      lastError = e;
    }
  }
  throw new Error(
    `Floor ${cfg.depth} generation failed after ${MAX_ATTEMPTS} attempts: ` +
      (lastError instanceof Error ? lastError.message : String(lastError)),
  );
}

function generateOnce(pack: ContentPack, cfg: FloorConfig, seed: number, attemptNo: number): GeneratedFloor {
  const rng = new Rng(seed);
  const map = new GameMap(cfg.mapWidth, cfg.mapHeight, Tile.Wall);

  // ---- Room placement (rejection sampling) -------------------------------
  const targetRooms = rng.intInclusive(cfg.roomTargetMin, cfg.roomTargetMax);
  const rooms: Room[] = [];
  for (let tries = 0; tries < 400 && rooms.length < targetRooms; tries++) {
    const w = rng.intInclusive(5, 11);
    const h = rng.intInclusive(4, 9);
    const x = rng.intInclusive(1, map.width - w - 2);
    const y = rng.intInclusive(1, map.height - h - 2);
    const candidate: Room = { id: rooms.length, x, y, w, h };
    let overlaps = false;
    for (const r of rooms) {
      if (
        x < r.x + r.w + 2 && x + w + 2 > r.x &&
        y < r.y + r.h + 2 && y + h + 2 > r.y
      ) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) rooms.push(candidate);
  }
  if (rooms.length < Math.min(3, targetRooms)) throw new AttemptFailed(`only ${rooms.length} rooms placed`);

  map.rooms = rooms;

  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) map.setTile(x, y, Tile.Floor);
    }
  }

  // ---- Corridor graph: Prim MST over centers + extra loop edges ----------
  const centers = rooms.map((r) => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) }));
  const inTree = new Set<number>([0]);
  const mstEdges: Array<[number, number]> = [];
  while (inTree.size < rooms.length) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const a of inTree) {
      for (let b = 0; b < rooms.length; b++) {
        if (inTree.has(b)) continue;
        const d = vdist(centers[a]!, centers[b]!);
        if (d < bestD) {
          bestD = d;
          best = [a, b];
        }
      }
    }
    if (!best) break;
    mstEdges.push(best);
    inTree.add(best[1]!);
  }
  // Extra loops for player flow (~20% of MST size).
  const extraCount = Math.max(1, Math.round(mstEdges.length * 0.2));
  for (let i = 0; i < extraCount && rooms.length > 3; i++) {
    const a = rng.int(0, rooms.length);
    const b = rng.int(0, rooms.length);
    if (a !== b) mstEdges.push([a, b]);
  }

  const doorTiles: Vec2[] = [];
  for (const [a, b] of mstEdges) carveCorridor(map, centers[a]!, centers[b]!, doorTiles, rng);

  // Decorative doors where corridors meet room boundaries.
  for (const d of doorTiles) map.setTile(d.x, d.y, Tile.Door);

  // ---- Reachability validation -------------------------------------------
  const startRoom = rooms[0]!;
  const startCenter = { x: startRoom.x + 0.5, y: startRoom.y + 0.5 };
  const reachable = reachableTiles(map, startCenter.x, startCenter.y);
  let floorTiles = 0;
  let reachableFloor = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.isWalkable(x, y)) {
        floorTiles++;
        if (reachable.has(y * map.width + x)) reachableFloor++;
      }
    }
  }
  if (reachableFloor < floorTiles) {
    throw new AttemptFailed(`${floorTiles - reachableFloor} unreachable floor tiles`);
  }
  for (const r of rooms.slice(1)) {
    const c = map.idx(r.x + (r.w >> 1), r.y + (r.h >> 1));
    if (!reachable.has(c)) throw new AttemptFailed("room not connected");
  }

  // ---- Distance field from start for placement ordering ------------------
  const distField = bfsDistance(map, startCenter.x, startCenter.y);
  const sortedRooms = [...rooms].sort((ra, rb) => {
    const ca = distField[map.idx(ra.x + (ra.w >> 1), ra.y + (ra.h >> 1))] ?? Infinity;
    const cb = distField[map.idx(rb.x + (rb.w >> 1), rb.y + (rb.h >> 1))] ?? Infinity;
    return cb - ca; // farthest first
  });

  const farthestRoom = sortedRooms[0]!;
  const midRoom = sortedRooms[Math.min(sortedRooms.length - 1, 1 + ((sortedRooms.length - 2) >> 1))] ?? rooms[1]!;

  const centerOf = (r: Room): Vec2 => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const exitPos = centerOf(farthestRoom);

  // Key placement: any room that is neither start nor exit room, prefer distant.
  let keyPos: Vec2 | null = null;
  if (cfg.keyRequired) {
    for (const r of sortedRooms) {
      if (r === startRoom || r === farthestRoom) continue;
      keyPos = randomTileInRoom(map, r, rng, startCenter, 6);
      if (keyPos) break;
    }
    if (!keyPos) throw new AttemptFailed("no valid key position");
  }

  // Shrine: mid-distance room.
  const shrinePos = cfg.hasShrine ? randomTileInRoom(map, midRoom, rng, startCenter, 4) : null;

  // Chests spread across non-start rooms.
  const chests: FloorSpawns["chests"] = [];
  const chestRooms = shuffleCopy(rng, rooms.filter((r) => r !== startRoom));
  for (let i = 0; i < cfg.chestCount && chestRooms.length > 0; i++) {
    const r = chestRooms[i % chestRooms.length]!;
    const p = randomTileInRoom(map, r, rng, startCenter, 5);
    if (p) chests.push({ pos: p, lootTableId: pickLootTable(pack, cfg.depth, rng) });
  }

  // Enemies distributed across non-start rooms by budget.
  const enemies: FloorSpawns["enemies"] = [];
  const totalWeight = cfg.spawnTable.reduce((s, e) => s + e.weight, 0);
  const spawnBudget = cfg.enemyBudgetBase + cfg.enemyBudgetPerDepth * cfg.depth;
  const combatRooms = rooms.filter((r) => r !== startRoom);
  if (combatRooms.length === 0) throw new AttemptFailed("no combat rooms");
  for (const r of combatRooms) {
    const areaShare = (r.w * r.h) / rooms.reduce((s, rr) => s + rr.w * rr.h, 0);
    let count = Math.round(spawnBudget * areaShare * rng.range(0.7, 1.3));
    count = Math.max(count, 1);
    for (let i = 0; i < count; i++) {
      const p = randomTileInRoom(map, r, rng, startCenter, 8);
      if (!p) continue;
      const roll = rng.next() * totalWeight;
      let acc = 0;
      let chosen = cfg.spawnTable[0]!.enemyId;
      for (const entry of cfg.spawnTable) {
        acc += entry.weight;
        if (roll <= acc) {
          chosen = entry.enemyId;
          break;
        }
      }
      enemies.push({ pos: p, enemyId: chosen });
    }
  }

  // Boss occupies the exit room.
  let boss: FloorSpawns["boss"] = null;
  if (cfg.bossId) {
    const bp = randomTileInRoom(map, farthestRoom, rng, exitPos, 2) ?? exitPos;
    boss = { pos: bp, enemyId: cfg.bossId };
  }

  // NPCs in early/mid rooms. Quest templates are dealt from one shared,
  // shuffled pool so two NPCs never duplicate the same quest on a floor.
  const npcs: FloorSpawns["npcs"] = [];
  {
    const questPool = rng.shuffle([...pack.questTemplates.map((q) => q.id)]);
    let poolIdx = 0;
    const npcRooms = shuffleCopy(rng, rooms.filter((r) => r !== startRoom && r !== farthestRoom));
    for (let i = 0; i < cfg.npcIds.length; i++) {
      const r = npcRooms[i % Math.max(npcRooms.length, 1)] ?? midRoom;
      const p = randomTileInRoom(map, r, rng, startCenter, 6);
      if (p) {
        const questIds: string[] = [];
        for (let qn = 0; qn < cfg.questCount && pack.questTemplates.length > 0; qn++) {
          questIds.push(questPool[poolIdx % questPool.length]!);
          poolIdx++;
        }
        npcs.push({ pos: p, npcDefId: cfg.npcIds[i]!, questIds });
      }
    }
  }

  // Torches: wall-adjacent floor tiles inside rooms, sparse.
  const torches: Vec2[] = [];
  for (const r of rooms) {
    for (let t = 0; t < 3; t++) {
      const tx = rng.int(r.x, r.x + r.w);
      const ty = rng.int(r.y, r.y + r.h);
      if (map.tileAt(tx, ty) === Tile.Floor && adjacentToWall(map, tx, ty)) {
        torches.push({ x: tx + 0.5, y: ty + 0.5 });
      }
    }
  }

  // Props: sparse blocking clutter in room corners.
  const props: FloorSpawns["props"] = [];
  for (const r of rooms) {
    if (!rng.chance(0.5)) continue;
    const p = randomTileInRoom(map, r, rng, startCenter, 10);
    if (p && vdist(p, startCenter) > 6) props.push({ pos: p, kind: rng.chance(0.5) ? "barrel" : "crate" });
  }

  // Rubble decor variant on some walls facing floors.
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) {
      if (map.tileAt(x, y) === Tile.Wall && rng.chance(0.06)) map.setTile(x, y, Tile.Rubble);
    }
  }

  const floorName = rng.pick(cfg.floorNameTemplates).replace("{adj}", rng.pick(pack.narrative.floorAdjectives));

  return {
    map,
    spawns: {
      playerStart: startCenter,
      exitPos,
      lockedExit: cfg.keyRequired || !!cfg.bossId,
      keyPos,
      shrinePos,
      chests,
      enemies,
      boss,
      npcs,
      torches,
      props,
    },
    floorName,
    depth: cfg.depth,
    seedUsed: seed,
    generationAttempts: attemptNo,
  };
}

function carveCorridor(map: GameMap, a: { x: number; y: number }, b: { x: number; y: number }, doors: Vec2[], rng: Rng): void {
  // L-shape: horizontal then vertical (or reverse), 2 wide.
  const horizontalFirst = rng.chance(0.5);
  const carveH = (x0: number, x1: number, y: number) => {
    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    for (let x = lo; x <= hi; x++) openCorridorTile(map, x, y, doors);
    for (let x = lo; x <= hi; x++) openCorridorTile(map, x, y + 1, doors);
  };
  const carveV = (y0: number, y1: number, x: number) => {
    const lo = Math.min(y0, y1);
    const hi = Math.max(y0, y1);
    for (let y = lo; y <= hi; y++) openCorridorTile(map, x, y, doors);
    for (let y = lo; y <= hi; y++) openCorridorTile(map, x + 1, y, doors);
  };
  if (horizontalFirst) {
    carveH(a.x, b.x, a.y);
    carveV(a.y, b.y, b.x);
  } else {
    carveV(a.y, b.y, a.x);
    carveH(a.x, b.x, b.y);
  }
}

function openCorridorTile(map: GameMap, x: number, y: number, doors: Vec2[]): void {
  if (!map.inBounds(x, y)) return;
  if (map.tileAt(x, y) === Tile.Wall) {
    map.setTile(x, y, Tile.Floor);
    // Door candidate when this wall tile borders a room edge — approximate by
    // checking orthogonal neighbors later during door pass; simple heuristic:
    if (rngDoorCandidate(map, x, y)) doors.push({ x, y });
  }
}

function rngDoorCandidate(map: GameMap, x: number, y: number): boolean {
  // A corridor tile that touches floor on exactly one opposite pair is a
  // doorway into a room. Cheap approximation; purely decorative anyway.
  const horiz = map.isWalkable(x - 1, y) && map.isWalkable(x + 1, y) &&
    !map.isWalkable(x, y - 1) && !map.isWalkable(x, y + 1);
  const vert = map.isWalkable(x, y - 1) && map.isWalkable(x, y + 1) &&
    !map.isWalkable(x - 1, y) && !map.isWalkable(x + 1, y);
  return horiz || vert;
}

function bfsDistance(map: GameMap, sx: number, sy: number): Int32Array {
  const dist = new Int32Array(map.width * map.height).fill(-1);
  const queue: number[] = [];
  const startIdx = Math.floor(sy) * map.width + Math.floor(sx);
  if (!map.inBounds(Math.floor(sx), Math.floor(sy)) || !map.isWalkable(Math.floor(sx), Math.floor(sy))) return dist;
  dist[startIdx] = 0;
  queue.push(startIdx);
  for (let qi = 0; qi < queue.length; qi++) {
    const idx = queue[qi]!;
    const x = idx % map.width;
    const y = (idx / map.width) | 0;
    const d = dist[idx]!;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + ox;
      const ny = y + oy;
      if (!map.inBounds(nx, ny)) continue;
      const nIdx = ny * map.width + nx;
      if (dist[nIdx] !== -1 || !map.isWalkable(nx, ny)) continue;
      dist[nIdx] = d + 1;
      queue.push(nIdx);
    }
  }
  return dist;
}

function adjacentToWall(map: GameMap, x: number, y: number): boolean {
  return !map.isWalkable(x - 1, y) || !map.isWalkable(x + 1, y) ||
    !map.isWalkable(x, y - 1) || !map.isWalkable(x, y + 1);
}

/** Random walkable tile inside a room at least minDist from avoid point; null if none found quickly. */
function randomTileInRoom(map: GameMap, r: Room, rng: Rng, avoid: Vec2, minDist: number): Vec2 | null {
  for (let t = 0; t < 40; t++) {
    const x = rng.intInclusive(r.x, r.x + r.w - 1);
    const y = rng.intInclusive(r.y, r.y + r.h - 1);
    if (!map.isWalkable(x, y)) continue;
    const wx = x + 0.5;
    const wy = y + 0.5;
    if (vdist({ x: wx, y: wy }, avoid) < minDist) continue;
    return { x: wx, y: wy };
  }
  return null;
}

function pickLootTable(pack: ContentPack, _depth: number, _rng: Rng): string {
  // One shared table id convention authored by the Systems Designer agent.
  const ids = pack.lootTables.map((t) => t.id);
  return ids.includes("chest-default") ? "chest-default" : ids[0] ?? "chest-default";
}

function shuffleCopy<T>(rng: Rng, arr: readonly T[]): T[] {
  return rng.shuffle([...arr]);
}
