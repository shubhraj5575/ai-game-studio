/**
 * QA Engineer — builds a test plan from the GDD, executes real playthrough
 * suites through the headless harness, manages the regression suite, and
 * issues verdicts. QA can (and will) REJECT a build.
 */
import { Agent } from "../core/agent.js";
import type { ContentPack } from "../../engine/content/types.js";
import { runSuite } from "../../qa/suite.js";
import type { SuiteReport } from "../../qa/suite.js";
import type { BugIssue } from "../../qa/issues.js";
import type { RegressionRecord } from "../core/blackboard.js";

export class QAEngineerAgent extends Agent {
readonly id = "qa";
  readonly title = "QA Engineer";
  private regressionSeeds: Array<{ seed: number; label: string }> = [];

  writeTestPlan(): void {
    const gdd = this.ctx.board.gdd!;
    this.artifactJson("qa/test-plan.json", {
      strategy: "headless bot playthroughs + invariant sweeps + save determinism spot checks",
      coverageGoals: gdd.coverageGoals,
      gates: {
        blockersAllowed: 0,
        crashesAllowed: 0,
        minCoverageFraction: 0.5,
        minMeanDepthProgress: 0.6,
      },
      seedPolicy: "3 seeds first pass; widen to 6 when a fix iteration occurs",
    });
    this.act("testPlan.authored");
  }

  runSuiteForBuild(seeds: number[]): SuiteReport {
    const pack = this.ctx.board.pack!;
    this.act("suite.start", `seeds=[${seeds.join(", ")}]`);
    const report = runSuite(pack, { seeds });
    this.ctx.board.qaHistory.push({ iteration: this.ctx.board.iteration, report });
    this.ctx.board.latestQa = report;

    studioBusEmitQa(report.verdict, report.reasons);
    for (const issue of report.issues) {
      studioBus.emit("issueFound", { id: issue.id, severity: issue.severity, kind: issue.kind, title: issue.title });
    }

    this.act("suite.done", `verdict=${report.verdict} blockers=${report.aggregate.blockerCount} victoryRate=${report.aggregate.victoryRate.toFixed(2)}`);
    this.artifactJson(`qa/qa-report-iter-${this.ctx.board.iteration}.json`, summarize(report));
    this.artifact(`qa/qa-report-iter-${this.ctx.board.iteration}.md`, renderReportMd(report));
    return report;
  }

  /** Register failing scenarios as permanent regression seeds. */
  recordRegressions(issues: BugIssue[]): void {
    for (const issue of issues) {
      if (!["crash", "invariant", "save-load", "progression-blocker"].includes(issue.kind)) continue;
      if (this.regressionSeeds.some((r) => r.seed === issue.seed && r.label === issue.kind)) continue;
      const rec: RegressionRecord = {
        seed: issue.seed,
        issueId: issue.id,
        testPath: `tests/regression/${slug(`seed-${issue.seed}-${issue.kind}`)}.test.ts`,
        addedAtIso: new Date().toISOString(),
      };
      this.ctx.board.regressions.push(rec);
      this.regressionSeeds.push({ seed: issue.seed, label: issue.kind });
      studioBus.emit("regressionRecorded", { seed: issue.seed, issueId: issue.id, testPath: rec.testPath });
      this.act("regression.recorded", `${rec.testPath} (${issue.title})`);
    }
  }

  /** Re-run every pinned regression scenario against the current pack. */
  verifyRegressions(maxTicksPerSeed = 60 * 60 * 4): string[] {
    const pack = this.ctx.board.pack!;
    const failures: string[] = [];
    for (const r of this.regressionSeeds) {
      const result = runSeedQuick(pack, r.seed, maxTicksPerSeed);
      const bad = result.filter(
        (i) => ["crash", "invariant", "save-load"].includes(i.kind),
      );
      if (bad.length > 0) failures.push(`${r.label}#${r.seed}: ${bad[0]!.title}`);
    }
    if (this.regressionSeeds.length > 0) {
      this.act("regression.verified", `${this.regressionSeeds.length} pinned, ${failures.length} failing`);
    }
    return failures;
  }
}

// Local import to avoid pulling perf-heavy module graph at agent construction.
import { runSeed } from "../../qa/harness.js";
import { DEFAULT_SEED_OPTIONS } from "../../qa/harness.js";
function runSeedQuick(pack: ContentPack, seed: number, maxTicks: number): BugIssue[] {
  const res = runSeed(pack, seed, { ...DEFAULT_SEED_OPTIONS, maxTicks, invariantCadence: 30, feasibilityCadence: 600 });
  return res.issues;
}

import { studioBus } from "../core/studio-events.js";
function studioBusEmitQa(verdict: "PASS" | "REJECT", reasons: string[]): void {
  studioBus.emit("qaVerdict", { verdict, reasons });
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function summarize(r: SuiteReport): object {
  return {
    verdict: r.verdict,
    reasons: r.reasons,
    aggregate: r.aggregate,
    perSeed: r.seeds.map((s) => ({
      seed: s.seed,
      outcome: s.outcome,
      depth: s.depthReached,
      ticks: s.ticksUsed,
      kills: s.kills,
      issues: s.issues.length,
      avgTickMs: Number(s.perf.avgTickMs.toFixed(4)),
    })),
    issues: r.issues.map((i) => ({
      id: i.id, severity: i.severity, kind: i.kind, title: i.title,
      detail: i.detail.slice(0, 300), seed: i.seed, frame: i.frame,
    })),
  };
}

function renderReportMd(r: SuiteReport): string {
  const a = r.aggregate;
  const lines = [
    `# QA Report — Verdict: **${r.verdict}**`,
    "",
    ...(r.reasons.length ? ["## Reasons", "", ...r.reasons.map((x) => `- ${x}`), ""] : []),
    "## Aggregates",
    "",
    `- Victory rate: ${(a.victoryRate * 100).toFixed(0)}%`,
    "- Crash rate: " + (a.crashRate * 100).toFixed(0) + "%",
    `- Mean depth progress: ${(a.meanDepthProgress * 100).toFixed(0)}%`,
    `- Issues: ${a.blockerCount} blocker / ${a.majorCount} major / ${a.minorCount} minor`,
    `- Coverage fraction: ${(a.coverageFraction * 100).toFixed(0)}%`,
    `- Avg tick: ${a.avgTickMs.toFixed(3)}ms · p95: ${a.p95TickMs.toFixed(3)}ms · peak RSS: ${a.peakRssMb.toFixed(0)}MB`,
    "",
    "## Per-seed",
    "",
    "| Seed | Outcome | Depth | Ticks | Kills | Issues |",
    "|---|---|---|---|---|---|",
    ...r.seeds.map((s) => `| ${s.seed} | ${s.outcome} | ${s.depthReached} | ${s.ticksUsed} | ${s.kills} | ${s.issues.length} |`),
    "",
  ];
  if (r.issues.length > 0) {
    lines.push("## Top issues", "");
    for (const i of r.issues.slice(0, 12)) lines.push(`- [${i.severity}/${i.kind}] ${i.title} (seed ${i.seed} @f${i.frame})`);
    lines.push("");
  }
  return lines.join("\n");
}
