/**
 * Simulation — the deterministic game core.
 *
 * Driven identically by the browser client and by headless QA bots:
 *   sim.step(frameInput) advances exactly one 1/60s tick.
 *   Discrete interactions (quests, shops, potions) are explicit methods so
 *   both humans (UI buttons) and bots (scripted calls) share one API.
 *
 * Determinism: all randomness flows through four seeded streams whose states
 * live in SimState; save/restore and input-script replays reproduce runs
 * bit-exactly.
 */
import { Rng } from "../core/rng.js";
import { clamp, vdist, vlen, vnorm, vsub } from "../core/math.js";
import type { Vec2 } from "../core/math.js";
import { fnv1a } from "../core/hash.js";
import { GameMap } from "../world/map.js";
import { generateFloor } from "../world/procgen.js";
import type { GeneratedFloor } from "../world/procgen.js";
import type { ContentPack, EnemyDef, FloorConfig } from "../content/types.js";
import { validateContentPack } from "../content/types.js";
import {
  INVENTORY_CAPACITY,
} from "./state.js";
import type { Entity, QuestInstance, SimState } from "./state.js";
import { makeEntity, logEvent } from "./factory.js";
import { addItem, countItem, equipItem, itemDef } from "./inventory.js";
import { computePlayerStats, grantXp } from "./progression.js";
import { rollDamage, inMeleeArc } from "./combat.js";
import { initEnemyMemory, updateEnemies, updateNpc } from "./ai.js";
import type { NoiseEvent } from "./ai.js";
import { createQuestsForFloor, onEnemyKilled, onItemPickedUp, onRoomVisited, turnInQuest } from "./quests.js";
import { gameBus } from "./game-events.js";

export const FIXED_DT = 1 / 60;
export const SAVE_MAGIC = "EMBERFALL-SAVE";
export const SAVE_VERSION = 3;

export interface FrameInput {
  moveX: number;
  moveY: number;
  /** Optional aim override (unit or arbitrary vector); facing follows it when present. */
  aimX?: number;
  aimY?: number;
  attackHeld: boolean;
  dodgePressed: boolean;
  interactPressed: boolean;
}

export function emptyInput(): FrameInput {
  return { moveX: 0, moveY: 0, attackHeld: false, dodgePressed: false, interactPressed: false };
}

interface PrevInput {
  attackHeld: boolean;
  dodgePressed: boolean;
  interactPressed: boolean;
}

export class Simulation {
  readonly pack: ContentPack;
  state!: SimState;

  readonly rngCombat = new Rng(0);
  readonly rngLoot = new Rng(0);
  readonly rngAi = new Rng(0);
  readonly rngMisc = new Rng(0);

  private pendingNoises: NoiseEvent[] = [];
  private prevInput: PrevInput = { attackHeld: false, dodgePressed: false, interactPressed: false };
  private currentRoomId: number | null = null;

  constructor(pack: ContentPack, seed: number) {
    const problems = validateContentPack(pack);
    if (problems.length > 0) {
      throw new Error(`Cannot start simulation with invalid content pack:\n - ${problems.join("\n - ")}`);
    }
    this.pack = pack;
    this.initState(pack, seed);
    this.loadFloor(1);
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  private initState(pack: ContentPack, seed: number): void {
    this.state = {
      packVersion: pack.meta.version,
      seed,
      tick: 0,
      timeSec: 0,
      status: "playing",
      depth: 0,
      floorName: "",
      map: new GameMap(1, 1),
      entities: new Map(),
      nextEntityId: 1,
      playerId: 0,
      level: 1,
      xp: 0,
      gold: pack.systems.startingGold,
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
    // Derive stream seeds from master seed.
    this.rngCombat.setState(new Rng(seed ^ 0x11111111).getState());
    this.rngLoot.setState(new Rng(seed ^ 0x22222222).getState());
    this.rngAi.setState(new Rng(seed ^ 0x33333333).getState());
    this.rngMisc.setState(new Rng(seed ^ 0x44444444).getState());
  }

  /** Build a fresh floor and populate it. */
  loadFloor(depth: number): void {
    const pack = this.pack;
    const cfg = pack.floors.find((f) => f.depth === depth);
    if (!cfg) throw new Error(`No FloorConfig for depth ${depth}`);

    const generated: GeneratedFloor = generateFloor(pack, cfg, this.state.seed + depth * 7919);
    const s = this.state;

    // Carry player HP across floors.
    const prevPlayer = s.entities.get(s.playerId);
    const carriedHp = prevPlayer ? prevPlayer.hp : 0;

    s.depth = depth;
    s.floorName = generated.floorName;
    s.map = generated.map;
    s.entities.clear();
    s.nextEntityId = 1;
    // Abandon unfinished quests from previous floors explicitly.
    for (const q of s.quests) {
      if (q.status === "offered" || q.status === "active" || q.status === "readyTurnIn") {
        logEvent(s, "questExpired", `${q.title} (left behind on depth ${q.depth})`);
      }
    }
    s.quests.length = 0;
    s.visitedRoomIds.length = 0;
    s.shopStocks = {};
    s.dialogue = null;
    this.currentRoomId = null;

    const sp = generated.spawns;
    s.floorDecor = { torches: sp.torches.map((t) => ({ x: t.x, y: t.y })) };

    // Player persists across floors; recreate entity each floor.
    const player = makeEntity(s, "player", sp.playerStart, 0.36);
    player.team = "player";
    const stats = computePlayerStats(s, pack);
    player.maxHp = stats.maxHp;
    player.hp = depth === 1 ? stats.maxHp : Math.min(stats.maxHp, carriedHp + Math.round(stats.maxHp * 0.25));
    player.playerTimers = {
      attackCooldown: 0,
      dodgeTimeLeft: 0,
      dodgeCooldown: 0,
      iframes: 1,
      stamina: pack.systems.player.staminaMax,
      dodgeDirX: 1,
      dodgeDirY: 0,
      interactLock: 0,
    };
    s.playerId = player.id;

    // Exit portal.
    const portal = makeEntity(s, "portal", sp.exitPos, 0.55);
    portal.color = "#7fd7ff";

    // Key.
    if (sp.keyPos) {
      const key = makeEntity(s, "key", sp.keyPos, 0.3);
      key.itemId = `key-d${depth}`;
      s.keyCollected = false;
      s.exitUnlocked = false;
    } else {
      s.keyCollected = true;
      s.exitUnlocked = !cfg.bossId ? true : false;
    }

    // Shrine.
    if (sp.shrinePos) {
      const shrine = makeEntity(s, "shrine", sp.shrinePos, 0.45);
      shrine.opened = false;
    }

    // Chests.
    for (const c of sp.chests) {
      const chest = makeEntity(s, "chest", c.pos, 0.4);
      chest.lootTableId = c.lootTableId;
      chest.opened = false;
    }

    // Enemies.
    for (const es of sp.enemies) {
      const def = this.enemyDef(es.enemyId);
      if (!def) continue;
      this.spawnEnemy(def, es.pos);
    }

    // Boss.
    if (sp.boss) {
      const bdef = this.enemyDef(sp.boss.enemyId);
      if (bdef) {
        const boss = this.spawnEnemy(bdef, sp.boss.pos);
        boss.radius = Math.min(0.8, boss.radius * 1.6);
        boss.maxHp = Math.round(boss.maxHp * 2.2);
        boss.hp = boss.maxHp;
      }
    }

    // NPCs (+ shop stock).
    const questAssignments: Array<{ entityId: number; questIds: string[] }> = [];
    for (const ns of sp.npcs) {
      const ndef = pack.npcDefs.find((n) => n.id === ns.npcDefId);
      if (!ndef) continue;
      const npc = makeEntity(s, "npc", ns.pos, 0.34);
      npc.npcDefId = ndef.id;
      npc.homePos = { x: ns.pos.x, y: ns.pos.y };
      npc.talkCooldown = 0;
      npc.color = ndef.color;
      if (ndef.role === "merchant") {
        s.shopStocks[String(npc.id)] = this.rollShopStock();
      }
      questAssignments.push({ entityId: npc.id, questIds: ns.questIds });
    }
    createQuestsForFloor(this, questAssignments, depth, this.state.seed ^ (depth << 8));

    // Props (blocking clutter).
    for (const p of sp.props) {
      const prop = makeEntity(s, "prop", p.pos, 0.32);
      prop.itemId = p.kind; // reuse field as visual kind
    }

    logEvent(s, "floorEnter", `depth ${depth}: ${generated.floorName}`);
    gameBus.emit("descend", { depth });

    // Sync RNG states into snapshot-able store.
    this.syncRngStates();
  }

  private spawnEnemy(def: EnemyDef, pos: Vec2): Entity {
    const e = makeEntity(this.state, "enemy", pos, def.radius);
    e.defId = def.id;
    e.hp = def.hp;
    e.maxHp = def.hp;
    e.team = "hostile";
    e.ai = initEnemyMemory();
    e.attackTimer = 0;
    e.bobPhase = this.rngMisc.next() * Math.PI * 2;

    // Elite roll (never on bosses).
    const cfg = this.floorConfig(this.state.depth);
    const eliteChance = cfg?.eliteChance ?? 0;
    if (eliteChance > 0 && this.rngMisc.next() < eliteChance && packEliteAffixes(this.pack).length > 0) {
      const affixes = packEliteAffixes(this.pack);
      const affix = affixes[this.rngMisc.int(0, affixes.length)]!;
      e.maxHp = Math.max(1, Math.round(e.maxHp * affix.hpMult));
      e.hp = e.maxHp;
      e.radius = Math.min(0.7, e.radius * 1.15);
      e.eliteAffixId = affix.id;
      gameBus.emit("eliteSeen", { affixId: affix.id });
    }
    return e;
  }

  enemyDef(id: string): EnemyDef | undefined {
    return this.pack.enemies.find((e) => e.id === id);
  }

  /** Damage multiplier for an enemy (elites scale up). */
  eliteDmgMult(e: Entity): number {
    if (!e.eliteAffixId) return 1;
    return this.pack.eliteAffixes?.find((a) => a.id === e.eliteAffixId)?.dmgMult ?? 1;
  }

  /** Display label for damage attribution. */
  eliteLabel(e: Entity, baseName: string): string {
    if (!e.eliteAffixId) return baseName;
    const affix = this.pack.eliteAffixes?.find((a) => a.id === e.eliteAffixId);
    return affix ? `${affix.name} ${baseName}` : baseName;
  }

  floorConfig(depth: number): FloorConfig | undefined {
    return this.pack.floors.find((f) => f.depth === depth);
  }

  private rollShopStock(): string[] {
    const pool = this.pack.items.filter((i) => i.kind !== "quest");
    const stock: string[] = [];
    // Shops ALWAYS carry the cheapest potion — potions are the economy's
    // backbone and QA treats their absence as a coverage gap.
    const cheapestPotion = [...pool]
      .filter((i) => i.kind === "potion")
      .sort((a, b) => a.value - b.value)[0];
    if (cheapestPotion) stock.push(cheapestPotion.id);
    const rest = pool.filter((i) => !stock.includes(i.id));
    const n = this.rngMisc.intInclusive(3, 5);
    for (let i = 0; i < n && rest.length > 0; i++) {
      const pick = this.rngMisc.int(0, rest.length);
      stock.push(rest[pick]!.id);
      rest.splice(pick, 1);
    }
    return stock;
  }

  // -------------------------------------------------------------------------
  // Main step
  // -------------------------------------------------------------------------

  step(input: FrameInput): void {
    const s = this.state;
    if (s.status !== "playing") return;
    try {
      s.tick++;
      s.timeSec += FIXED_DT;

      this.updatePlayer(input);
      updateEnemies(this, this.pendingNoises, FIXED_DT);
      for (const e of s.entities.values()) {
        if (e.kind === "npc" && !e.dead) updateNpc(this, e, FIXED_DT);
      }
      this.pendingNoises.length = 0;

      this.integrateEntities();
      this.updateProjectiles();
      this.updatePickupsAndInteractables(input);
      this.cleanupDead();
      this.syncRngStates();

      if (Number.isNaN(s.timeSec)) {
        s.fatalError = "timeSec became NaN";
        s.status = "dead";
        logEvent(s, "fatal", s.fatalError);
      }
    } catch (err) {
      s.fatalError = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      s.status = "dead";
      logEvent(s, "fatal", s.fatalError.slice(0, 200));
    }
  }

  private updatePlayer(input: FrameInput): void {
    const s = this.state;
    const p = s.entities.get(s.playerId);
    if (!p || !p.playerTimers) return;
    const pt = p.playerTimers;
    const t = this.pack.systems.player;
    const stats = computePlayerStats(s, this.pack);

    // Timers.
    pt.attackCooldown = Math.max(0, pt.attackCooldown - FIXED_DT);
    pt.dodgeCooldown = Math.max(0, pt.dodgeCooldown - FIXED_DT);
    pt.iframes = Math.max(0, pt.iframes - FIXED_DT);
    pt.interactLock = Math.max(0, pt.interactLock - FIXED_DT);
    pt.stamina = Math.min(t.staminaMax, pt.stamina + t.staminaRegenPerSec * FIXED_DT);

    // Dialogue closes when walking away.
    if (s.dialogue) {
      const npc = s.entities.get(s.dialogue.npcEntityId);
      if (!npc || vdist(npc.pos, p.pos) > t.interactRadius * 1.8) s.dialogue = null;
    }

    const moveX = clamp(input.moveX, -1, 1);
    const moveY = clamp(input.moveY, -1, 1);
    const moving = moveX !== 0 || moveY !== 0;
    const dir = moving ? vnorm({ x: moveX, y: moveY }) : { x: 0, y: 0 };

    // Aim: explicit aim vector wins; otherwise face movement direction.
    const hasAim =
      input.aimX !== undefined && input.aimY !== undefined &&
      (input.aimX !== 0 || input.aimY !== 0);
    if (hasAim) {
      p.facing = Math.atan2(input.aimY!, input.aimX!);
    } else if (moving) {
      p.facing = Math.atan2(dir.y, dir.x);
    }

    // Dodge.
    const dodging = pt.dodgeTimeLeft > 0;
    if (input.dodgePressed && !this.prevInput.dodgePressed && !dodging && pt.dodgeCooldown <= 0 && pt.stamina >= t.dodgeStaminaCost) {
      pt.dodgeTimeLeft = t.dodgeDurationSec;
      pt.dodgeCooldown = t.dodgeDurationSec + t.dodgeCooldownSec;
      pt.stamina -= t.dodgeStaminaCost;
      const ddir = moving ? dir : { x: Math.cos(p.facing), y: Math.sin(p.facing) };
      pt.dodgeDirX = ddir.x;
      pt.dodgeDirY = ddir.y;
      this.emitNoise(p.pos.x, p.pos.y, 3.5);
      gameBus.emit("dodge", { x: p.pos.x, y: p.pos.y });
    }

    let speed = stats.speed;
    if (pt.dodgeTimeLeft > 0) {
      pt.dodgeTimeLeft -= FIXED_DT;
      speed *= t.dodgeSpeedMult;
      p.vel.x = pt.dodgeDirX * speed;
      p.vel.y = pt.dodgeDirY * speed;
    } else if (moving) {
      p.vel.x = dir.x * speed;
      p.vel.y = dir.y * speed;
    } else {
      p.vel.x *= 0.55;
      p.vel.y *= 0.55;
    }

    // Attack (edge-triggered).
    if (input.attackHeld && !this.prevInput.attackHeld && pt.attackCooldown <= 0 && pt.dodgeTimeLeft <= 0) {
      pt.attackCooldown = this.weaponAttackCooldown();
      this.playerSwing(p, stats.damage);
    }

    // Interact (edge-triggered).
    if (input.interactPressed && !this.prevInput.interactPressed && pt.interactLock <= 0) {
      this.tryInteractNearest(p);
    }

    this.prevInput.attackHeld = input.attackHeld;
    this.prevInput.dodgePressed = input.dodgePressed;
    this.prevInput.interactPressed = input.interactPressed;
  }

  private weaponAttackCooldown(): number {
    const w = this.state.equipment.weapon ? itemDef(this.pack, this.state.equipment.weapon) : undefined;
    return w?.attackSpeed ?? this.pack.systems.player.attackCooldownSec;
  }

  private playerSwing(p: Entity, baseDamage: number): void {
    const s = this.state;
    const t = this.pack.systems.player;
    this.emitNoise(p.pos.x, p.pos.y, 5);
    gameBus.emit("swing", { x: p.pos.x, y: p.pos.y, angle: p.facing });

    for (const e of s.entities.values()) {
      if (e.kind !== "enemy" || e.dead) continue;
      if (!inMeleeArc(p.pos, p.facing, t.attackRange, t.attackArcDeg, e.pos)) continue;
      const roll = rollDamage(this.rngCombat, baseDamage, 0, t.damageVariancePct / 100, computePlayerStats(s, this.pack).critChance, t.critMultiplier);
      this.damageEnemy(e, roll.amount, roll.crit);
    }
  }

  private damageEnemy(e: Entity, amount: number, crit: boolean): void {
    const s = this.state;
    e.hp -= amount;
    s.stats.damageDealt += amount;
    // Knockback away from player.
    const player = s.entities.get(s.playerId)!;
    const kb = vnorm(vsub(e.pos, player.pos));
    e.vel.x += kb.x * this.pack.systems.player.knockbackForce;
    e.vel.y += kb.y * this.pack.systems.player.knockbackForce;

    if (e.hp <= 0 && !e.dead) {
      e.dead = true;
      this.onEnemyDeath(e);
    }
    const killed = e.hp <= 0;
    gameBus.emit("hit", {
      x: e.pos.x, y: e.pos.y, amount, crit, targetId: e.id, killed,
    });
    if (killed) {
      const def = this.enemyDef(e.defId!)!;
      gameBus.emit("kill", { enemyId: def.id, x: e.pos.x, y: e.pos.y });
    }
  }

  private onEnemyDeath(e: Entity): void {
    const s = this.state;
    const def = this.enemyDef(e.defId!)!;
    s.stats.totalKills++;
    s.stats.killsByType[def.id] = (s.stats.killsByType[def.id] ?? 0) + 1;

    // Gold drop.
    const affix = e.eliteAffixId ? this.pack.eliteAffixes?.find((a) => a.id === e.eliteAffixId) : undefined;
    const rewardMult = affix?.rewardMult ?? 1;
    const goldAmount = Math.round(this.rngLoot.intInclusive(def.goldDropMin, def.goldDropMax) * rewardMult);
    if (goldAmount > 0) {
      const g = makeEntity(s, "gold", e.pos, 0.22);
      g.quantity = goldAmount;
      g.ttl = 60;
    }

    // Item drop chance via loot table.
    const table = this.pack.lootTables.find((lt) => lt.id === "enemy-default");
    if (table && this.rngLoot.chance(0.28)) {
      const itemId = this.rollLoot(table.id);
      if (itemId) {
        const drop = makeEntity(s, "itemDrop", jitter(e.pos, this.rngLoot, 0.5), 0.26);
        drop.itemId = itemId;
        drop.quantity = 1;
        drop.ttl = 120;
      }
    }

    grantXp(s, this.pack, Math.round(def.xpReward * rewardMult));
    onEnemyKilled(this, def.id);

    // Boss death unlocks the portal.
    const cfg = this.floorConfig(s.depth);
    if (cfg?.bossId === def.id) {
      s.exitUnlocked = true;
      logEvent(s, "bossDown", def.name);
    }
  }

  rollLoot(tableId: string): string | null {
    const table = this.pack.lootTables.find((lt) => lt.id === tableId);
    if (!table || table.entries.length === 0) return null;
    const total = table.entries.reduce((sum, en) => sum + en.weight, 0);
    let roll = this.rngLoot.next() * total;
    for (const entry of table.entries) {
      roll -= entry.weight;
      if (roll <= 0) return entry.itemId;
    }
    return table.entries[table.entries.length - 1]!.itemId;
  }

  damagePlayer(rawAmount: number, sourceName: string): void {
    const s = this.state;
    const p = s.entities.get(s.playerId);
    if (!p || !p.playerTimers) return;
    const pt = p.playerTimers;
    if (pt.iframes > 0 || pt.dodgeTimeLeft > 0) return;

    const stats = computePlayerStats(s, this.pack);
    const dmg = Math.max(1, Math.round(rawAmount - stats.defense));
    p.hp -= dmg;
    s.stats.damageTaken += dmg;
    s.lastDamageSource = sourceName;
    pt.iframes = this.pack.systems.player.iframesAfterHitSec;
    gameBus.emit("hurt", { amount: dmg, hpLeft: p.hp });
    logEvent(s, "playerHurt", `${sourceName} -${dmg}`);

    if (p.hp <= 0) {
      p.hp = 0;
      s.status = "dead";
      s.stats.deathsCausedByCause[sourceName] = (s.stats.deathsCausedByCause[sourceName] ?? 0) + 1;
      gameBus.emit("death", { cause: sourceName });
      logEvent(s, "playerDied", sourceName);
    }
  }

  spawnEnemyProjectile(owner: Entity, dir: Vec2, damage: number, speed: number): void {
    const s = this.state;
    const proj = makeEntity(s, "projectile", owner.pos, 0.14);
    proj.ownerId = owner.id;
    proj.vel.x = dir.x * speed;
    proj.vel.y = dir.y * speed;
    proj.damage = damage;
    proj.ttl = 3;
    proj.team = "hostile";
    this.emitNoise(owner.pos.x, owner.pos.y, 4);
  }

  giveItem(itemId: string, qty: number): number {
    const def = itemDef(this.pack, itemId);
    if (!def) return 0;
    const added = addItem(this.state, itemId, qty, def.stackable);
    if (added > 0) onItemPickedUp(this, itemId);
    return added;
  }

  markEnemyMoved(_e: Entity): void {
    // Hook reserved for perf instrumentation; intentionally cheap.
  }

  emitNoise(x: number, y: number, radius: number): void {
    this.pendingNoises.push({ x, y, radius });
  }

  private syncRngStates(): void {
    const s = this.state;
    s.rngStates.combat = this.rngCombat.getState();
    s.rngStates.loot = this.rngLoot.getState();
    s.rngStates.ai = this.rngAi.getState();
    s.rngStates.misc = this.rngMisc.getState();
  }

  // -------------------------------------------------------------------------
  // Physics
  // -------------------------------------------------------------------------

  private integrateEntities(): void {
    const s = this.state;
    const map = s.map;

    for (const e of s.entities.values()) {
      if (e.kind === "fx") continue;
      e.age += FIXED_DT;
      // Friction toward zero for knockback decay (non-player, non-AI-driven handled per system).
      if (e.kind === "enemy" && vlen(e.vel) > 12) {
        e.vel.x *= 0.86;
        e.vel.y *= 0.86;
      }
      if (e.kind === "npc" || e.kind === "prop") {
        e.vel.x *= 0.85;
        e.vel.y *= 0.85;
      }

      const dx = e.vel.x * FIXED_DT;
      const dy = e.vel.y * FIXED_DT;
      // Axis-separated movement with wall clamping.
      const r = e.radius;
      let nx = e.pos.x + dx;
      if (!this.circleFree(nx, e.pos.y, r)) nx = e.pos.x;
      let ny = e.pos.y + dy;
      if (!this.circleFree(nx, ny, r)) ny = e.pos.y;
      e.pos.x = clamp(nx, r, map.width - r);
      e.pos.y = clamp(ny, r, map.height - r);
    }

    this.separateEntities();
  }

  circleFree(x: number, y: number, r: number): boolean {
    const map = this.state.map;
    const minX = Math.floor(x - r);
    const maxX = Math.floor(x + r);
    const minY = Math.floor(y - r);
    const maxY = Math.floor(y + r);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (!map.inBounds(tx, ty)) return false;
        if (map.isWalkable(tx, ty)) continue;
        // Precise circle-vs-tile test.
        const cx = clamp(x, tx, tx + 1);
        const cy = clamp(y, ty, ty + 1);
        const ddx = x - cx;
        const ddy = y - cy;
        if (ddx * ddx + ddy * ddy < r * r) return false;
      }
    }
    return true;
  }

  private separateEntities(): void {
    const s = this.state;
    const solids: Entity[] = [];
    for (const e of s.entities.values()) {
      if (e.dead) continue;
      if (e.kind === "player" || e.kind === "enemy" || e.kind === "npc" || e.kind === "prop") solids.push(e);
    }
    // Snapshot positions so we can revert any push that would embed an entity
    // in a wall (separation must never violate geometry).
    const before = solids.map((e) => ({ x: e.pos.x, y: e.pos.y }));
    // O(n^2) with early distance rejection is fine at our scale (<150 solids),
    // and avoids spatial-grid rebuild cost every tick.
    for (let i = 0; i < solids.length; i++) {
      const a = solids[i]!;
      for (let j = i + 1; j < solids.length; j++) {
        const b = solids[j]!;
        const minDist = a.radius + b.radius;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = (minDist - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        // Props are immovable: full push to the other party.
        if (a.kind === "prop" && b.kind !== "prop") {
          b.pos.x += ux * push * 2;
          b.pos.y += uy * push * 2;
        } else if (b.kind === "prop" && a.kind !== "prop") {
          a.pos.x -= ux * push * 2;
          a.pos.y -= uy * push * 2;
        } else {
          a.pos.x -= ux * push;
          a.pos.y -= uy * push;
          b.pos.x += ux * push;
          b.pos.y += uy * push;
        }
      }
    }
    // Revert illegal results.
    for (let i = 0; i < solids.length; i++) {
      const e = solids[i]!;
      if (!this.circleFree(e.pos.x, e.pos.y, e.radius)) {
        e.pos.x = before[i]!.x;
        e.pos.y = before[i]!.y;
      }
    }
  }

  private updateProjectiles(): void {
    const s = this.state;
    for (const e of s.entities.values()) {
      if (e.kind !== "projectile" || e.dead) continue;
      e.pos.x += e.vel.x * FIXED_DT;
      e.pos.y += e.vel.y * FIXED_DT;
      e.ttl -= FIXED_DT;
      if (e.ttl <= 0 || !this.circleFree(e.pos.x, e.pos.y, e.radius)) {
        e.dead = true;
        continue;
      }
      const player = s.entities.get(s.playerId);
      if (player && vdist(e.pos, player.pos) <= e.radius + player.radius) {
        this.damagePlayer(e.damage ?? 1, "arrow");
        e.dead = true;
      }
    }
  }

  private updatePickupsAndInteractables(input: FrameInput): void {
    void input;
    const s = this.state;
    const player = s.entities.get(s.playerId);
    if (!player) return;
    const pickupR = this.pack.systems.player.pickupRadius;

    for (const e of s.entities.values()) {
      if (e.dead) continue;
      const d = vdist(e.pos, player.pos);

      switch (e.kind) {
        case "gold": {
          if (d <= 0.85) {
            const amt = Math.round(e.quantity! * computePlayerStats(s, this.pack).goldMult);
            s.gold += amt;
            s.stats.goldEarned += amt;
            e.dead = true;
            gameBus.emit("gold", { amount: amt });
          }
          break;
        }
        case "itemDrop": {
          if (d <= pickupR) {
            const def = itemDef(this.pack, e.itemId!);
            if (def) {
              const added = this.giveItem(e.itemId!, e.quantity ?? 1);
              if (added > 0) {
                e.dead = true;
                gameBus.emit("pickup", { itemId: e.itemId!, name: def.name, quantity: added });
                logEvent(s, "pickup", def.name);
              }
            }
          }
          break;
        }
        case "key": {
          if (d <= pickupR) {
            e.dead = true;
            s.keyCollected = true;
            const cfg = this.floorConfig(s.depth);
            if (!cfg?.bossId || this.bossDead()) s.exitUnlocked = true;
            gameBus.emit("keyFound", { name: "Depth Key" });
            logEvent(s, "keyFound");
          }
          break;
        }
      }
    }

    // Room visit tracking (explore quests).
    const roomId = this.roomAt(player.pos);
    if (roomId !== null && roomId !== this.currentRoomId) {
      this.currentRoomId = roomId;
      onRoomVisited(this, roomId);
    }
  }

  roomAt(pos: Vec2): number | null {
    for (const r of this.state.map.rooms) {
      if (pos.x >= r.x && pos.x < r.x + r.w && pos.y >= r.y && pos.y < r.y + r.h) return r.id;
    }
    return null;
  }

  private bossDead(): boolean {
    const cfg = this.floorConfig(this.state.depth);
    if (!cfg?.bossId) return true;
    for (const e of this.state.entities.values()) {
      if (e.kind === "enemy" && !e.dead && e.defId === cfg.bossId) return false;
    }
    return true;
  }

  private cleanupDead(): void {
    const s = this.state;
    for (const [id, e] of s.entities) {
      if (e.dead && e.kind !== "player") {
        s.entities.delete(id);
        continue;
      }
      // Player is exempt from TTL expiry — a corrupted save must never be
      // able to delete the player via this path.
      if (e.ttl !== Infinity && e.kind !== "player") {
        e.ttl -= FIXED_DT;
        if (e.ttl <= 0) s.entities.delete(id);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------

  private tryInteractNearest(player: Entity): void {
    const s = this.state;
    const t = this.pack.systems.player.interactRadius;

    let best: Entity | null = null;
    let bestD = Infinity;
    for (const e of s.entities.values()) {
      if (e.dead) continue;
      if (e.kind !== "npc" && e.kind !== "chest" && e.kind !== "portal" && e.kind !== "shrine") continue;
      const d = vdist(e.pos, player.pos);
      if (d <= t && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    if (!best) return;

    switch (best.kind) {
      case "npc":
        this.openDialogue(best);
        break;
      case "chest":
        this.openChest(best);
        break;
      case "portal":
        this.usePortal(best);
        break;
      case "shrine":
        this.useShrine(best);
        break;
    }
  }

  private openDialogue(npc: Entity): void {
    const s = this.state;
    const ndef = this.pack.npcDefs.find((n) => n.id === npc.npcDefId!);
    if (!ndef) return;

    const offered = s.quests.filter((q) => q.giverEntityId === npc.id && q.status === "offered");
    const ready = s.quests.filter((q) => q.giverEntityId === npc.id && q.status === "readyTurnIn");

    let line: string;
    if (ready.length > 0) line = ready[0]!.completeText;
    else if (offered.length > 0) line = offered[0]!.offerText;
    else line = ndef.idleLines.length > 0 ? ndef.idleLines[s.tick % ndef.idleLines.length] : "...";

    s.dialogue = {
      npcEntityId: npc.id,
      speakerName: ndef.firstNamePool[0]!,
      line,
      canAcceptQuestIds: offered.map((q) => q.id),
      canTurnInQuestIds: ready.map((q) => q.id),
      canShop: ndef.role === "merchant",
    };
    gameBus.emit("npcTalk", { line });
  }

  acceptQuest(questId: string): boolean {
    const q = this.state.quests.find((x) => x.id === questId && x.status === "offered");
    if (!q) return false;
    q.status = "active";
    this.spawnCollectQuestGuarantees(q);
    gameBus.emit("questAccepted", { questId: q.templateId, title: q.title });
    logEvent(this.state, "questAccept", q.title);
    return true;
  }

  /**
   * Collect objectives are guaranteed completable: accepting the quest spawns
   * the deficit of target items in reachable spots across the floor.
   * (Pickup progress is lifetime-based, so these directly complete it.)
   */
  private spawnCollectQuestGuarantees(q: QuestInstance): void {
    const s = this.state;
    for (const o of q.objectives) {
      if (o.kind !== "collect") continue;
      const deficit = o.needed - o.progress;
      const itemDefFound = this.pack.items.find((i) => i.id === o.targetRef);
      if (!itemDefFound || deficit <= 0) continue;

      // Candidate tiles: room-interior walkable tiles away from player.
      const player = s.entities.get(s.playerId);
      const candidates: Vec2[] = [];
      for (const room of s.map.rooms) {
        for (let t = 0; t < 6; t++) {
          const x = room.x + 1 + Math.floor(this.rngMisc.next() * Math.max(1, room.w - 2));
          const y = room.y + 1 + Math.floor(this.rngMisc.next() * Math.max(1, room.h - 2));
          if (!s.map.isWalkable(x, y)) continue;
          const p = { x: x + 0.5, y: y + 0.5 };
          if (player && vdist(p, player.pos) < 8) continue;
          candidates.push(p);
        }
      }
      this.rngMisc.shuffle(candidates);
      for (let i = 0; i < deficit && candidates.length > 0; i++) {
        const pos = candidates.pop()!;
        const drop = makeEntity(s, "itemDrop", pos, 0.26);
        drop.itemId = o.targetRef;
        drop.quantity = 1;
        drop.ttl = Infinity;
        drop.color = "#ffd700"; // quest glint
        logEvent(s, "questItemSpawned", `${o.targetRef} at (${pos.x.toFixed(1)},${pos.y.toFixed(1)})`);
      }
    }
  }

  turnInQuestById(questId: string): boolean {
    const msg = turnInQuest(this, questId);
    if (!msg) return false;
    const q = this.state.quests.find((x) => x.id === questId)!;
    gameBus.emit("questCompleted", { questId: q.templateId, title: q.title });
    logEvent(this.state, "questDone", q.title);
    return true;
  }

  shopStock(npcEntityId: number): string[] {
    return this.state.shopStocks[String(npcEntityId)] ?? [];
  }

  buyItem(npcEntityId: number, itemId: string): "ok" | "no-gold" | "no-space" | "not-in-stock" {
    const s = this.state;
    const stock = s.shopStocks[String(npcEntityId)];
    if (!stock || !stock.includes(itemId)) return "not-in-stock";
    const def = itemDef(this.pack, itemId);
    if (!def) return "not-in-stock";
    const price = this.priceOf(def.value);
    if (s.gold < price) return "no-gold";

    // Reserve check before charging gold.
    const probeLen = s.inventory.reduce((acc, st) => acc + (st.itemId === itemId && def.stackable ? 0 : 1), 0);
    const hasStackableSpace = def.stackable && s.inventory.some((st) => st.itemId === itemId && st.qty < 99);
    if (!(hasStackableSpace || probeLen < INVENTORY_CAPACITY)) return "no-space";

    s.gold -= price;
    stock.splice(stock.indexOf(itemId), 1);
    this.giveItem(itemId, 1);
    gameBus.emit("buy", { itemId, price });
    logEvent(s, "buy", `${itemId} for ${price}`);
    return "ok";
  }

  priceOf(baseValue: number): number {
    const v = this.pack.systems.priceVariancePct / 100;
    return Math.round(baseValue * (1 + v));
  }

  sellPrice(baseValue: number): number {
    return Math.max(1, Math.floor(baseValue * 0.4));
  }

  sellItem(itemId: string): "ok" | "not-owned" | "equipped" {
    const s = this.state;
    if (s.equipment.weapon === itemId || s.equipment.armor === itemId || s.equipment.relics.includes(itemId)) {
      return "equipped";
    }
    const def = itemDef(this.pack, itemId);
    if (!def || !countItem(s, itemId)) return "not-owned";
    const ok = (() => {
      for (let i = s.inventory.length - 1; i >= 0; i--) {
        const st = s.inventory[i]!;
        if (st.itemId === itemId) {
          st.qty--;
          if (st.qty === 0) s.inventory.splice(i, 1);
          return true;
        }
      }
      return false;
    })();
    if (!ok) return "not-owned";
    const gain = this.sellPrice(def.value);
    s.gold += gain;
    s.stats.goldEarned += gain;
    logEvent(s, "sell", `${itemId} +${gain}`);
    return "ok";
  }

  usePotion(): "ok" | "none" | "full-hp" {
    const s = this.state;
    const p = s.entities.get(s.playerId);
    if (!p) return "none";
    const idx = s.inventory.findIndex((slot) => itemDef(this.pack, slot.itemId)?.kind === "potion");
    if (idx === -1) return "none";
    const potion = itemDef(this.pack, s.inventory[idx]!.itemId)!;
    if (p.hp >= p.maxHp) return "full-hp";
    s.inventory[idx]!.qty--;
    if (s.inventory[idx]!.qty === 0) s.inventory.splice(idx, 1);
    p.hp = Math.min(p.maxHp, p.hp + (potion.healAmount ?? 20));
    gameBus.emit("potionUsed", { hpAfter: p.hp });
    return "ok";
  }

  equipFromBag(itemId: string): boolean {
    return equipItem(this.state, this.pack, itemId);
  }

  private openChest(chest: Entity): void {
    if (chest.opened) return;
    const s = this.state;
    chest.opened = true;
    s.stats.chestsOpened++;
    const lootNames: string[] = [];

    const goldAmt = this.rngLoot.intInclusive(5 + s.depth * 4, 15 + s.depth * 8);
    const g = makeEntity(s, "gold", jitter(chest.pos, this.rngLoot, 0.6), 0.22);
    g.quantity = goldAmt;

    const rolls = this.rngLoot.intInclusive(1, 2);
    for (let i = 0; i < rolls; i++) {
      const itemId = this.rollLoot(chest.lootTableId ?? "chest-default");
      if (!itemId) continue;
      const drop = makeEntity(s, "itemDrop", jitter(chest.pos, this.rngLoot, 0.7), 0.26);
      drop.itemId = itemId;
      drop.quantity = 1;
      drop.ttl = 180;
      lootNames.push(itemDef(this.pack, itemId)?.name ?? itemId);
    }
    gameBus.emit("chestOpened", { lootNames });
    logEvent(s, "chestOpen", lootNames.join(", "));
  }

  private usePortal(portal: Entity): void {
    const s = this.state;
    const cfg = this.floorConfig(s.depth)!;
    if (cfg.bossId && !this.bossDead()) {
      gameBus.emit("portalLocked", { reason: "The guardian blocks your escape." });
      return;
    }
    if (cfg.keyRequired && !s.keyCollected) {
      gameBus.emit("portalLocked", { reason: "The way down is sealed — find the key." });
      return;
    }
    if (s.depth >= this.pack.floors.length) {
      s.status = "victory";
      gameBus.emit("victory", { timeSec: s.timeSec });
      return;
    }
    this.loadFloor(s.depth + 1);
  }

  private useShrine(shrine: Entity): void {
    const s = this.state;
    const p = s.entities.get(s.playerId)!;
    const healed = p.hp < p.maxHp;
    if (!shrine.opened) {
      shrine.opened = true;
      p.hp = p.maxHp;
      gameBus.emit("shrineUsed", { message: healed ? "Warm light knits your wounds." : "The ember hums quietly." });
    } else {
      gameBus.emit("shrineUsed", { message: "The flame has already been shared." });
    }
  }

  // Queries -----------------------------------------------------------------

  player(): Entity | undefined {
    return this.state.entities.get(this.state.playerId);
  }

  enemiesAlive(): Entity[] {
    const out: Entity[] = [];
    for (const e of this.state.entities.values()) if (e.kind === "enemy" && !e.dead) out.push(e);
    return out;
  }
}

// Small helper attached dynamically in loadFloor; declared here to keep
// SimState JSON-clean.
declare module "./state.js" {
  interface SimState {
    currentFloorSpawns?: unknown;
  }
}

function packEliteAffixes(pack: ContentPack): NonNullable<ContentPack["eliteAffixes"]> {
  return pack.eliteAffixes ?? [];
}

function jitter(p: Vec2, rng: Rng, amount: number): Vec2 {
  const a = rng.next() * Math.PI * 2;
  const d = rng.range(0.2, amount);
  return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
}
