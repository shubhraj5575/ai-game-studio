/** Core simulation state model. Plain data — fully serializable. */
import type { Vec2 } from "../core/math.js";
import type { GameMap } from "../world/map.js";
import type { ContentPack } from "../content/types.js";

export type Team = "player" | "hostile";

export type EntityKind =
  | "player"
  | "enemy"
  | "npc"
  | "itemDrop"
  | "gold"
  | "key"
  | "chest"
  | "shrine"
  | "portal"
  | "projectile"
  | "prop"
  | "fx";

export interface Entity {
  id: number;
  kind: EntityKind;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  facing: number;
  dead: boolean;
  /** Seconds alive (for animation/fx). */
  age: number;
  /** Remaining lifetime for temporary entities (fx, projectiles). Infinity for persistent. */
  ttl: number;

  // Combat-capable kinds:
  hp: number;
  maxHp: number;
  team?: Team;

  // Enemy archetype reference:
  defId?: string;

  // AI memory (enemies):
  ai?: AiMemory;

  // NPC:
  npcDefId?: string;
  homePos?: Vec2;
  talkCooldown?: number;

  // Items / containers:
  itemId?: string;
  quantity?: number;
  lootTableId?: string;
  opened?: boolean;

  // Projectile:
  ownerId?: number;
  damage?: number;
  pierce?: number;

  // FX:
  fxKind?: string;
  text?: string;
  color?: string;

  // Telegraph/windup timer used by charging/melee enemies:
  windupTimer?: number;
  attackTimer?: number;

  // Player action timers (seconds):
  playerTimers?: {
    attackCooldown: number;
    dodgeTimeLeft: number;
    dodgeCooldown: number;
    iframes: number;
    stamina: number;
    dodgeDirX: number;
    dodgeDirY: number;
    interactLock: number;
  };

  bobPhase?: number;
}

export interface AiMemory {
  state: "idle" | "patrol" | "chase" | "attack" | "investigate" | "windup" | "charge" | "flee" | "strafe";
  targetPos: Vec2 | null;
  lastSeenPlayerAt: number | null;
  alertness: number;
  path: Array<{ x: number; y: number }> | null;
  repathTimer: number;
  patrolTarget: Vec2 | null;
  strafeDir: number;
  chargeVec: Vec2 | null;
  chargeTimeLeft: number;
}

export interface ItemStack {
  itemId: string;
  qty: number;
}

export interface Equipment {
  weapon: string | null;
  armor: string | null;
  relics: string[];
}

export interface QuestObjective {
  kind: "slay" | "collect" | "explore";
  /** enemy archetype id for slay, item id for collect, room-count for explore. */
  targetRef: string;
  needed: number;
  progress: number;
}

export interface QuestInstance {
  id: string;
  templateId: string;
  title: string;
  giverEntityId: number;
  depth: number;
  objectives: QuestObjective[];
  rewardGold: number;
  rewardXp: number;
  rewardItemId?: string;
  offerText: string;
  completeText: string;
  status: "offered" | "active" | "readyTurnIn" | "done";
}

export interface Dialogue {
  npcEntityId: number;
  speakerName: string;
  line: string;
  /** Actions available in this dialogue context. */
  canAcceptQuestIds: string[];
  canTurnInQuestIds: string[];
  canShop: boolean;
}

export type RunStatus = "playing" | "dead" | "victory";

export interface RunStats {
  killsByType: Record<string, number>;
  totalKills: number;
  damageDealt: number;
  damageTaken: number;
  goldEarned: number;
  chestsOpened: number;
  questsCompleted: number;
  deathsCausedByCause: Record<string, number>;
}

export interface SimState {
  packVersion: string;
  seed: number;
  tick: number;
  timeSec: number;
  status: RunStatus;

  depth: number;
  floorName: string;
  map: GameMap;
  entities: Map<number, Entity>;
  nextEntityId: number;
  playerId: number;

  level: number;
  xp: number;
  gold: number;

  inventory: ItemStack[];
  equipment: Equipment;

  quests: QuestInstance[];

  dialogue: Dialogue | null;

  keyCollected: boolean;
  exitUnlocked: boolean;
  /** Static decor for the current floor. */
  floorDecor: { torches: Vec2[] };

  /** Room ids visited this floor (for explore quests + QA). */
  visitedRoomIds: number[];

  /** Per-NPC shop stock for the current floor: npcEntityId -> item ids. */
  shopStocks: Record<string, string[]>;

  /** Cause of the latest damage taken ("slime", "arrow", ...). */
  lastDamageSource: string;

  /** RNG stream states (uint32) for full determinism of save/replay. */
  rngStates: { combat: number; loot: number; ai: number; misc: number };

  stats: RunStats;

  /** QA/debug ring buffer of notable events (bounded). */
  recentEvents: Array<{ t: number; kind: string; detail?: string }>;

  /** Set when a fatal invariant violation occurs (should never happen; QA watches this). */
  fatalError: string | null;
}

export const INVENTORY_CAPACITY = 12;
export const MAX_RELIC_SLOTS = 2;
