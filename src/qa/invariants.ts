/**
 * QA invariant checks — the "invalid state" detectors that run every few
 * ticks during harness play. Each violation becomes a BugIssue.
 */
import { vdist } from "../engine/core/math.js";
import { reachableTiles } from "../engine/world/pathfind.js";
import { xpToNext } from "../engine/sim/progression.js";
import type { Simulation } from "../engine/sim/simulation.js";
import type { BugIssue } from "./issues.js";
import { makeIssueId } from "./issues.js";

export interface InvariantContext {
  seed: number;
  frame: number;
}

export function checkInvariants(sim: Simulation, ctx: InvariantContext): BugIssue[] {
  const issues: BugIssue[] = [];
  const s = sim.state;
  const p = s.entities.get(s.playerId);
  if (!p) {
    issues.push({
      id: makeIssueId(ctx.seed, ctx.frame),
      severity: "blocker",
      kind: "invariant",
      title: "Player entity missing",
      detail: `playerId ${s.playerId} not found among ${s.entities.size} entities`,
      seed: ctx.seed,
      frame: ctx.frame,
      depth: s.depth,
    });
    return issues;
  }

  // Fatal error set by simulation's internal guard.
  if (s.fatalError) {
    issues.push({
      id: makeIssueId(ctx.seed, ctx.frame),
      severity: "blocker",
      kind: "crash",
      title: "Simulation fatal error",
      detail: s.fatalError.slice(0, 500),
      seed: ctx.seed,
      frame: ctx.frame,
      depth: s.depth,
      suggestedFix: "inspect stack trace; usually an engine logic bug or bad content data",
    });
  }

  // Player geometry.
  if (!sim.circleFree(p.pos.x, p.pos.y, p.radius)) {
    issues.push({
      id: makeIssueId(ctx.seed, ctx.frame),
      severity: "major",
      kind: "invariant",
      title: "Player embedded in wall",
      detail: `pos=(${p.pos.x.toFixed(3)},${p.pos.y.toFixed(3)}) r=${p.radius}`,
      seed: ctx.seed,
      frame: ctx.frame,
      depth: s.depth,
    });
  }

  // Numeric sanity.
  if (!(p.hp > 0 && p.hp <= p.maxHp + 1e-9) && s.status === "playing") {
    issues.push({
      id: makeIssueId(ctx.seed, ctx.frame),
      severity: "major",
      kind: "invariant",
      title: "Player HP out of bounds while alive",
      detail: `hp=${p.hp} maxHp=${p.maxHp}`,
      seed: ctx.seed,
      frame: ctx.frame,
      depth: s.depth,
    });
  }
  if (s.gold < 0) {
    issues.push({
      id: makeIssueId(ctx.seed, ctx.frame),
      severity: "major",
      kind: "invariant",
      title: "Negative gold",
      detail: `gold=${s.gold}`,
      seed: ctx.seed,
      frame: ctx.frame,
      depth: s.depth,
    });
  }
  if (s.xp < 0 || s.level < 1 || s.xp >= xpToNext(sim.pack.systems.xpCurve, s.level)) {
    issues.push({
      id: makeIssueId(ctx.seed, ctx.frame),
      severity: "major",
      kind: "invariant",
      title: "XP/level inconsistent with curve",
      detail: `level=${s.level} xp=${s.xp} xpToNext=${xpToNext(sim.pack.systems.xpCurve, s.level)}`,
      seed: ctx.seed,
      frame: ctx.frame,
      depth: s.depth,
    });
  }

  // Entities finite & enemies sane.
  let enemies = 0;
  for (const e of s.entities.values()) {
    if (!Number.isFinite(e.pos.x) || !Number.isFinite(e.pos.y)) {
      issues.push({
        id: makeIssueId(ctx.seed, ctx.frame),
        severity: "major",
        kind: "invariant",
        title: `Entity ${e.id} (${e.kind}) has non-finite position`,
        detail: JSON.stringify({ x: e.pos.x, y: e.pos.y }),
        seed: ctx.seed,
        frame: ctx.frame,
        depth: s.depth,
      });
    }
    if (e.kind === "enemy") {
      enemies++;
      if (Number.isNaN(e.hp) || e.hp > e.maxHp + 1e-9) {
        issues.push({
          id: makeIssueId(ctx.seed, ctx.frame),
          severity: "minor",
          kind: "invariant",
          title: `Enemy ${e.defId} hp anomaly`,
          detail: `hp=${e.hp} maxHp=${e.maxHp}`,
          seed: ctx.seed,
          frame: ctx.frame,
          depth: s.depth,
        });
      }
    }
  }
  const cfg = sim.floorConfig(s.depth);
  if (cfg && enemies > cfg.enemyBudgetBase + cfg.enemyBudgetPerDepth * s.depth + 8) {
    issues.push({
      id: makeIssueId(ctx.seed, ctx.frame),
      severity: "minor",
      kind: "invariant",
      title: "Enemy population far above budget",
      detail: `enemies=${enemies} budget≈${cfg.enemyBudgetBase + cfg.enemyBudgetPerDepth * s.depth}`,
      seed: ctx.seed,
      frame: ctx.frame,
      depth: s.depth,
    });
  }

  // Completability guarantee: every active collect objective must have
  // enough matching items on the ground to cover its remaining deficit.
  for (const q of s.quests) {
    if (q.status !== "active") continue;
    for (const o of q.objectives) {
      if (o.kind !== "collect") continue;
      const deficit = o.needed - o.progress;
      let onGround = 0;
      for (const e of s.entities.values()) {
        if (e.kind === "itemDrop" && !e.dead && e.itemId === o.targetRef) onGround += e.quantity ?? 1;
        if (onGround >= deficit) break;
      }
      if (onGround < deficit) {
        issues.push({
          id: makeIssueId(ctx.seed, ctx.frame),
          severity: "blocker",
          kind: "progression-blocker",
          title: "Collect quest cannot complete (deficit not on ground)",
          detail: `quest=${q.id} item=${o.targetRef} needed=${o.needed} progress=${o.progress} ground=${onGround}`,
          seed: ctx.seed,
          frame: ctx.frame,
          depth: s.depth,
          suggestedFix: "spawnCollectQuestGuarantees may have failed; check candidate tile generation",
        });
      }
    }
  }

  // Progression blocker: exit portal must be reachable from player position
  // on the tile graph (checked cheaply every so often by caller cadence).
  return issues;
}

/** Heavier structural checks run on floor entry and periodically. */
export function checkProgressionFeasibility(sim: Simulation, ctx: InvariantContext): BugIssue[] {
  const issues: BugIssue[] = [];
  const s = sim.state;
  const p = s.entities.get(s.playerId);
  const cfg = sim.floorConfig(s.depth);
  if (!p || !cfg) return issues;

  const reach = reachableTiles(s.map, p.pos.x, p.pos.y);
  const portal = [...s.entities.values()].find((e) => e.kind === "portal");
  if (!portal) {
    issues.push({
      id: makeIssueId(ctx.seed, ctx.frame),
      severity: "blocker",
      kind: "progression-blocker",
      title: "No exit portal on floor",
      detail: `depth=${s.depth}`,
      seed: ctx.seed,
      frame: ctx.frame,
      depth: s.depth,
    });
  } else {
    const idx = s.map.idx(Math.floor(portal.pos.x), Math.floor(portal.pos.y));
    if (!reach.has(idx)) {
      issues.push({
        id: makeIssueId(ctx.seed, ctx.frame),
        severity: "blocker",
        kind: "progression-blocker",
        title: "Exit portal unreachable from player position",
        detail: `depth=${s.depth} portal=(${portal.pos.x},${portal.pos.y})`,
        seed: ctx.seed,
        frame: ctx.frame,
        depth: s.depth,
        suggestedFix: "regenerate floor with next seed candidate; verify generator connectivity",
      });
    }
  }

  if (cfg.keyRequired && !s.keyCollected) {
    const key = [...s.entities.values()].find((e) => e.kind === "key");
    if (!key) {
      issues.push({
        id: makeIssueId(ctx.seed, ctx.frame),
        severity: "blocker",
        kind: "progression-blocker",
        title: "Key required but no key entity exists",
        detail: `depth=${s.depth}`,
        seed: ctx.seed,
        frame: ctx.frame,
        depth: s.depth,
      });
    } else {
      const idx = s.map.idx(Math.floor(key.pos.x), Math.floor(key.pos.y));
      if (!reach.has(idx)) {
        issues.push({
          id: makeIssueId(ctx.seed, ctx.frame),
          severity: "blocker",
          kind: "progression-blocker",
          title: "Key unreachable from player position",
          detail: `depth=${s.depth}`,
          seed: ctx.seed,
          frame: ctx.frame,
          depth: s.depth,
        });
      }
    }
  }

  // NPCs should be reachable too (quest blockers).
  for (const npc of [...s.entities.values()].filter((e) => e.kind === "npc")) {
    const idx = s.map.idx(Math.floor(npc.pos.x), Math.floor(npc.pos.y));
    if (!reach.has(idx) && vdist(npc.pos, p.pos) > 2) {
      issues.push({
        id: makeIssueId(ctx.seed, ctx.frame),
        severity: "major",
        kind: "progression-blocker",
        title: "NPC unreachable (quests may be blocked)",
        detail: `npc=${npc.npcDefId} depth=${s.depth}`,
        seed: ctx.seed,
        frame: ctx.frame,
        depth: s.depth,
      });
    }
  }

  return issues;
}
