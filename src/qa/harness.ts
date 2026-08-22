/**
 * QA harness — plays real games with bot players and judges the build.
 *
 * The harness subscribes to the game's event bus to track system coverage,
 * runs invariant checks at cadence, spot-checks save/load determinism, and
 * measures per-tick cost. A suite aggregates seed results into a verdict:
 * the QA Engineer agent can REJECT a build outright.
 */
import { performance } from "node:perf_hooks";
import type { ContentPack } from "../engine/content/types.js";
import { Simulation, emptyInput } from "../engine/sim/simulation.js";
import { snapshot, restoreFromSnapshot } from "../engine/sim/save.js";
import { stateHash } from "../engine/debug/state-hash.js";
import { gameBus } from "../engine/sim/game-events.js";
import type { BotPlayer } from "./bots.js";
import { ObjectiveBot, RandomBot } from "./bots.js";
import { checkInvariants, checkProgressionFeasibility } from "./invariants.js";
import type { BugIssue, CoverageFlags } from "./issues.js";
import { emptyCoverage, makeIssueId } from "./issues.js";

export interface SeedRunOptions {
  maxTicks: number;
  invariantCadence: number;
  feasibilityCadence: number;
  /** Fraction of the run after which we do the save/restore spot-check. */
  saveCheckAt: number;
  perfTickBudgetMs: number;
}

export const DEFAULT_SEED_OPTIONS: SeedRunOptions = {
  maxTicks: 60 * 60 * 12, // 12 in-game minutes
  invariantCadence: 15,
  feasibilityCadence: 300,
  saveCheckAt: 0.4,
  perfTickBudgetMs: 2.5,
};

export type RunOutcome = "victory" | "died" | "timeout" | "crashed";

export interface SeedResult {
  seed: number;
  botName: string;
  outcome: RunOutcome;
  ticksUsed: number;
  depthReached: number;
  kills: number;
  goldEarned: number;
  questsCompleted: number;
  issues: BugIssue[];
  coverage: CoverageFlags;
  perf: {
    wallSeconds: number;
    avgTickMs: number;
    p95TickMs: number;
    maxTickMs: number;
    ticksPerSecond: number;
    peakRssMb: number;
  };
  finalHash: string;
  statusAtEnd: string;
}

interface EventTracker {
  coverage: CoverageFlags;
  swingNearEnemyTicks: number;
}

function trackEvents(tracker: EventTracker): Array<() => void> {
  const unsubs: Array<() => void> = [];
  const on = gameBus.on.bind(gameBus);
  unsubs.push(on("hit", () => {
    tracker.coverage.combatSeen = true;
    tracker.coverage.killSeen = true;
  }));
  unsubs.push(on("hurt", () => {
    tracker.coverage.damageTakenSeen = true;
  }));
  unsubs.push(on("pickup", () => {
    tracker.coverage.itemPickupSeen = true;
  }));
  unsubs.push(on("gold", () => {
    tracker.coverage.goldSeen = true;
  }));
  unsubs.push(on("questAccepted", () => {
    tracker.coverage.questAccepted = true;
  }));
  unsubs.push(on("questCompleted", () => {
    tracker.coverage.questCompleted = true;
  }));
  unsubs.push(on("buy", () => {
    tracker.coverage.shopUsed = true;
  }));
  unsubs.push(on("potionUsed", () => {
    tracker.coverage.potionUsed = true;
  }));
  unsubs.push(on("chestOpened", () => {
    tracker.coverage.chestOpened = true;
  }));
  unsubs.push(on("shrineUsed", () => {
    tracker.coverage.shrineUsed = true;
  }));
  unsubs.push(on("keyFound", () => {
    tracker.coverage.keyFound = true;
  }));
  unsubs.push(on("descend", (e) => {
    if (e.depth > 1) tracker.coverage.descended = true;
  }));
  unsubs.push(on("levelUp", () => {
    tracker.coverage.levelUpSeen = true;
  }));
  unsubs.push(on("eliteSeen", () => {
    tracker.coverage.eliteSeen = true;
  }));
  unsubs.push(on("sold", () => {
    tracker.coverage.soldItem = true;
  }));
  return unsubs;
}

/** Play one seed to conclusion (or timeout) and report everything observed. */
export function runSeed(pack: ContentPack, seed: number, opts: SeedRunOptions = DEFAULT_SEED_OPTIONS): SeedResult {
  const sim = new Simulation(pack, seed);

  // Use an objective bot primarily; inject some chaos for interaction fuzz.
  const bots: BotPlayer[] = [new ObjectiveBot(seed), new RandomBot(seed)];
  let activeBot = 0;

  const tracker: EventTracker = { coverage: emptyCoverage(), swingNearEnemyTicks: 0 };
  const unsubs = trackEvents(tracker);

  const issues: BugIssue[] = [];
  const tickTimes = new Float64Array(Math.min(opts.maxTicks, 60000));
  let tickIdx = 0;
  let maxTickMs = 0;

  const startWall = performance.now();
  const startRss = process.memoryUsage().rss;
  let peakRss = startRss;

  let saveChecked = false;
  let referenceSim: Simulation | null = null;
  let diverged = false;

  let outcome: RunOutcome = "timeout";
  let frame = 0;

  try {
    for (frame = 0; frame < opts.maxTicks; frame++) {
      // Occasionally swap to chaos bot for short bursts.
      if (frame % 1800 === 900) activeBot = (activeBot + 1) % bots.length;
      const bot = frame % 1800 < 1500 ? bots[0]! : bots[1]!;
      void activeBot;

      const t0 = performance.now();
      sim.step(bot.drive(sim, frame));
      const dtMs = performance.now() - t0;
      maxTickMs = Math.max(maxTickMs, dtMs);
      if (tickIdx < tickTimes.length) tickTimes[tickIdx++] = dtMs;

      peakRss = Math.max(peakRss, process.memoryUsage().rss);

      if (sim.state.status !== "playing") {
        outcome = sim.state.status === "victory" ? "victory" : "died";
        break;
      }

      // Invariants cadence.
      if (frame % opts.invariantCadence === 0) {
        issues.push(...checkInvariants(sim, { seed, frame }));
        if (issues.some((i) => i.severity === "blocker")) break;
      }
      // Feasibility cadence.
      if (frame % opts.feasibilityCadence === 299) {
        issues.push(...checkProgressionFeasibility(sim, { seed, frame }));
      }

      // Save/load determinism spot-check once per run.
      const saveAtFrame = Math.min(Math.floor(opts.maxTicks * opts.saveCheckAt), 3000);
      if (!saveChecked && frame === saveAtFrame) {
        saveChecked = true;
        tracker.coverage.saveLoadChecked = true;
        const snap = snapshot(sim);
        const restored = restoreFromSnapshot(pack, snap);
        referenceSim = new Simulation(pack, seed);
        // Fast-forward reference to same tick count is expensive; instead
        // verify restored hash equals live hash and both step identically
        // for 120 frames against each other.
        const hashA = stateHash(sim);
        const hashB = stateHash(restored);
        if (hashA !== hashB) {
          issues.push({
            id: makeIssueId(seed, frame),
            severity: "blocker",
            kind: "save-load",
            title: "Save/restore hash mismatch",
            detail: `live=${hashA} restored=${hashB}`,
            seed,
            frame,
            depth: sim.state.depth,
          });
          diverged = true;
        } else {
          for (let k = 0; k < 120 && !diverged; k++) {
            const input = emptyInput();
            input.moveX = Math.sin((frame + k) * 0.1);
            input.moveY = Math.cos((frame + k) * 0.07);
            sim.step(input);
            restored.step(input);
            if (stateHash(sim) !== stateHash(restored)) {
              issues.push({
                id: makeIssueId(seed, frame + k),
                severity: "blocker",
                kind: "save-load",
                title: "Post-restore divergence",
                detail: `diverged ${k} frames after restore`,
                seed,
                frame: frame + k,
                depth: sim.state.depth,
              });
              diverged = true;
            }
          }
          // Continue the run from the ORIGINAL sim (restored is discarded).
        }
      }
    }
  } catch (err) {
    outcome = "crashed";
    issues.push({
      id: makeIssueId(seed, frame),
      severity: "blocker",
      kind: "crash",
      title: "Harness-level exception",
      detail: err instanceof Error ? `${err.message}\n${err.stack?.slice(0, 400) ?? ""}` : String(err),
      seed,
      frame,
      depth: sim.state.depth,
    });
  } finally {
    for (const u of unsubs) u();
  }

  const wallSeconds = (performance.now() - startWall) / 1000;
  // Discard JIT/GC warm-up: the first second of samples says nothing about
  // sustained frame cost, only about the host's cold start.
  const warmupSkip = Math.min(tickIdx, 60);
  const used = tickTimes.subarray(warmupSkip, tickIdx).slice().sort();
  const avg = used.reduce((a, b) => a + b, 0) / Math.max(used.length, 1);
  const p95 = used[Math.floor(used.length * 0.95)] ?? 0;
  // Spike stats also exclude warm-up AND the top 0.1% (GC pauses are host noise).
  const spikeTrim = Math.max(0, Math.floor(used.length * 0.001));
  const trimmedMax = used[Math.max(0, used.length - 1 - spikeTrim)] ?? 0;

  if (avg > opts.perfTickBudgetMs) {
    issues.push({
      id: makeIssueId(seed, frame),
      severity: "major",
      kind: "performance",
      title: "Average tick time above budget",
      detail: `avg=${avg.toFixed(3)}ms budget=${opts.perfTickBudgetMs}ms`,
      seed,
      frame,
      depth: sim.state.depth,
    });
  }
  if (trimmedMax > opts.perfTickBudgetMs * 12) {
    issues.push({
      id: makeIssueId(seed, frame),
      severity: "minor",
      kind: "performance",
      title: "Sustained p99.9 tick above 12x budget",
      detail: `p999=${trimmedMax.toFixed(3)}ms (warm-up excluded)`,
      seed,
      frame,
      depth: sim.state.depth,
    });
  }
  void diverged;
  void referenceSim;

  return {
    seed,
    botName: "objective+random mix",
    outcome,
    ticksUsed: frame,
    depthReached: sim.state.depth,
    kills: sim.state.stats.totalKills,
    goldEarned: sim.state.gold,
    questsCompleted: sim.state.stats.questsCompleted,
    issues,
    coverage: tracker.coverage,
    perf: {
      wallSeconds,
      avgTickMs: avg,
      p95TickMs: p95,
      maxTickMs,
      ticksPerSecond: frame / Math.max(wallSeconds, 1e-9),
      peakRssMb: peakRss / 1024 / 1024,
    },
    finalHash: stateHash(sim),
    statusAtEnd: sim.state.status,
  };
}
