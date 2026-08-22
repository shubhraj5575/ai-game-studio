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

  runSuiteForBuild(seeds: number[], opts?: { minCoverageFraction?: number }): SuiteReport {
    const pack = this.ctx.board.pack!;
    this.act("suite.start", `seeds=[${seeds.join(", ")}]`);
    const report = runSuite(pack, {
      seeds,
      ...(opts?.minCoverageFraction !== undefined ? { minCoverageFraction: opts.minCoverageFraction } : {}),
    });

    // Gate reasons become synthetic, actionable issues so the fix loop can
    // respond to them (coverage gaps, slow progression).
    if (report.verdict === "REJECT") {
      for (const reason of report.reasons) {
        const untested = reason.match(/untested: (.+)$/);
        if (untested) {
          report.issues.push({
            id: `cov-${untested[1]!.slice(0, 40).replace(/[^a-z]/gi, "-")}`,
            severity: "major",
            kind: "qa-coverage",
            title: `Coverage gap: ${untested[1]}`,
            detail: reason,
            seed: 0,
            frame: 0,
            depth: 0,
          });
        }
        if (reason.includes("mean depth progress")) {
          report.issues.push({
            id: "prog-suite-slow",
            severity: "major",
            kind: "balance",
            title: "Progression too slow across QA suite",
            detail: reason,
            seed: 0,
            frame: 0,
            depth: 0,
          });
        }
      }
    }

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

  /** Register failing scenarios as permanent regression seeds AND pin them as executable tests. */
  recordRegressions(issues: BugIssue[], rootDir?: string): void {
    for (const issue of issues) {
      if (!["crash", "invariant", "save-load", "progression-blocker"].includes(issue.kind)) continue;
      const existing = this.regressionSeeds.find((r) => r.seed === issue.seed);
      if (existing) continue;

      const rec: RegressionRecord = {
        seed: issue.seed,
        issueId: issue.id,
        testPath: `tests/regression/regression-seed-${issue.seed}.test.ts`,
        addedAtIso: new Date().toISOString(),
      };

      // Write the executable regression test so vitest pins this scenario forever.
      if (rootDir) {
        writeTestFile(join(rootDir, rec.testPath), issue.seed, issue.title);
      }

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
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { runSeed } from "../../qa/harness.js";
import { DEFAULT_SEED_OPTIONS } from "../../qa/harness.js";

function runSeedQuick(pack: ContentPack, seed: number, maxTicks: number): BugIssue[] {
  const res = runSeed(pack, seed, { ...DEFAULT_SEED_OPTIONS, maxTicks });
  return res.issues;
}

/**
 * Emit a vitest file that replays the failing scenario against the shipped
 * content pack and asserts it stays fixed. Deterministic seeds make this a
 * hard pin, not a smoke test.
 */
function writeTestFile(path: string, seed: number, title: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const content = `/**
 * REGRESSION PIN — generated by the QA Engineer agent.
 * Original failure: ${title.replace(/\*\//g, "*\\/")}
 * Scenario: objective-bot playthrough of seed ${seed} must never produce
 * crash / invariant / save-load blockers. If this test fails, a previously
 * fixed engine bug has regressed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContentPack } from "../../../src/engine/content/types.js";
import { runSeed } from "../../../src/qa/harness.js";
import { DEFAULT_SEED_OPTIONS } from "../../../src/qa/harness.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pack = JSON.parse(readFileSync(join(root, "content", "pack.json"), "utf8")) as ContentPack;

describe(\`regression seed ${seed}\`, () => {
  it(\`completes without crash/invariant/save-load blockers\`, () => {
    const result = runSeed(pack, ${seed}, {
      ...DEFAULT_SEED_OPTIONS,
      maxTicks: 60 * 60 * 10,
    });
    const bad = result.issues.filter(
      (i) => i.severity === "blocker" || i.kind === "crash" || i.kind === "invariant" || i.kind === "save-load",
    );
    expect(bad.map((b) => b.title)).toEqual([]);
  });
});
`;
  writeFileSync(path, content);
}

import { studioBus } from "../core/studio-events.js";
function studioBusEmitQa(verdict: "PASS" | "REJECT", reasons: string[]): void {
  studioBus.emit("qaVerdict", { verdict, reasons });
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
