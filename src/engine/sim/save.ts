/**
 * Save / load — full-state snapshots with magic header, version, pack
 * compatibility check, and FNV-1a checksum.
 *
 * Snapshots are plain JSON (human-inspectable) and round-trip bit-exactly:
 * restoring a save reproduces the identical RNG stream states, so subsequent
 * play continues deterministically.
 */
import { fnv1a } from "../core/hash.js";
import { GameMap } from "../world/map.js";
import type { Room } from "../world/map.js";
import type { ContentPack } from "../content/types.js";
import { validateContentPack } from "../content/types.js";
import { Rng } from "../core/rng.js";
import { SAVE_MAGIC, SAVE_VERSION, Simulation } from "./simulation.js";
import type { Entity, SimState } from "./state.js";

export interface SaveEnvelope {
  magic: string;
  version: number;
  packVersion: string;
  title: string;
  depth: number;
  savedAtIso: string;
  checksum: string;
  data: SerializedState;
}

interface SerializedState {
  seed: number;
  tick: number;
  timeSec: number;
  status: SimState["status"];
  depth: number;
  floorName: string;
  map: { width: number; height: number; tiles: number[]; rooms: Room[] };
  entities: Entity[];
  nextEntityId: number;
  playerId: number;
  level: number;
  xp: number;
  gold: number;
  inventory: SimState["inventory"];
  equipment: SimState["equipment"];
  quests: SimState["quests"];
  dialogue: SimState["dialogue"];
  keyCollected: boolean;
  exitUnlocked: boolean;
  visitedRoomIds: number[];
  shopStocks: Record<string, string[]>;
  lastDamageSource: string;
  rngStates: SimState["rngStates"];
  stats: SimState["stats"];
  recentEvents: SimState["recentEvents"];
}

/**
 * JSON does not preserve Infinity/NaN — they become null, which previously
 * caused restored entities to expire instantly. We encode them as sentinel
 * strings. Collision risk with genuine string data is accepted deliberately:
 * no engine field carries these magic values.
 */
type JsonValue = string | number | boolean | null | object;

function jsonReplacer(_key: string, value: JsonValue): JsonValue {
  if (value === Infinity) return "__INF__";
  if (value === -Infinity) return "__NEGINF__";
  if (typeof value === "number" && Number.isNaN(value)) return "__NAN__";
  return value;
}

function jsonReviver(_key: string, value: JsonValue): JsonValue {
  if (value === "__INF__") return Infinity;
  if (value === "__NEGINF__") return -Infinity;
  if (value === "__NAN__") return NaN;
  return value;
}

/** Canonical serialization used for both storage and checksumming. */
function serializeState(data: SerializedState): string {
  return JSON.stringify(data, jsonReplacer);
}

export class SaveError extends Error {}

/** Produce a portable save string. */
export function snapshot(sim: Simulation): string {
  const s = sim.state;
  const data: SerializedState = {
    seed: s.seed,
    tick: s.tick,
    // NOTE: no rounding — JSON round-trips doubles exactly, and any drift
    // here would desynchronize AI timers after restore.
    timeSec: s.timeSec,
    status: s.status,
    depth: s.depth,
    floorName: s.floorName,
    map: {
      width: s.map.width,
      height: s.map.height,
      tiles: Array.from(s.map.tiles),
      rooms: s.map.rooms,
    },
    entities: [...s.entities.values()],
    nextEntityId: s.nextEntityId,
    playerId: s.playerId,
    level: s.level,
    xp: s.xp,
    gold: s.gold,
    inventory: s.inventory,
    equipment: s.equipment,
    quests: s.quests,
    dialogue: null, // never serialize an open dialogue
    keyCollected: s.keyCollected,
    exitUnlocked: s.exitUnlocked,
    visitedRoomIds: s.visitedRoomIds,
    shopStocks: s.shopStocks,
    lastDamageSource: s.lastDamageSource,
    rngStates: s.rngStates,
    stats: s.stats,
    recentEvents: [],
  };
  const body = serializeState(data);
  const envelope: SaveEnvelope = {
    magic: SAVE_MAGIC,
    version: SAVE_VERSION,
    packVersion: sim.pack.meta.version,
    title: sim.pack.meta.title,
    depth: s.depth,
    savedAtIso: new Date().toISOString(),
    checksum: fnv1a(body),
    // Keep sentinel strings in the embedded copy (no reviver here!) so that a
    // second JSON.stringify of the whole envelope never sees raw Infinity.
    data: JSON.parse(body) as SerializedState,
  };
  return JSON.stringify(envelope);
}

/** Rebuild a runnable simulation from a save string. Throws SaveError on any mismatch. */
export function restoreFromSnapshot(pack: ContentPack, json: string): Simulation {
  let envelope: SaveEnvelope;
  try {
    envelope = JSON.parse(json) as SaveEnvelope;
  } catch (e) {
    throw new SaveError(`Save is not valid JSON: ${(e as Error).message}`);
  }
  if (envelope.magic !== SAVE_MAGIC) throw new SaveError("Not a save file (bad magic)");
  if (envelope.version !== SAVE_VERSION) {
    throw new SaveError(`Save version ${envelope.version} unsupported (expected ${SAVE_VERSION})`);
  }
  if (envelope.packVersion !== pack.meta.version) {
    throw new SaveError(
      `Save was made for content v${envelope.packVersion}, but installed content is v${pack.meta.version}`,
    );
  }

  const body = serializeState(envelope.data);
  if (fnv1a(body) !== envelope.checksum) {
    throw new SaveError("Save checksum mismatch — file corrupted or tampered");
  }

  const problems = validateContentPack(pack);
  if (problems.length > 0) throw new SaveError("Installed content pack invalid");

  const d = JSON.parse(serializeState(envelope.data), jsonReviver) as SerializedState;

  // Structural sanity before trusting the data.
  if (!Number.isInteger(d.seed) || !Number.isFinite(d.timeSec)) throw new SaveError("Corrupt core fields");
  if (!d.entities.some((e) => e.id === d.playerId)) throw new SaveError("Player entity missing");
  if (!Number.isFinite(d.playerId) || d.playerId <= 0) throw new SaveError("Bad player id");

  const sim = Object.create(Simulation.prototype) as Simulation;
  (sim as { pack: ContentPack }).pack = pack;

  // Class field initializers never ran (no constructor call) — create RNG
  // streams explicitly, then load saved states.
  const withRngs = sim as unknown as {
    rngCombat: { setState(s: number): void };
    rngLoot: { setState(s: number): void };
    rngAi: { setState(s: number): void };
    rngMisc: { setState(s: number): void };
  };
  const mkRng = () => new Rng(0);
  (withRngs as { rngCombat: unknown }).rngCombat = mkRng();
  (withRngs as { rngLoot: unknown }).rngLoot = mkRng();
  (withRngs as { rngAi: unknown }).rngAi = mkRng();
  (withRngs as { rngMisc: unknown }).rngMisc = mkRng();

  const map = new GameMap(d.map.width, d.map.height);
  map.tiles.set(d.map.tiles);
  map.rooms = d.map.rooms;

  const entities = new Map<number, Entity>();
  for (const e of d.entities) entities.set(e.id, e);

  sim.state = {
    packVersion: pack.meta.version,
    seed: d.seed,
    tick: d.tick,
    timeSec: d.timeSec,
    status: d.status === "playing" ? "playing" : d.status,
    depth: d.depth,
    floorName: d.floorName,
    map,
    entities,
    nextEntityId: d.nextEntityId,
    playerId: d.playerId,
    level: d.level,
    xp: d.xp,
    gold: d.gold,
    inventory: d.inventory,
    equipment: d.equipment,
    quests: d.quests,
    dialogue: null,
    keyCollected: d.keyCollected,
    exitUnlocked: d.exitUnlocked,
    visitedRoomIds: d.visitedRoomIds,
    shopStocks: d.shopStocks,
    lastDamageSource: d.lastDamageSource,
    rngStates: d.rngStates,
    stats: d.stats,
    recentEvents: [],
    fatalError: null,
  };

  // Restore private runtime fields.
  const priv = sim as unknown as {
    rngCombat: { setState(s: number): void };
    rngLoot: { setState(s: number): void };
    rngAi: { setState(s: number): void };
    rngMisc: { setState(s: number): void };
    pendingNoises: unknown[];
    prevInput: unknown;
    currentRoomId: number | null;
  };
  priv.rngCombat.setState(d.rngStates.combat);
  priv.rngLoot.setState(d.rngStates.loot);
  priv.rngAi.setState(d.rngStates.ai);
  priv.rngMisc.setState(d.rngStates.misc);
  priv.pendingNoises = [];
  priv.prevInput = { attackHeld: false, dodgePressed: false, interactPressed: false };
  priv.currentRoomId = null;

  return sim;
}
