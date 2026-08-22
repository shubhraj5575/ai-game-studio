/**
 * Studio Pipeline — the autonomous production line.
 *
 *   BRIEF → DESIGN → IMPLEMENT → BUILD → QA → PERFORMANCE
 *     └────────────(TRIAGE → FIX → BUILD → QA)*────────────┘
 *   → REVIEW (Director gate) → RELEASE
 *
 * Every phase writes artifacts + structured logs + metrics; the fix loop is
 * real: QA findings route through the Director's triage into the Programmer's
 * guardrailed data fixes, regression scenarios get pinned as executable
 * tests, and the Director can refuse to ship.
 */
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Rng } from "../engine/core/rng.js";
import { Logger } from "./core/logger.js";
import { Metrics } from "./core/metrics.js";
import { ArtifactStore } from "./core/artifacts.js";
import { Blackboard } from "./core/blackboard.js";
import type { AgentContext } from "./core/agent.js";
import { studioBus } from "./core/studio-events.js";
import type { StudioPhase } from "./core/studio-events.js";

import { GameDirectorAgent } from "./agents/game-director.js";
import { GameDesignerAgent } from "./agents/game-designer.js";
import { NarrativeDesignerAgent } from "./agents/narrative-designer.js";
import { SystemsDesignerAgent } from "./agents/systems-designer.js";
import { LevelDesignerAgent } from "./agents/level-designer.js";
import { AssetManagerAgent } from "./agents/asset-manager.js";
import { AudioManagerAgent } from "./agents/audio-manager.js";
import { ProgrammerAgent } from "./agents/programmer.js";
import { QAEngineerAgent } from "./agents/qa-engineer.js";
import { PerformanceEngineerAgent } from "./agents/performance-engineer.js";
import { ReleaseManagerAgent } from "./agents/release-manager.js";

import { deriveEnemyDefs, deriveItemDefs } from "./compile-content.js";

export interface StudioOptions {
  rootDir?: string;
  outDirName?: string;
  seeds?: number[];
  maxFixLoops?: number;
  skipBuild?: boolean;
  quietConsole?: boolean;
  /** Optional stricter QA coverage gate (0..1) — used by tests of the loop itself. */
  minCoverageGate?: number;
}

export interface StudioRunResult {
  ok: boolean;
  runId: string;
  version: string | null;
  qaVerdict: string;
  perfVerdict: string;
  fixIterations: number;
  engineIssues: number;
  artifactsDir: string;
}

export function runStudio(options: StudioOptions = {}): StudioRunResult {
  const rootDir = options.rootDir ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = join(rootDir, "studio-output", options.outDirName ?? runId);

  const log = new Logger();
  if (options.quietConsole) log.setConsoleLevel("warn");
  log.useFile(join(runDir, "logs"));
  const metrics = new Metrics();
  const artifacts = new ArtifactStore(runDir);
  const board = new Blackboard();
  const rng = new Rng(Date.now() ^ 0x5eed1234);

  const ctx: AgentContext = { log, metrics, artifacts, board, rng, runDir };

  const director = new GameDirectorAgent();
  const designer = new GameDesignerAgent();
  const narrative = new NarrativeDesignerAgent();
  const systems = new SystemsDesignerAgent();
  const levels = new LevelDesignerAgent();
  const assets = new AssetManagerAgent();
  const audio = new AudioManagerAgent();
  const programmer = new ProgrammerAgent();
  const qa = new QAEngineerAgent();
  const perf = new PerformanceEngineerAgent();
  const release = new ReleaseManagerAgent();

  for (const a of [director, designer, narrative, systems, levels, assets, audio, programmer, qa, perf, release]) {
    a.bind(ctx);
  }

  // Audit trail of phases → run-report.
  const phaseLog: Array<{ phase: string; ms: number; ok: boolean }> = [];
  let currentPhase: StudioPhase = "brief";
  const t0 = performance.now();

  studioBus.on("qaVerdict", () => {});
  studioBus.emit("runStarted", { runId, startedAt: new Date().toISOString() });
  log.info(`STUDIO RUN ${runId} starting`, { rootDir, runDir });

  const enter = (phase: StudioPhase): void => {
    currentPhase = phase;
    studioBus.emit("phaseEntered", { phase, iteration: board.iteration });
    log.pushScope(phase);
    log.info(`→ ${phase.toUpperCase()}`);
  };
  const exit = (ok: boolean): void => {
    studioBus.emit("phaseExited", { phase: currentPhase, iteration: board.iteration, durationMs: 0, ok });
    log.popScope();
  };

  let result: StudioRunResult;

  try {
    // ------------------------------------------------------------------ BRIEF
    metrics.time("phase.brief", () => {
      enter("brief");
      director.brief(rng.getState());
      exit(true);
      phaseLog.push({ phase: "brief", ms: 0, ok: true });
    });

    // ----------------------------------------------------------------- DESIGN
    metrics.time("phase.design", () => {
      enter("design");
      const gdd = designer.design();
      const review = director.reviewDesign(gdd);
      if (!review.approved) {
        // One bounded revision pass (the designer satisfies structural gates).
        designer.act("gdd.revision", review.feedback.join("; "));
        const gdd2 = designer.design();
        const review2 = director.reviewDesign(gdd2);
        if (!review2.approved) throw new Error(`Design gate failed twice: ${review2.feedback.join("; ")}`);
      }

      // Concrete content derivation.
      const brief = board.brief!;
      const enemies = deriveEnemyDefs(rng, brief.targetDepthCount);
      const items = deriveItemDefs();
      levels.provideEnemies(enemies);
      const floors = levels.author(brief.targetDepthCount, brief.difficultyIntent);
      const narrativeTables = narrative.write({ toneWords: brief.toneWords }, floors);
      assets.assignEnemyVisuals(enemies);
      const tuning = systems.derive(brief.targetDepthCount, brief.difficultyIntent);

      board.packDraft = {
        meta: {
          title: gdd.title,
          tagline: narrativeTables.premise.split(".")[0] + ".",
          version: "0.0.0",
          patch: 0,
          seedBase: rng.getState(),
          generator: "ai-game-studio",
          createdAtIso: new Date().toISOString(),
        },
        palette: assets.designPalette(Math.floor(rng.next() * 360)),
        systems: tuning,
        enemies,
        items,
        lootTables: lootTablesFor(items),
        questTemplates: questTemplatesFromBank(),
        npcDefs: npcDefsFromBank(),
        floors,
        narrative: narrativeTables,
        audio: audio.author(brief.targetDepthCount, brief.toneWords),
        eliteAffixes: structuredClone(ELITE_AFFIXES),
      };

      // Level validation sweep against the draft pack.
      board.pack = board.packDraft;
      const lvlCheck = levels.validate(board.pack!, 10, 3);
      if (!lvlCheck.passed) {
        log.warn("level quality gates did not fully converge; continuing with best config");
      }
      exit(true);
      phaseLog.push({ phase: "design", ms: 0, ok: true });
    });

    // -------------------------------------------------------------- IMPLEMENT
    metrics.time("phase.implement", () => {
      enter("implement");
      const pack = programmer.integrate(board.packDraft!);
      programmer.writeRepoOutputs(rootDir, renderFullGddDoc(board));
      exit(true);
      phaseLog.push({ phase: "implement", ms: 0, ok: true });
    });

    // ------------------------------------------------------------------ BUILD
    if (!options.skipBuild) {
      metrics.time("phase.build", () => {
        enter("build");
        execFileSync("npx", ["tsx", "tools/build-game.ts"], { cwd: rootDir, stdio: "pipe" });
        const manifestPath = join(rootDir, "dist", "build-info.json");
        const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
        studioBus.emit("buildProduced", { distDir: join(rootDir, "dist"), manifest });
        log.info("build complete", { manifest });
        exit(true);
        phaseLog.push({ phase: "build", ms: 0, ok: true });
      });
    }

    // --------------------------------------------------------------- QA loops
    const maxLoops = options.maxFixLoops ?? 3;
    let seeds = options.seeds ?? [101, 202, 303];

    metrics.time("phase.qa-and-fix", () => {
      enter("qa");
      qa.writeTestPlan();
      const gate = options.minCoverageGate;
      let report = qa.runSuiteForBuild(seeds, gate !== undefined ? { minCoverageFraction: gate } : undefined);
      perf.measure();

      let loopIter = 0;
      while ((report.verdict !== "PASS" || board.latestPerf!.verdict !== "PASS") && loopIter < maxLoops) {
        loopIter++;
        exit(false);
        enter("triage");
        const allIssues = [...report.issues];
        if (board.latestPerf!.verdict === "REJECT") {
          allIssues.push(...perfIssuesAsBugs(board.latestPerf!));
        }
        const { autoFixable, engineLevel } = director.triage(allIssues);
        board.openIssues = allIssues.map((i) => i);
        board.engineIssues = engineLevel;
        qa.recordRegressions(allIssues.filter((i) => i.severity === "blocker"), rootDir);
        exit(true);

        enter("fix");
        const applied = programmer.applyFixes(board.pack!, autoFixable, loopIter);
        if (applied.length === 0 && engineLevel.length > 0) {
          log.error("no auto-fixable strategies left and engine issues remain — stopping loop");
          break;
        }
        // Persist patched content + rebuild + widen QA.
        programmer.writeRepoOutputs(rootDir, renderFullGddDoc(board));
        if (!options.skipBuild) {
          execFileSync("npx", ["tsx", "tools/build-game.ts"], { cwd: rootDir, stdio: "pipe" });
        }
        exit(true);

        enter("qa");
        seeds = [...seeds, ...widenSeeds(seeds)].slice(0, 6);
        report = qa.runSuiteForBuild(seeds, gate !== undefined ? { minCoverageFraction: gate } : undefined);
        perf.measure();
      }
      exit(true);
      phaseLog.push({ phase: "qa-and-fix", ms: 0, ok: true });
    });

    // ----------------------------------------------------------------- REVIEW
    metrics.time("phase.review", () => {
      enter("review");
      const gate = director.gateRelease();
      exit(gate.approved);
      phaseLog.push({ phase: "review", ms: 0, ok: gate.approved });
    });

    // ---------------------------------------------------------------- RELEASE
    let releasedVersion: string | null = null;
    if (board.directorApproval?.approved) {
      metrics.time("phase.release", () => {
        enter("release");
        const rel = release.release(rootDir);
        releasedVersion = rel.version;
        // Rebuild so dist/ carries the released version + matching checksums.
        if (!options.skipBuild) {
          execFileSync("npx", ["tsx", "tools/build-game.ts"], { cwd: rootDir, stdio: "pipe" });
          const manifestPath = join(rootDir, "dist", "build-info.json");
          const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
          studioBus.emit("buildProduced", { distDir: join(rootDir, "dist"), manifest });
        }
        exit(true);
        phaseLog.push({ phase: "release", ms: 0, ok: true });
      });
    }

    const wallSec = (performance.now() - t0) / 1000;
    result = {
      ok: !!board.directorApproval?.approved,
      runId,
      version: releasedVersion,
      qaVerdict: board.latestQa?.verdict ?? "none",
      perfVerdict: board.latestPerf?.verdict ?? "none",
      fixIterations: Math.max(0, board.qaHistory.length - 1),
      engineIssues: board.engineIssues.length,
      artifactsDir: artifacts.dir,
    };

    studioBus.emit("runFinished", {
      ok: result.ok,
      summary: { ...result, wallSec: round2(wallSec) },
    });

    // Run summary artifact.
    artifacts.putJson("run-summary.json", { ...result, wallSec: round2(wallSec), phases: phaseLog });
    artifacts.put(
      "run-report.md",
      renderRunReport(result, board, wallSec),
    );
    metrics.exportText(join(runDir, "logs"));

    // Persist pointer for the next sprint's Director memory.
    try {
      writeFileSync(
        join(rootDir, "studio-output", "LATEST.json"),
        JSON.stringify({
          ok: result.ok,
          version: result.version,
          fixIterations: result.fixIterations,
          victoryRate: board.latestQa?.aggregate.victoryRate,
          runId,
          atIso: new Date().toISOString(),
        }, null, 2) + "\n",
      );
    } catch { /* never crash on bookkeeping */ }

    appendOvernightLog(rootDir, result, board);
    log.info(`RUN COMPLETE ok=${result.ok} v${result.version ?? "-"}`);
  } catch (err) {
    log.error("RUN FAILED", { error: err instanceof Error ? err.stack : String(err) });
    artifacts.putJson("run-summary.json", {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      phase: currentPhase,
    });
    metrics.exportText(join(runDir, "logs"));
    result = {
      ok: false,
      runId,
      version: null,
      qaVerdict: board.latestQa?.verdict ?? "none",
      perfVerdict: board.latestPerf?.verdict ?? "none",
      fixIterations: Math.max(0, board.qaHistory.length - 1),
      engineIssues: board.engineIssues.length,
      artifactsDir: artifacts.dir,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { ContentPack, ItemDef, LootTableDef, NpcDef, QuestTemplate } from "../engine/content/types.js";
import type { BugIssue } from "../qa/issues.js";
import { makeIssueId } from "../qa/issues.js";
import { QUEST_TEMPLATES, NPC_BANK, ELITE_AFFIXES } from "./content-banks.js";

function perfIssuesAsBugs(report: { budgets: Record<string, { actual: number; budget: number; pass: boolean }> }): BugIssue[] {
  const out: BugIssue[] = [];
  for (const [name, b] of Object.entries(report.budgets)) {
    if (!b.pass) {
      out.push({
        id: makeIssueId(0, 0),
        severity: "major",
        kind: "performance",
        title: `Budget breach: ${name}`,
        detail: `${b.actual} exceeds ${b.budget}`,
        seed: 0,
        frame: 0,
        depth: 0,
      });
    }
  }
  return out;
}

/** Full GDD document for the repo (GDD + generated content summary). */
function renderFullGddDoc(board: Blackboard): string {
  const gdd = board.gdd;
  const pack = board.pack ?? board.packDraft;
  const lines: string[] = [];
  if (gdd) {
    lines.push(renderGddMarkdownForDoc(gdd));
  } else {
    lines.push("# Game Design Document", "", "(GDD artifact missing)", "");
  }
  if (pack) {
    lines.push("---", "", "## Generated Content Summary", "");
    lines.push(`- **Title:** ${pack.meta.title}`);
    lines.push(`- **Depths:** ${pack.floors.length} (${pack.floors.map((f) => `B${f.depth}${f.bossId ? "☠" : ""}`).join(", ")})`);
    lines.push(`- **Enemies:** ${pack.enemies.map((e) => e.name).join(", ")}`);
    lines.push(`- **Items:** ${pack.items.length} across rarities`);
    lines.push(`- **Quests:** ${pack.questTemplates.map((q) => q.kind).join(", ")} templates`);
    lines.push(`- **NPCs:** ${pack.npcDefs.map((n) => n.firstNamePool[0]).join(", ")}`);
    lines.push("");
    lines.push("### Systems tuning highlights", "");
    lines.push(`| Knob | Value |`, `|---|---|`);
    lines.push(`| Player HP | ${pack.systems.player.baseMaxHp} |`);
    lines.push(`| Player damage | ${pack.systems.player.baseDamage} |`);
    lines.push(`| XP curve | base ${pack.systems.xpCurve.base}, growth ${pack.systems.xpCurve.growth} |`);
    lines.push(`| Depth HP scale | +${Math.round(pack.systems.depthHpScale * 100)}%/depth |`);
    lines.push(`| Depth damage scale | +${Math.round(pack.systems.depthDamageScale * 100)}%/depth |`);
    lines.push("");
    lines.push("### Floor plan", "");
    lines.push("| Depth | Size | Rooms | Budget | Key | Boss | Shrine | NPCs | Quests |", "|---|---|---|---|---|---|---|---|---|");
    for (const f of pack.floors) {
      lines.push(
        `| B${f.depth} | ${f.mapWidth}×${f.mapHeight} | ${f.roomTargetMin}–${f.roomTargetMax} | ${f.enemyBudgetBase.toFixed(1)}+${f.enemyBudgetPerDepth}/d | ${f.keyRequired ? "✔" : "—"} | ${f.bossId ?? "—"} | ${f.hasShrine ? "✔" : "—"} | ${f.npcIds.length} | ${f.questCount} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

// Minimal markdown renderer reusing the designer's format via import.
import { renderGddMarkdownForDoc } from "./agents/game-designer.js";

function lootTablesFor(items: ItemDef[]): LootTableDef[] {
  const byRarity = (rs: string[]): ItemDef[] => items.filter((i) => rs.includes(i.rarity) && i.kind !== "quest");
  return [
    {
      id: "chest-default",
      entries: [
        ...weighted(byRarity(["common"]), 26),
        ...weighted(byRarity(["uncommon"]), 14),
        ...weighted(byRarity(["rare"]), 7),
        ...weighted(byRarity(["epic"]), 3),
      ],
    },
    {
      id: "enemy-default",
      entries: [
        ...weighted(items.filter((i) => i.kind === "potion"), 55),
        ...weighted(byRarity(["common"]), 22),
        ...weighted(byRarity(["rare", "epic"]), 4),
      ],
    },
  ];
}

function weighted(items: ItemDef[], weight: number): Array<{ itemId: string; weight: number }> {
  return items.map((i) => ({ itemId: i.id, weight }));
}

function questTemplatesFromBank(): QuestTemplate[] {
  return structuredClone(QUEST_TEMPLATES) as unknown as QuestTemplate[];
}

function npcDefsFromBank(): NpcDef[] {
  return structuredClone(NPC_BANK) as unknown as NpcDef[];
}

function widenSeeds(current: number[]): number[] {
  const base = current.reduce((a, b) => a + b, 0);
  return [base % 997 + 11, (base * 7) % 883 + 17];
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function renderRunReport(r: StudioRunResult, board: Blackboard, wallSec: number): string {
  const lines: string[] = [];
  lines.push(`# Studio Run Report — ${r.runId}`, "");
  lines.push(`**Outcome:** ${r.ok ? "RELEASED ✅" : "BLOCKED ❌"}${r.version ? ` · v${r.version}` : ""}`);
  lines.push("");
  lines.push("| Gate | Result |", "|---|---|");
  lines.push(`| QA | ${r.qaVerdict} |`);
  lines.push(`| Performance | ${r.perfVerdict} |`);
  lines.push(`| Fix iterations | ${r.fixIterations} |`);
  lines.push(`| Engine-level issues | ${r.engineIssues} |`);
  lines.push(`| Wall time | ${wallSec.toFixed(1)}s |`);
  lines.push("");
  if (board.fixes.length > 0) {
    lines.push("## Fix history", "");
    for (const f of board.fixes) {
      lines.push(`- **iter ${f.iteration} \`${f.strategy}\`** — ${f.rationale}`);
      lines.push(`  - before: \`${f.before.slice(0, 120)}\``);
      lines.push(`  - after: \`${f.after.slice(0, 120)}\``);
    }
    lines.push("");
  }
  const qa = board.latestQa;
  if (qa) {
    lines.push("## Latest QA", "");
    lines.push(`- Verdict: ${qa.verdict}; reasons: ${qa.reasons.join("; ") || "—"}`);
    lines.push(`- Victory ${(qa.aggregate.victoryRate * 100).toFixed(0)}% · coverage ${(qa.aggregate.coverageFraction * 100).toFixed(0)}% · avg tick ${qa.aggregate.avgTickMs.toFixed(3)}ms`);
    lines.push("");
  }
  if (board.engineIssues.length > 0) {
    lines.push("## Engine-level issues requiring human engineers", "");
    for (const i of board.engineIssues) lines.push(`- [${i.severity}/${i.kind}] ${i.title} — ${i.detail.slice(0, 200)}`);
    lines.push("");
  }
  return lines.join("\n");
}

function appendOvernightLog(rootDir: string, r: StudioRunResult, _board: Blackboard): void {
  const path = join(rootDir, "OVERNIGHT_LOG.md");
  const stamp = new Date().toISOString();
  const entry = [
    "",
    `## Studio run — ${stamp}`,
    "",
    `- Outcome: **${r.ok ? "released" : "blocked"}**${r.version ? ` at v${r.version}` : ""}`,
    `- QA: ${r.qaVerdict} · Perf: ${r.perfVerdict} · fix iterations: ${r.fixIterations} · engine issues: ${r.engineIssues}`,
    `- Artifacts: ${r.artifactsDir}`,
    "",
  ].join("\n");
  try {
    if (!existsSync(path)) {
      writeFileSync(path, "# Overnight Log\n");
    }
    appendFileSync(path, entry);
  } catch {
    // never crash the run on logging
  }
}
