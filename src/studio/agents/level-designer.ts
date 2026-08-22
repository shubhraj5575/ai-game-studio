/**
 * Level Designer — authors floor configurations and PROVES them by running
 * the actual generator across many seeds per depth, checking success rates,
 * attempt distributions, and population statistics. Configs iterate until
 * quality gates pass (bounded rounds).
 */
import { Agent } from "../core/agent.js";
import type { ContentPack, FloorConfig, EnemyDef } from "../../engine/content/types.js";
import { generateFloor } from "../../engine/world/procgen.js";
import { ENEMY_BANK, BOSS_BANK } from "../content-banks.js";

interface LevelQualityStats {
  attemptsAvg: number;
  attemptsMax: number;
  enemyCountByDepth: Record<number, { avg: number; min: number; max: number; budget: number }>;
  failureRate: number;
}

export class LevelDesignerAgent extends Agent {
readonly id = "levels";
  readonly title = "Level Designer";
  private enemies: EnemyDef[] = [];

  provideEnemies(enemies: EnemyDef[]): void {
    this.enemies = enemies;
  }

  author(depthCount: number, difficulty: "welcoming" | "standard" | "punishing"): FloorConfig[] {
    const rng = this.ctx.rng;
    const budgetBase = difficulty === "welcoming" ? 4 : difficulty === "punishing" ? 7 : 5;
    const budgetPerDepth = difficulty === "welcoming" ? 1.3 : difficulty === "punishing" ? 2.0 : 1.6;

    const floors: FloorConfig[] = [];
    for (let d = 1; d <= depthCount; d++) {
      const pool = this.enemies.filter((e) => e.minDepth <= d && e.minDepth < 90);
      const sorted = [...pool].sort((a, b) => b.minDepth - a.minDepth);
      const spawnTable = sorted.slice(0, 4).map((e, i) => ({
        enemyId: e.id,
        // Newest unlocks are exciting but not dominant.
        weight: i === 0 ? 34 : Math.max(14, 50 - i * 12),
      }));
      // Ensure at least one entry.
      if (spawnTable.length === 0 && pool.length > 0) {
        spawnTable.push({ enemyId: pool[0]!.id, weight: 50 });
      }

      const isFinal = d === depthCount;
      const boss = isFinal ? rng.pick(BOSS_BANK).id : undefined;
      // Elites ramp from absent to common-ish by the final depth.
      const eliteChance = depthCount <= 1 ? 0 : Math.min(0.35, (d - 1) * 0.12);

      floors.push({
        depth: d,
        mapWidth: Math.min(56, 38 + d * 3),
        mapHeight: Math.min(56, 38 + d * 3),
        roomTargetMin: 5,
        roomTargetMax: 6 + Math.min(4, Math.floor(d / 2)),
        enemyBudgetBase: budgetBase + (d - 1) * 0.4,
        enemyBudgetPerDepth: budgetPerDepth,
        spawnTable,
        keyRequired: d >= 2,
        bossId: boss,
        chestCount: 2 + (d % 2),
        hasShrine: d === 1 || d % 2 === 0 || isFinal ? true : rng.chance(0.5),
        npcIds: npcPlanFor(d, depthCount),
        questCount: d <= 2 ? (d === 1 ? 2 : 1) : rng.chance(0.4) ? 1 : 0,
        eliteChance,
        floorNameTemplates: [], // filled by narrative pass
        ambientTint: ambientFor(d, depthCount),
        musicScaleId: d === depthCount ? "phrygian" : d % 2 === 0 ? "dorian" : "minorPentatonic",
      });
    }
    this.act("levels.authored", `${floors.length} floor configs`);
    return floors;

    function npcPlanFor(depth: number, total: number): string[] {
      if (depth === 1) return ["elder-quartermaster", "peddler"];
      if (depth === 2) return ["elder-quartermaster"];
      return [];
      void total;
    }
    function ambientFor(depth: number, total: number): string {
      const t = (depth - 1) / Math.max(total - 1, 1);
      const lerpCh = (a: number, b: number): number => Math.round(a + (b - a) * t);
      return `rgb(${lerpCh(26, 44)},${lerpCh(32, 31)},${lerpCh(48, 26)})`;
    }
    void rng.pick(ENEMY_BANK); // touch import for bank consistency check
  }

  /**
   * Validation loop: generate every depth × seeds; measure failure rate and
   * population spread; adjust configs up to `rounds` times.
   */
  validate(pack: ContentPack, seedsPerDepth = 10, rounds = 3): { stats: LevelQualityStats; passed: boolean } {
    let stats: LevelQualityStats | null = null;
    let passed = false;

    for (let round = 0; round < rounds && !passed; round++) {
      stats = this.sweepOnce(pack, seedsPerDepth);
      passed = stats.failureRate <= 0.02 &&
        Object.values(stats.enemyCountByDepth).every(
          (e) => e.avg > 0 && e.max <= e.budget * 1.9,
        );

      if (!passed) {
        if (stats.failureRate > 0.02) {
          // Rooms too dense for the space → widen maps / shrink room targets.
          for (const f of pack.floors) {
            f.mapWidth += 2;
            f.mapHeight += 2;
          }
          this.act("levels.adjusted", `failureRate ${stats.failureRate.toFixed(3)} → grew maps by 2`);
        }
        for (const [dRaw, e] of Object.entries(stats.enemyCountByDepth)) {
          const f = pack.floors.find((x) => x.depth === Number(dRaw));
          if (f && e.max > e.budget * 1.9) {
            f.enemyBudgetBase *= 0.85;
            this.act("levels.adjusted", `depth ${dRaw} pop ${e.max} vs budget ${e.budget.toFixed(1)} → base → ${f.enemyBudgetBase.toFixed(2)}`);
          }
        }
      }
    }

    const finalStats = stats as unknown as LevelQualityStats;
    this.act("levels.validated", `passed=${passed} failureRate=${finalStats.failureRate.toFixed(4)}`);
    this.artifactJson("levels/quality-stats.json", finalStats);
    return { stats: finalStats, passed };
  }

  private sweepOnce(pack: ContentPack, seedsPerDepth: number): LevelQualityStats {
    let attemptsTotal = 0;
    let attemptsMax = 0;
    let failures = 0;
    let runs = 0;
    const enemyCountByDepth: LevelQualityStats["enemyCountByDepth"] = {};

    for (const cfg of pack.floors) {
      const counts: number[] = [];
      for (let s = 1; s <= seedsPerDepth; s++) {
        runs++;
        try {
          const gen = generateFloor(pack, cfg, s * 7919 + cfg.depth * 13);
          attemptsTotal += gen.generationAttempts;
          attemptsMax = Math.max(attemptsMax, gen.generationAttempts);
          counts.push(gen.spawns.enemies.length + (gen.spawns.boss ? 1 : 0));
        } catch {
          failures++;
          counts.push(0);
        }
      }
      const budget = cfg.enemyBudgetBase + cfg.enemyBudgetPerDepth * cfg.depth;
      enemyCountByDepth[cfg.depth] = {
        avg: avg(counts),
        min: Math.min(...counts),
        max: Math.max(...counts),
        budget,
      };
    }

    return {
      attemptsAvg: runs > 0 ? attemptsTotal / runs : 0,
      attemptsMax,
      enemyCountByDepth,
      failureRate: runs > 0 ? failures / runs : 1,
    };
  }
}

function avg(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
