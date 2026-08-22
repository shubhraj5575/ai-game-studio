/**
 * Content pack schema — the contract between the Studio agents and the engine.
 *
 * The studio's agents (designer, systems designer, narrative designer, level
 * designer, asset manager, audio manager) author this data. The engine is a
 * general interpreter: it contains no game-specific content itself.
 *
 * Everything here is plain JSON-serializable data so builds are reproducible
 * and diffable.
 */

export type Rarity = "common" | "uncommon" | "rare" | "epic";

export interface EnemyDef {
  id: string;
  name: string;
  /** Minimum floor depth at which this enemy may appear. */
  minDepth: number;
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  attackRange: number;
  attackCooldownSec: number;
  perceptionRadius: number;
  hearingRadius: number;
  behavior: "melee" | "ranged" | "charger";
  projectileSpeed?: number;
  xpReward: number;
  goldDropMin: number;
  goldDropMax: number;
  color: string;
  shape: "blob" | "imp" | "brute" | "wraith";
}

export interface ItemDef {
  id: string;
  name: string;
  kind: "weapon" | "armor" | "potion" | "relic" | "quest";
  rarity: Rarity;
  value: number;
  stackable: boolean;
  description: string;
  /** weapon */
  power?: number;
  attackSpeed?: number;
  /** armor */
  defense?: number;
  /** potion */
  healAmount?: number;
  /** relic passive id — interpreted by the progression system */
  relicEffect?: RelicEffect;
}

export type RelicEffect =
  | { kind: "maxHp"; amount: number }
  | { kind: "damageMult"; mult: number }
  | { kind: "moveSpeedMult"; mult: number }
  | { kind: "critChance"; amount: number }
  | { kind: "goldGainMult"; mult: number };

export interface LootEntry {
  itemId: string;
  weight: number;
  quantityMin?: number;
  quantityMax?: number;
}

export interface LootTableDef {
  id: string;
  entries: LootEntry[];
}

export interface QuestTemplate {
  id: string;
  kind: "slay" | "collect" | "explore";
  /** Title templates with slots: {count} {enemy} {item} {floorName}. */
  titles: string[];
  targetCountMin: number;
  targetCountMax: number;
  rewardGoldMin: number;
  rewardGoldMax: number;
  rewardXpMin: number;
  rewardXpMax: number;
  rewardItemId?: string;
  offerTexts: string[];
  completeTexts: string[];
}

export interface NpcDef {
  id: string;
  role: "questgiver" | "merchant";
  firstNamePool: string[];
  titlePool: string[];
  idleLines: string[];
  color: string;
}

export interface FloorConfig {
  depth: number;
  mapWidth: number;
  mapHeight: number;
  roomTargetMin: number;
  roomTargetMax: number;
  enemyBudgetBase: number;
  enemyBudgetPerDepth: number;
  spawnTable: Array<{ enemyId: string; weight: number }>;
  keyRequired: boolean;
  bossId?: string;
  chestCount: number;
  hasShrine: boolean;
  npcIds: string[];
  questCount: number;
  floorNameTemplates: string[];
  ambientTint: string;
  musicScaleId: string;
}

export interface PlayerTuning {
  baseSpeed: number;
  baseMaxHp: number;
  baseDamage: number;
  baseDefense: number;
  attackRange: number;
  attackArcDeg: number;
  attackCooldownSec: number;
  dodgeSpeedMult: number;
  dodgeDurationSec: number;
  dodgeCooldownSec: number;
  staminaMax: number;
  staminaRegenPerSec: number;
  dodgeStaminaCost: number;
  iframesAfterHitSec: number;
  pickupRadius: number;
  interactRadius: number;
  critChance: number;
  critMultiplier: number;
  knockbackForce: number;
  damageVariancePct: number;
  hpPerLevel: number;
  damagePerLevel: number;
}

export interface XpCurveDef {
  base: number;
  growth: number;
}

export interface SystemsTuning {
  player: PlayerTuning;
  xpCurve: XpCurveDef;
  startingGold: number;
  potionPrice: number;
  priceVariancePct: number;
  depthHpScale: number;
  depthDamageScale: number;
}

export interface AudioTheme {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  musicTempoBpm: number;
  scales: Record<string, number[]>;
  sfx: Record<string, SfxSpec>;
}

export interface SfxSpec {
  wave: "square" | "sawtooth" | "triangle" | "sine" | "noise";
  freqStart: number;
  freqEnd: number;
  durationSec: number;
  volume: number;
  sweepExp?: boolean;
}

export interface PaletteDef {
  background: string;
  wallTop: string;
  wallFace: string;
  floorA: string;
  floorB: string;
  accent: string;
  danger: string;
  friendly: string;
  gold: string;
  uiPanel: string;
  uiText: string;
}

export interface NarrativeTables {
  worldName: string;
  premise: string;
  floorAdjectives: string[];
  floorNouns: string[];
  itemPrefixes: Record<Rarity, string[]>;
  loreFragments: string[];
  victoryText: string;
  defeatText: string;
}

export interface ContentPackMeta {
  title: string;
  tagline: string;
  version: string;
  /** Auto-fix patch counter incremented by the Programmer agent. */
  patch?: number;
  seedBase: number;
  generator: string;
  createdAtIso: string;
}

export interface ContentPack {
  meta: ContentPackMeta;
  palette: PaletteDef;
  systems: SystemsTuning;
  enemies: EnemyDef[];
  items: ItemDef[];
  lootTables: LootTableDef[];
  questTemplates: QuestTemplate[];
  npcDefs: NpcDef[];
  floors: FloorConfig[];
  narrative: NarrativeTables;
  audio: AudioTheme;
}

/** Thrown when a content pack fails validation; message lists all problems. */
export class ContentValidationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Content pack invalid (${problems.length} problem(s)):\n - ` + problems.join("\n - "));
    this.name = "ContentValidationError";
    this.problems = problems;
  }
}

/** Structural + semantic validation used by the Programmer agent, QA, and save/load. */
export function validateContentPack(pack: unknown): string[] {
  const p = pack as Partial<ContentPack> | null;
  const problems: string[] = [];
  if (!p || typeof p !== "object") return ["pack is not an object"];

  if (!p.meta || typeof p.meta.title !== "string" || p.meta.title.length === 0) {
    problems.push("meta.title missing");
  }
  if (!p.palette || typeof p.palette !== "object") problems.push("palette missing");

  // Enemies: positive stats, unique ids, sane ranges.
  const enemyIds = new Set<string>();
  for (const e of p.enemies ?? []) {
    if (enemyIds.has(e.id)) problems.push(`duplicate enemy id ${e.id}`);
    enemyIds.add(e.id);
    if (!(e.hp > 0)) problems.push(`enemy ${e.id}: hp must be > 0`);
    if (!(e.speed >= 0)) problems.push(`enemy ${e.id}: speed must be >= 0`);
    if (!(e.damage >= 0)) problems.push(`enemy ${e.id}: damage must be >= 0`);
    if (!(e.radius > 0 && e.radius < 2)) problems.push(`enemy ${e.id}: radius out of range (0,2)`);
    if (!["melee", "ranged", "charger"].includes(e.behavior)) problems.push(`enemy ${e.id}: bad behavior`);
    if (e.behavior === "ranged" && !(e.projectileSpeed && e.projectileSpeed > 0)) {
      problems.push(`enemy ${e.id}: ranged requires projectileSpeed > 0`);
    }
  }
  if ((p.enemies?.length ?? 0) === 0) problems.push("no enemies defined");

  // Items: unique ids, weapons have power, potions heal.
  const itemIds = new Set<string>();
  for (const it of p.items ?? []) {
    if (itemIds.has(it.id)) problems.push(`duplicate item id ${it.id}`);
    itemIds.add(it.id);
    if (!(it.value >= 0)) problems.push(`item ${it.id}: negative value`);
    if (it.kind === "weapon" && !(it.power !== undefined && it.power > 0)) problems.push(`weapon ${it.id}: needs power > 0`);
    if (it.kind === "potion" && !(it.healAmount !== undefined && it.healAmount > 0)) problems.push(`potion ${it.id}: needs healAmount > 0`);
  }

  // Loot tables reference real items.
  for (const lt of p.lootTables ?? []) {
    let totalWeight = 0;
    for (const entry of lt.entries) {
      totalWeight += entry.weight;
      if (!itemIds.has(entry.itemId)) problems.push(`loot table ${lt.id}: unknown item ${entry.itemId}`);
      if (!(entry.weight >= 0)) problems.push(`loot table ${lt.id}: negative weight for ${entry.itemId}`);
    }
    if (totalWeight <= 0) problems.push(`loot table ${lt.id}: total weight must be > 0`);
  }

  // Floors: contiguous depths from 1, spawn tables reference real enemies, budgets positive.
  const floorsSorted = [...(p.floors ?? [])].sort((a, b) => a.depth - b.depth);
  floorsSorted.forEach((f, i) => {
    if (f.depth !== i + 1) problems.push(`floors must be contiguous from depth 1 (found depth ${f.depth} at index ${i})`);
    if (f.mapWidth < 24 || f.mapHeight < 24) problems.push(`floor ${f.depth}: map too small`);
    if (f.roomTargetMin < 3 || f.roomTargetMax < f.roomTargetMin) problems.push(`floor ${f.depth}: bad room targets`);
    if (!(f.enemyBudgetBase >= 0)) problems.push(`floor ${f.depth}: bad enemy budget`);
    if (f.spawnTable.length === 0) problems.push(`floor ${f.depth}: empty spawn table`);
    for (const s of f.spawnTable) {
      if (!enemyIds.has(s.enemyId)) problems.push(`floor ${f.depth}: spawn references unknown enemy ${s.enemyId}`);
      if (!(s.weight > 0)) problems.push(`floor ${f.depth}: spawn weight must be > 0 (${s.enemyId})`);
    }
    if (!f.floorNameTemplates?.length) problems.push(`floor ${f.depth}: no floor name templates`);
  });

  // Quest templates reference real items in rewards.
  for (const q of p.questTemplates ?? []) {
    if (q.rewardItemId && !itemIds.has(q.rewardItemId)) {
      problems.push(`quest template ${q.id}: unknown reward item ${q.rewardItemId}`);
    }
    if (!(q.targetCountMin >= 1) || q.targetCountMax < q.targetCountMin) {
      problems.push(`quest template ${q.id}: bad target counts`);
    }
  }

  // NPCs reference nothing external; merchants need prices via systems.
  const npcIds = new Set<string>();
  for (const n of p.npcDefs ?? []) {
    if (npcIds.has(n.id)) problems.push(`duplicate npc id ${n.id}`);
    npcIds.add(n.id);
  }
  for (const f of p.floors ?? []) {
    for (const nid of f.npcIds ?? []) {
      if (!npcIds.has(nid)) problems.push(`floor ${f.depth}: unknown npc ${nid}`);
    }
  }

  // Systems sanity.
  const st = p.systems;
  if (st) {
    if (!(st.player.baseSpeed > 0)) problems.push("systems.player.baseSpeed must be > 0");
    if (!(st.player.baseMaxHp > 0)) problems.push("systems.player.baseMaxHp must be > 0");
    if (!(st.xpCurve.base > 0 && st.xpCurve.growth >= 1)) problems.push("systems.xpCurve invalid");
    if (!(st.player.attackRange > 0)) problems.push("systems.player.attackRange must be > 0");
    if (!(st.player.dodgeDurationSec > 0)) problems.push("systems.player.dodgeDurationSec must be > 0");
  } else {
    problems.push("systems tuning missing");
  }

  return problems;
}
