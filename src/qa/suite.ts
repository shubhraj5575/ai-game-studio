/**
 * QA suite orchestration and verdicts.
 *
 * The QA Engineer agent runs suites; a REJECT verdict blocks release.
 */
import type { ContentPack } from "../engine/content/types.js";
import { runSeed } from "./harness.js";
import type { SeedResult, SeedRunOptions } from "./harness.js";
import { DEFAULT_SEED_OPTIONS } from "./harness.js";
import type { BugIssue, CoverageFlags } from "./issues.js";

export interface SuiteOptions extends Partial<SeedRunOptions> {
  seeds: number[];
  /** Required fraction of coverage flags that must be true across the suite. */
  minCoverageFraction?: number;
  /** Minimum mean depth progress (fraction of total floors). */
  minMeanDepthProgress?: number;
}

export const DEFAULT_SUITE_OPTIONS: SuiteOptions = {
  seeds: [101, 202, 303],
  minCoverageFraction: 0.5,
  minMeanDepthProgress: 0.6,
};

export type Verdict = "PASS" | "REJECT";

export interface SuiteReport {
  verdict: Verdict;
  reasons: string[];
  seeds: SeedResult[];
  issues: BugIssue[];
  aggregate: {
    victoryRate: number;
    crashRate: number;
    blockerCount: number;
    majorCount: number;
    minorCount: number;
    meanDepthProgress: number;
    totalTicks: number;
    avgTickMs: number;
    p95TickMs: number;
    maxTickMs: number;
    peakRssMb: number;
    coverage: CoverageFlags;
    coverageFraction: number;
    wallSeconds: number;
  };
}

export function runSuite(pack: ContentPack, options: SuiteOptions = DEFAULT_SUITE_OPTIONS): SuiteReport {
  const opts: SeedRunOptions = {
    ...DEFAULT_SEED_OPTIONS,
    ...Object.fromEntries(
      Object.entries(options).filter(([k]) => k !== "seeds" && k !== "minCoverageFraction" && k !== "minMeanDepthProgress"),
    ),
  } as SeedRunOptions;

  const seeds = options.seeds ?? DEFAULT_SUITE_OPTIONS.seeds!;
  const results: SeedResult[] = [];
  const allIssues: BugIssue[] = [];

  for (const seed of seeds) {
    const r = runSeed(pack, seed, opts);
    results.push(r);
    allIssues.push(...r.issues);
  }

  // ---- Aggregation ---------------------------------------------------------
  const totalFloors = pack.floors.length || 1;
  const victories = results.filter((r) => r.outcome === "victory").length;
  const crashes = results.filter((r) => r.outcome === "crashed" || r.issues.some((i) => i.kind === "crash")).length;
  const blockers = allIssues.filter((i) => i.severity === "blocker");
  const majors = allIssues.filter((i) => i.severity === "major");
  const minors = allIssues.filter((i) => i.severity === "minor");

  const coverage: CoverageFlags = {} as CoverageFlags;
  const keys = Object.keys(results[0]?.coverage ?? {}) as Array<keyof CoverageFlags>;
  for (const k of keys) coverage[k] = results.some((r) => r.coverage[k]);
  const trueFlags = keys.filter((k) => coverage[k]).length;
  const coverageFraction = keys.length > 0 ? trueFlags / keys.length : 1;

  const meanDepthProgress =
    results.reduce((acc, r) => acc + Math.min(r.depthReached / totalFloors, 1), 0) / Math.max(results.length, 1);

  const totalTicks = results.reduce((a, r) => a + r.ticksUsed, 0);
  const wallSeconds = results.reduce((a, r) => a + r.perf.wallSeconds, 0);
  const weightedAvgTick =
    results.reduce((a, r) => a + r.perf.avgTickMs * r.ticksUsed, 0) / Math.max(totalTicks, 1);
  const maxP95 = Math.max(0, ...results.map((r) => r.perf.p95TickMs));
  const overallMax = Math.max(0, ...results.map((r) => r.perf.maxTickMs));
  const peakRss = Math.max(0, ...results.map((r) => r.perf.peakRssMb));

  // ---- Verdict ---------------------------------------------------------------
  const reasons: string[] = [];
  let verdict: Verdict = "PASS";

  if (blockers.length > 0) {
    verdict = "REJECT";
    reasons.push(`${blockers.length} blocker issue(s): ${blockers.slice(0, 3).map((b) => b.title).join("; ")}`);
  }
  if (crashes > 0) {
    verdict = "REJECT";
    reasons.push(`${crashes} run(s) crashed`);
  }
  const minCov = options.minCoverageFraction ?? DEFAULT_SUITE_OPTIONS.minCoverageFraction!;
  if (coverageFraction < minCov) {
    verdict = "REJECT";
    reasons.push(
      `QA coverage ${Math.round(coverageFraction * 100)}% below required ${Math.round(minCov * 100)}% — systems untested: ` +
        keys.filter((k) => !coverage[k]).join(", "),
    );
  }
  const minDepth = options.minMeanDepthProgress ?? DEFAULT_SUITE_OPTIONS.minMeanDepthProgress!;
  if (meanDepthProgress < minDepth) {
    verdict = "REJECT";
    reasons.push(
      `mean depth progress ${Math.round(meanDepthProgress * 100)}% below gate ${Math.round(minDepth * 100)}% — possible progression blocker or balance failure`,
    );
  }
  if (weightedAvgTick > opts.perfTickBudgetMs * 2) {
    verdict = "REJECT";
    reasons.push(`average tick ${weightedAvgTick.toFixed(3)}ms exceeds 2x budget (${opts.perfTickBudgetMs}ms)`);
  }

  return {
    verdict,
    reasons,
    seeds: results,
    issues: allIssues,
    aggregate: {
      victoryRate: results.length ? victories / results.length : 0,
      crashRate: results.length ? crashes / results.length : 0,
      blockerCount: blockers.length,
      majorCount: majors.length,
      minorCount: minors.length,
      meanDepthProgress,
      totalTicks,
      avgTickMs: weightedAvgTick,
      p95TickMs: maxP95,
      maxTickMs: overallMax,
      peakRssMb: peakRss,
      coverage,
      coverageFraction,
      wallSeconds,
    },
  };
}
