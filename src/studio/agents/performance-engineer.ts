/**
 * Performance Engineer — measures what matters and enforces budgets:
 * headless tick cost, floor generation, save/restore latency, content load,
 * memory ceilings. Verdict feeds the Director's release gate.
 */
import { Agent } from "../core/agent.js";
import type { ContentPack } from "../../engine/content/types.js";
import { validateContentPack } from "../../engine/content/types.js";
import { Simulation } from "../../engine/sim/simulation.js";
import { generateFloor } from "../../engine/world/procgen.js";
import { snapshot, restoreFromSnapshot } from "../../engine/sim/save.js";
import type { PerfReport } from "../core/blackboard.js";

interface Budget {
  budget: number;
  actual: number;
  pass: boolean;
  unit: string;
}

export class PerformanceEngineerAgent extends Agent {
readonly id = "perf";
  readonly title = "Performance Engineer";
  measure(): PerfReport {
    const pack = this.ctx.board.pack!;
    const budgets: Record<string, Budget> = {};
    const notes: string[] = [];

    // --- Tick cost (headless, mid-fight conditions) ------------------------
    {
      const sim = new Simulation(pack, 9001);
      // Warm-up + measured phase with combat pressure.
      for (let i = 0; i < 600; i++) sim.step({ moveX: Math.sin(i * 0.05), moveY: Math.cos(i * 0.04), attackHeld: i % 8 === 0, dodgePressed: false, interactPressed: false });
      const N = 3000;
      let maxTick = 0;
      let measuredTotal = 0;
      for (let i = 0; i < N; i++) {
        const s0 = performance.now();
        sim.step({ moveX: Math.sin(i * 0.07), moveY: Math.cos(i * 0.05), attackHeld: i % 6 === 0, dodgePressed: false, interactPressed: false });
        const dt = performance.now() - s0;
        // First ~120 samples are JIT warm-up; exclude from stats.
        if (i >= 120) {
          maxTick = Math.max(maxTick, dt);
          measuredTotal += dt;
        }
      }
      const measuredCount = N - 120;
      const avgMs = measuredTotal / measuredCount;
      budgets.tickAvgMs = { budget: 1.5, actual: round3(avgMs), pass: avgMs <= 1.5, unit: "ms" };
      budgets.tickMaxMs = { budget: 25, actual: round3(maxTick), pass: maxTick <= 25, unit: "ms" };
      notes.push(`sim throughput ≈ ${Math.round(1000 / avgMs)} ticks/sec headless`);
    }

    // --- Floor generation ----------------------------------------------------
    {
      const cfg = pack.floors[Math.min(2, pack.floors.length - 1)]!;
      const t0 = performance.now();
      const R = 12;
      for (let i = 0; i < R; i++) generateFloor(pack, cfg, 5000 + i);
      const perGen = (performance.now() - t0) / R;
      budgets.floorGenMs = { budget: 30, actual: round3(perGen), pass: perGen <= 30, unit: "ms" };
    }

    // --- Save / restore -------------------------------------------------------
    {
      const sim = new Simulation(pack, 4242);
      for (let i = 0; i < 1200; i++) sim.step({ moveX: Math.sin(i), moveY: Math.cos(i * 1.3), attackHeld: false, dodgePressed: false, interactPressed: false });
      let t0 = performance.now();
      const snap = snapshot(sim);
      const snapMs = performance.now() - t0;
      budgets.saveMs = { budget: 8, actual: round3(snapMs), pass: snapMs <= 8, unit: "ms" };
      t0 = performance.now();
      restoreFromSnapshot(pack, snap);
      const restMs = performance.now() - t0;
      budgets.restoreMs = { budget: 20, actual: round3(restMs), pass: restMs <= 20, unit: "ms" };
      notes.push(`save size ≈ ${(snap.length / 1024).toFixed(1)} KB`);
    }

    // --- Content load (parse + validate) --------------------------------------
    {
      const raw = JSON.stringify(pack);
      const t0 = performance.now();
      const parsed = JSON.parse(raw);
      validateContentPack(parsed);
      const ms = performance.now() - t0;
      budgets.contentLoadMs = { budget: 40, actual: round3(ms), pass: ms <= 40, unit: "ms" };
    }

    // --- Memory ----------------------------------------------------------------
    const rssMb = process.memoryUsage().rss / 1024 / 1024;
    budgets.rssMb = { budget: 500, actual: round1(rssMb), pass: rssMb <= 500, unit: "MB" };

    const failed = Object.values(budgets).filter((b) => !b.pass);
    const report: PerfReport = {
      verdict: failed.length === 0 ? "PASS" : "REJECT",
      budgets,
      notes,
    };

    this.act("perf.measured", `verdict=${report.verdict} failing=${failed.map((f) => f.actual + f.unit).join(",") || "none"}`);
    this.artifactJson("performance/perf-report.json", report);
    this.ctx.board.perfHistory.push({ iteration: this.ctx.board.iteration, report });
    this.ctx.board.latestPerf = report;

    studioBusEmitPerf(report.verdict, failed.map((f) => `${f.actual}${f.unit} > ${f.budget}${f.unit}`));
    return report;
  }
}

import { studioBus } from "../core/studio-events.js";
function studioBusEmitPerf(verdict: "PASS" | "REJECT", reasons: string[]): void {
  studioBus.emit("perfVerdict", { verdict, reasons });
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
