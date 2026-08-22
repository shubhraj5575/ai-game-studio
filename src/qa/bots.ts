/**
 * Bot players for automated QA playthroughs.
 *
 * Bots drive the game exclusively through its public API — FrameInput plus
 * the discrete action methods — exactly like the browser client does. They
 * may READ simulation state (equivalent of a player looking at the screen)
 * but never mutate it directly.
 */
import { vdist, vnorm } from "../engine/core/math.js";
import type { Vec2 } from "../engine/core/math.js";
import type { Entity } from "../engine/sim/state.js";
import type { Simulation, FrameInput } from "../engine/sim/simulation.js";
import { emptyInput } from "../engine/sim/simulation.js";
import { findPath } from "../engine/world/pathfind.js";
import { Rng } from "../engine/core/rng.js";

export interface BotPlayer {
  readonly name: string;
  drive(sim: Simulation, frame: number): FrameInput;
}

// ---------------------------------------------------------------------------
// RandomBot — chaos monkey. Finds crashes and weird interactions.
// ---------------------------------------------------------------------------

export class RandomBot implements BotPlayer {
  readonly name = "random-bot";
  private rng: Rng;
  private holdAttack = 0;
  private dirX = 0;
  private dirY = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x5eed);
  }

  drive(_sim: Simulation, _frame: number): FrameInput {
    const input = emptyInput();
    if (this.rng.chance(0.06)) {
      this.dirX = this.rng.range(-1, 1);
      this.dirY = this.rng.range(-1, 1);
    }
    input.moveX = this.dirX;
    input.moveY = this.dirY;
    this.holdAttack = this.rng.chance(0.25) ? 8 : Math.max(0, this.holdAttack - 1);
    input.attackHeld = this.holdAttack === 8;
    input.dodgePressed = this.rng.chance(0.01);
    input.interactPressed = this.rng.chance(0.02);
    return input;
  }
}

// ---------------------------------------------------------------------------
// ObjectiveBot — plays to win. Proves completability.
// ---------------------------------------------------------------------------

export class ObjectiveBot implements BotPlayer {
  readonly name = "objective-bot";
  private rng: Rng;
  private path: Array<{ x: number; y: number }> | null = null;
  private pathTarget: string | null = null;
  private repathCooldown = 0;
  private stuckFrames = 0;
  private lastPos: Vec2 = { x: -999, y: -999 };
  private sidestepFrames = 0;
  private sidestepDir = 1;
  private interactedNpcs = new Set<number>();
  private npcCooldown = new Map<number, number>();
  private openedDialogueFrame = -99;
  private pursuitId: number | null = null;
  private pursuitSince = 0;
  private blacklist = new Map<number, number>();
  private currentGoalId: string | null = null;
  private goalSince = 0;
  private goalBlacklist = new Map<string, number>();
  private wanderTarget: Vec2 | null = null;

  /** An NPC is worth visiting when it has work for us and we didn't just talk. */
  private npcWorthVisiting(sim: Simulation, npcId: number, frame: number): boolean {
    const until = this.npcCooldown.get(npcId);
    if (until !== undefined && frame < until) return false;
    const quests = sim.state.quests.filter((q) => q.giverEntityId === npcId);
    return quests.some((q) => q.status === "offered" || q.status === "readyTurnIn");
  }

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x0b57c47); // deterministic per-seed personality
  }

  drive(sim: Simulation, frame: number): FrameInput {
    const s = sim.state;
    const input = emptyInput();
    const p = s.entities.get(s.playerId);
    if (!p || s.status !== "playing") return input;

    const t = sim.pack.systems.player;

    // --- Stuck detection --------------------------------------------------
    const moved = vdist(p.pos, this.lastPos);
    this.lastPos = { x: p.pos.x, y: p.pos.y };
    const wantsMove = true;
    if (moved < 0.004 && wantsMove && frame > 10) this.stuckFrames++;
    else this.stuckFrames = 0;
    if (this.stuckFrames === 50) {
      this.sidestepFrames = 35;
      this.sidestepDir = this.rng.chance(0.5) ? 1 : -1;
      this.path = null;
      this.pathTarget = null;
    }

    // --- Dialogue handling (discrete actions) ------------------------------
    if (s.dialogue) {
      this.openedDialogueFrame = frame;
      const d = s.dialogue;
      let acted = false;
      for (const qid of d.canTurnInQuestIds) {
        if (sim.turnInQuestById(qid)) {
          acted = true;
          break;
        }
      }
      if (!acted) {
        for (const qid of d.canAcceptQuestIds) {
          if (sim.acceptQuest(qid)) break;
        }
      }
      if (!acted && d.canShop) {
        this.tryShop(sim, d.npcEntityId, p.hp / p.maxHp);
        this.trySellJunk(sim);
      }
      // Business done? The dialogue's option lists are snapshots; recompute
      // from live quest status, then walk away to close the conversation.
      const liveBusiness =
        s.quests.some((q) => q.giverEntityId === d.npcEntityId && q.status === "offered") ||
        s.quests.some((q) => q.giverEntityId === d.npcEntityId && q.status === "readyTurnIn");
      // Buyable RIGHT NOW: hurt enough to drink, potion in stock, affordable.
      let buyableNow = false;
      if (d.canShop && p.hp / p.maxHp < 0.8) {
        const stock = sim.shopStock(d.npcEntityId);
        const potion = stock.find((id) => id.includes("potion"));
        if (potion) {
          const defPrice = sim.pack.items.find((i) => i.id === potion)?.value ?? Infinity;
          buyableNow = s.gold >= sim.priceOf(defPrice);
        }
      }
      const tooLong = frame - this.openedDialogueFrame > 480;
      if ((!liveBusiness && !buyableNow) || tooLong) {
        const npc = s.entities.get(d.npcEntityId);
        if (npc) {
          const away = vnorm({ x: p.pos.x - npc.pos.x, y: p.pos.y - npc.pos.y });
          input.moveX = away.x;
          input.moveY = away.y;
          this.path = null;
          this.pathTarget = null;
        }
      }
      return input;
    }

    // --- Potion usage -------------------------------------------------------
    if (p.hp / p.maxHp < 0.42 && sim.usePotion() === "ok") {
      // healed this frame; continue moving below
    }

    // --- Target selection ---------------------------------------------------
    const enemies = [...s.entities.values()].filter(
      (e) => e.kind === "enemy" && !e.dead && vdist(e.pos, p.pos) < 5.5,
    );
    enemies.sort((a, b) => vdist(a.pos, p.pos) - vdist(b.pos, p.pos));

    const cfg = sim.floorConfig(s.depth)!;
    const key = [...s.entities.values()].find((e) => e.kind === "key");
    const portal = [...s.entities.values()].find((e) => e.kind === "portal");
    const bossAlive = cfg.bossId
      ? [...s.entities.values()].find((e) => e.kind === "enemy" && !e.dead && e.defId === cfg.bossId)
      : undefined;

    const chests = [...s.entities.values()].filter(
      (e) => e.kind === "chest" && !e.opened && vdist(e.pos, p.pos) < 7,
    );
    chests.sort((a, b) => vdist(a.pos, p.pos) - vdist(b.pos, p.pos));

    // Ready-turn-in NPCs are worth crossing the whole map for; others only
    // if nearby. Merchants matter when hurt or rich.
    const merchants = [...s.entities.values()].filter(
      (e) => e.kind === "npc" &&
        sim.pack.npcDefs.find((n) => n.id === e.npcDefId)?.role === "merchant" &&
        (p.hp / p.maxHp < 0.65 || s.gold > 80),
    );
    const questNpcs = [...s.entities.values()].filter(
      (e) => e.kind === "npc" && this.npcWorthVisiting(sim, e.id, frame),
    );
    const readyIds = new Set(
      s.quests.filter((q) => q.status === "readyTurnIn").map((q) => q.giverEntityId),
    );
    // No distance cap: quest NPCs are always worth the trip.
    const npcs = [...questNpcs, ...merchants].filter((e, i, arr) =>
      arr.findIndex((x) => x.id === e.id) === i,
    );
    // Prefer NPCs that can turn in quests (immediate rewards).
    npcs.sort((a, b) => {
      const aReady = readyIds.has(a.id) ? 0 : 1;
      const bReady = readyIds.has(b.id) ? 0 : 1;
      return aReady - bReady || vdist(a.pos, p.pos) - vdist(b.pos, p.pos);
    });

    const shrine = [...s.entities.values()].find(
      (e) => e.kind === "shrine" && !e.opened && vdist(e.pos, p.pos) < 6 && p.hp / p.maxHp < 0.85,
    );

    // --- Combat priority ----------------------------------------------------
    // Give up on unwinnable pursuits (kiting ranged enemies).
    const nearestEnemyRaw = enemies[0];
    let nearestEnemy: Entity | undefined = nearestEnemyRaw;
    if (nearestEnemyRaw) {
      const id = nearestEnemyRaw.id;
      if (this.pursuitId !== id) {
        this.pursuitId = id;
        this.pursuitSince = frame;
      }
      const blacklisted = this.blacklist.get(id);
      if (blacklisted !== undefined && frame < blacklisted) {
        nearestEnemy = undefined;
      } else if (frame - this.pursuitSince > 300 && vdist(nearestEnemyRaw.pos, p.pos) > t.attackRange * 1.1) {
        // Couldn't close the distance in 5s — stop chasing for 10s.
        this.blacklist.set(id, frame + 600);
        this.pursuitId = null;
        nearestEnemy = undefined;
      }
    } else {
      this.pursuitId = null;
    }

    if (nearestEnemy) {
      const d = vdist(nearestEnemy.pos, p.pos);
      const desiredFacing = Math.atan2(nearestEnemy.pos.y - p.pos.y, nearestEnemy.pos.x - p.pos.x);
      input.aimX = Math.cos(desiredFacing);
      input.aimY = Math.sin(desiredFacing);

      if (d > t.attackRange * 0.8) {
        // Close in, slight strafe so we don't hug perfectly.
        this.moveToward(sim, p, nearestEnemy.pos, input);
      } else {
        // Circle-strafe while attacking.
        const away = vnorm({ x: p.pos.x - nearestEnemy.pos.x, y: p.pos.y - nearestEnemy.pos.y });
        const side = { x: -away.y * this.sidestepDir, y: away.x * this.sidestepDir };
        input.moveX = away.x * 0.25 + side.x * 0.75;
        input.moveY = away.y * 0.25 + side.y * 0.75;
        if (this.rng.chance(0.01)) this.sidestepDir *= -1;
      }
      input.attackHeld = frame % 6 === 0;
      // Emergency dodge when an enemy is winding up very close.
      const windingUp = enemies.some(
        (e) => (e.windupTimer ?? 0) > 0 && vdist(e.pos, p.pos) < t.attackRange + 0.6,
      );
      if (windingUp && this.rng.chance(0.35)) input.dodgePressed = true;
      this.trim(input);
      return input;
    }

    // --- Item drops: quest targets anywhere, conveniences nearby -------------
    const wantedItems = new Set<string>();
    for (const q of s.quests) {
      if (q.status !== "active") continue;
      for (const o of q.objectives) {
        if (o.kind === "collect" && o.progress < o.needed) wantedItems.add(o.targetRef);
      }
    }
    const drops = [...s.entities.values()].filter((e) => e.kind === "itemDrop" && !e.dead);
    const wantedDrop = drops.find((e) => wantedItems.has(e.itemId!));
    const nearbyDrop = drops.find((e) => vdist(e.pos, p.pos) < 4.5);
    const soughtDrop = wantedDrop ?? nearbyDrop;
    if (soughtDrop && !nearestEnemy) {
      this.navigate(sim, p, soughtDrop.pos, `drop-${soughtDrop.id}`, input);
      // Auto-pickup happens on proximity; also grab gold en route.
      this.trim(input);
      return input;
    }

    // --- Interaction priorities ----------------------------------------------
    if (npcs[0] && vdist(npcs[0].pos, p.pos) <= t.interactRadius) {
      this.interactedNpcs.add(npcs[0]!.id);
      this.npcCooldown.set(npcs[0]!.id, frame + 900);
      input.interactPressed = true;
      return input;
    }
    if (chests[0] && vdist(chests[0]!.pos, p.pos) <= t.interactRadius) {
      input.interactPressed = true;
      return input;
    }
    if (shrine && vdist(shrine.pos, p.pos) <= t.interactRadius) {
      input.interactPressed = true;
      return input;
    }

    // --- Navigation targets ---------------------------------------------------
    // Priority: ready-turn-in NPC > quest-giving NPC > key > boss > portal.
    const readyNpc = npcs.find((n) => s.quests.some((q) => q.giverEntityId === n.id && q.status === "readyTurnIn"));
    let goalPoint: Vec2 | null = null;
    let goalId: string | null = null;
    let interactWhenClose = false;

    const goalAllowed = (id: string): boolean => {
      const until = this.goalBlacklist.get(id);
      return until === undefined || frame >= until;
    };
    const consider = (point: Vec2, id: string, interact: boolean): boolean => {
      if (!goalPoint && goalAllowed(id)) {
        goalPoint = point;
        goalId = id;
        interactWhenClose = interact;
        return true;
      }
      return false;
    };

    if (readyNpc) {
      consider(readyNpc.pos, `npc-${readyNpc.id}`, true);
    }
    if (!goalPoint && cfg.keyRequired && !s.keyCollected && key) {
      goalPoint = key.pos; // win-critical: never blacklisted
      goalId = `key-${key.id}`;
    }
    if (!goalPoint && bossAlive) {
      goalPoint = bossAlive.pos; // win-critical
      goalId = `boss-${bossAlive.id}`;
    }
    if (!goalPoint) {
      for (const n of npcs) consider(n.pos, `npc-${n.id}`, true);
    }
    if (!goalPoint && portal) consider(portal.pos, `portal-${portal.id}`, true);
    if (!goalPoint) {
      for (const c of chests) consider(c.pos, `chest-${c.id}`, true);
    }
    if (!goalPoint && shrine) consider(shrine.pos, `shrine-${shrine.id}`, true);

    if (goalPoint) {
      // Skippable-goal timeout: abandon goals we fail to reach for 20s.
      const skippable = goalId !== null &&
        (goalId.startsWith("chest-") || goalId.startsWith("drop-") ||
          goalId.startsWith("npc-") || goalId.startsWith("shrine-"));
      if (skippable && goalId) {
        if (this.currentGoalId !== goalId) {
          this.currentGoalId = goalId;
          this.goalSince = frame;
        } else if (frame - this.goalSince > 1200) {
          this.goalBlacklist.set(goalId, frame + 2400);
          this.currentGoalId = null;
          this.path = null;
          goalPoint = null;
          goalId = null;
        }
      }
    }

    if (goalPoint) {
      const d = vdist(goalPoint, p.pos);
      if (interactWhenClose && d <= t.interactRadius * 0.9) {
        if (goalId?.startsWith("npc-")) {
          const nid = Number(goalId.slice(4));
          this.interactedNpcs.add(nid);
          this.npcCooldown.set(nid, frame + 900);
        }
        input.interactPressed = true;
        return input;
      }
      this.navigate(sim, p, goalPoint, goalId ?? "unknown", input);
      this.trim(input);
      return input;
    }

    // Nothing available — wander between room centers so we stay useful.
    if (frame % 300 === 0 || !this.wanderTarget ||
        vdist(this.wanderTarget, p.pos) < 0.8) {
      const rooms = s.map.rooms;
      const r = rooms[this.rng.int(0, rooms.length)]!;
      this.wanderTarget = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }
    this.navigate(sim, p, this.wanderTarget!, "wander", input);
    this.trim(input);
    return input;
  }

  private tryShop(sim: Simulation, npcId: number, hpFrac: number): void {
    const stock = sim.shopStock(npcId);
    if (stock.length === 0) return;
    const potions = stock.filter((id) => id.includes("potion"));
    if (hpFrac < 0.8 && potions.length > 0) {
      sim.buyItem(npcId, potions[0]!);
    }
  }

  /** Sell surplus gear (keeps one weapon/armor; never equipped relics). */
  private trySellJunk(sim: Simulation): void {
    const s = sim.state;
    const sellable = s.inventory.filter((slot) => {
      const def = sim.pack.items.find((i) => i.id === slot.itemId);
      return def && (def.kind === "weapon" || def.kind === "armor");
    });
    // Keep the best weapon + best armor; sell the rest.
    const keep = new Set<string>();
    const bestWeapon = [...sellable]
      .filter((x) => x.itemId.startsWith("weapon"))
      .sort((a, b) => (sim.pack.items.find((i) => i.id === b.itemId)?.power ?? 0) - (sim.pack.items.find((i) => i.id === a.itemId)?.power ?? 0))[0];
    if (bestWeapon) keep.add(bestWeapon.itemId);
    const bestArmor = [...sellable]
      .filter((x) => x.itemId.startsWith("armor"))
      .sort((a, b) => (sim.pack.items.find((i) => i.id === b.itemId)?.defense ?? 0) - (sim.pack.items.find((i) => i.id === a.itemId)?.defense ?? 0))[0];
    if (bestArmor) keep.add(bestArmor.itemId);

    for (const slot of sellable) {
      if (keep.has(slot.itemId)) continue;
      if (sim.sellItem(slot.itemId) === "ok") break; // one per visit keeps dialogue flow simple
    }
  }

  /** A*-based navigation with waypoint following. */
  private navigate(sim: Simulation, p: Entity, target: Vec2, goalId: string, input: FrameInput): void {
    if (this.currentGoalId !== goalId) {
      this.currentGoalId = goalId;
      this.goalSince = sim.state.tick;
    }
    this.repathCooldown--;
    const targetMoved = this.pathTarget !== goalId;
    if (!this.path || this.path.length === 0 || targetMoved || this.repathCooldown <= 0) {
      this.path = findPath(sim.state.map, p.pos.x, p.pos.y, target.x, target.y);
      this.pathTarget = goalId;
      this.repathCooldown = 45;
    }
    const wp = this.path[0];
    if (!wp) return;
    if (vdist(wp, p.pos) < 0.55) {
      this.path.shift();
      return;
    }
    this.moveToward(sim, p, wp, input);
  }

  private moveToward(_sim: Simulation, p: Entity, point: Vec2, input: FrameInput): void {
    if (this.sidestepFrames > 0) {
      this.sidestepFrames--;
      const away = vnorm({ x: p.pos.x - point.x, y: p.pos.y - point.y });
      const side = { x: -away.y * this.sidestepDir, y: away.x * this.sidestepDir };
      input.moveX = side.x * 0.8 + away.x * 0.2;
      input.moveY = side.y * 0.8 + away.y * 0.2;
      return;
    }
    const dir = vnorm({ x: point.x - p.pos.x, y: point.y - p.pos.y });
    input.moveX = dir.x;
    input.moveY = dir.y;
  }

  private trim(input: FrameInput): void {
    const l = Math.hypot(input.moveX, input.moveY);
    if (l > 1) {
      input.moveX /= l;
      input.moveY /= l;
    }
  }
}
