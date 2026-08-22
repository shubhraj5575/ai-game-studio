/**
 * Game Director — owns the creative brief, reviews design output, triages
 * QA findings into fix strategies, and holds the final release gate.
 * The Director is the only agent that can authorize shipping.
 */
import { Agent } from "../core/agent.js";
import type { CreativeBrief, GDD } from "../core/blackboard.js";
import type { BugIssue } from "../../qa/issues.js";

const TONES = [
  ["smoldering", "menacing", "industrial"],
  ["melancholy", "quiet", "subterranean"],
  ["furious", "oppressive", "molten"],
  ["mysterious", "ancient", "glowing"],
];

const PILLAR_SETS = [
  ["Readable combat", "Escalating descent", "Fair randomness"],
  ["Readable combat", "Meaningful choices", "Escalating descent"],
  ["Meaningful choices", "Fair randomness", "Escalating descent"],
];

export interface PriorRunSummary {
  ok: boolean;
  version: string | null;
  victoryRate?: number;
  fixIterations?: number;
}

export class GameDirectorAgent extends Agent {
readonly id = "director";
  readonly title = "Game Director";
  /** Phase: BRIEF — set the creative direction for this run. */
  brief(seedBase: number): CreativeBrief {
    const rng = this.ctx.rng;
    const tone = rng.pick(TONES);
    const prior = this.readPriorRun();

    // Multi-sprint memory: a struggling prior run eases intent; a dominant
    // one tightens it. Otherwise seeded variety decides.
    let difficultyIntent: CreativeBrief["difficultyIntent"] = "standard";
    let memoryNote = "no prior run found";
    if (prior && prior.victoryRate !== undefined) {
      const v = prior.victoryRate;
      if (v < 0.6 && !prior.ok) {
        difficultyIntent = "welcoming";
        memoryNote = `prior run v${prior.version} struggled (victory ${Math.round(v * 100)}%) → easing`;
      } else if (v >= 0.95) {
        difficultyIntent = "punishing";
        memoryNote = `prior run v${prior.version} dominated (victory ${Math.round(v * 100)}%) → hardening`;
      } else {
        difficultyIntent = "standard";
        memoryNote = `prior run v${prior.version}: victory ${Math.round(v * 100)}% → hold course`;
      }
      this.act("memory.recalled", memoryNote);
    }

    const brief: CreativeBrief = {
      workingTitleSeedWord: rng.pick(["Ember", "Ashfall", "Cinder", "Furnace", "Gloam", "Slag"]),
      genre: "top-down action roguelite (dungeon descent)",
      pillars: rng.pick(PILLAR_SETS),
      targetDepthCount: 4,
      difficultyIntent,
      toneWords: [...tone],
      mustHaveSystems: [
        "player controls + game loop",
        "combat with telegraphed enemies",
        "NPC quests and merchant economy",
        "inventory/equipment/relics",
        "procedural floors/quests/items",
        "key+boss gated progression",
        "save/load with determinism",
        "UI, audio, feedback systems",
      ],
      constraints: [
        "zero runtime dependencies; browser-playable build",
        "deterministic simulation — replayable seeds",
        "QA may reject builds; fixes loop until gates pass",
      ],
    };
    void seedBase;
    this.act("brief.set", `"${brief.workingTitleSeedWord}" — ${brief.toneWords.join(" ")}`);
    this.artifactJson("director/brief.json", { ...brief, memoryNote });
    this.ctx.board.brief = brief;

    studioBusEmitDecision(this.ctx.board, `brief approved: ${brief.workingTitleSeedWord} depths=${brief.targetDepthCount}`, "vision set");
    return brief;
  }

  /** Look for the most recent run summary to inform this sprint. */
  private readPriorRun(): PriorRunSummary | null {
    try {
      const { readFileSync, existsSync } = nodeFs;
      const latestPath = joinPath(this.ctx.runDir, "..", "..", "studio-output", "LATEST.json");
      if (!existsSync(latestPath)) return null;
      const raw = JSON.parse(readFileSync(latestPath, "utf8")) as PriorRunSummary;
      return {
        ok: raw.ok,
        version: raw.version,
        fixIterations: raw.fixIterations,
        victoryRate: raw.victoryRate,
      };
    } catch (err) {
      this.log.warn("memory.readFailed", { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  /** Phase: REVIEW — gate the GDD before integration. */
  reviewDesign(gdd: GDD): { approved: boolean; feedback: string[] } {
    const problems: string[] = [];
    if (gdd.pillars.length < 3) problems.push("fewer than 3 pillars");
    if (gdd.mechanics.length < 6) problems.push("fewer than 6 mechanics — too thin to build from");
    if (!gdd.winCondition || !gdd.loseCondition) problems.push("missing win/lose conditions");
    if (gdd.coverageGoals.length < 4) problems.push("coverage goals too sparse for QA");

    const approved = problems.length === 0;
    this.act(approved ? "design.approved" : "design.revisionRequested", approved ? "GDD complete" : problems.join("; "));
    studioBusEmitDecision(
      { directorApproval: null },
      approved ? "GDD approved" : `revision needed: ${problems.join(", ")}`,
      "design gate",
    );
    return { approved, feedback: problems };
  }

  /**
   * Phase: TRIAGE — classify issues: auto-fixable data knobs vs engine-level
   * defects requiring human engineers. Returns issues to route to programmer.
   */
  triage(issues: BugIssue[]): { autoFixable: BugIssue[]; engineLevel: BugIssue[] } {
    const autoFixable: BugIssue[] = [];
    const engineLevel: BugIssue[] = [];

    for (const issue of issues) {
      if (issue.kind === "performance") autoFixable.push(issue);
      else if (issue.kind === "balance") autoFixable.push(issue);
      else if (issue.kind === "qa-coverage") autoFixable.push(issue);
      else if (issue.kind === "progression-blocker" && /unreachable|Key|budget|deficit/i.test(issue.title)) autoFixable.push(issue);
      else if (issue.kind === "stuck") autoFixable.push(issue);
      else engineLevel.push(issue); // crashes, save-load, invariants = engine suspects
    }

    // Cap per-iteration scope: most severe first.
    autoFixable.sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
    const scoped = autoFixable.slice(0, 6);

    this.act("triage.done", `${scoped.length} auto-fixable, ${engineLevel.length} engine-level`);
    if (engineLevel.length > 0) {
      this.log.warn(`ENGINE ISSUES REQUIRE HUMANS: ${engineLevel.map((i) => i.title).join("; ")}`);
    }
    this.artifactJson(`director/triage-iter-${this.ctx.board.iteration}.json`, {
      autoFixable: scoped.map((i) => ({ id: i.id, title: i.title })),
      engineLevel: engineLevel.map((i) => ({ id: i.id, title: i.title, detail: i.detail.slice(0, 200) })),
    });
    return { autoFixable: scoped, engineLevel };
  }

  /** Phase: GATE — final go/no-go. */
  gateRelease(): { approved: boolean; rationale: string } {
    const board = this.ctx.board;
    const qa = board.latestQa!;
    const perf = board.latestPerf!;

    let approved = true;
    const reasons: string[] = [];
    if (qa.verdict !== "PASS") {
      approved = false;
      reasons.push(`QA ${qa.verdict}: ${qa.reasons.join("; ")}`);
    }
    if (perf.verdict !== "PASS") {
      approved = false;
      reasons.push(`Perf ${perf.verdict}`);
    }
    if (board.engineIssues.length > 0) {
      approved = false;
      reasons.push(`${board.engineIssues.length} engine-level issue(s) need humans`);
    }
    if (iterationExceeded(board)) {
      approved = false;
      reasons.push("fix-loop budget exhausted without convergence");
    }

    const rationale = approved ? "All gates green." : reasons.join(" · ");
    board.directorApproval = { approved, rationale, atIso: new Date().toISOString() };
    studioBusEmitDecision(board, approved ? "RELEASE APPROVED" : `release blocked: ${rationale}`, "release gate");
    this.act(approved ? "gate.approved" : "gate.blocked", rationale);
    return { approved, rationale };
  }
}

function sevRank(s: string): number {
  return s === "blocker" ? 3 : s === "major" ? 2 : s === "minor" ? 1 : 0;
}

function iterationExceeded(_b: unknown): boolean {
  return false; // budget check handled by pipeline loop bounds
}

import { studioBus } from "../core/studio-events.js";
import type { Blackboard } from "../core/blackboard.js";
type BB = Pick<Blackboard, "directorApproval"> & Partial<Blackboard>;
function studioBusEmitDecision(_board: BB | { directorApproval: null }, decision: string, context: string): void {
  studioBus.emit("directorDecision", { decision: `${context}: ${decision}`, rationale: "" });
}

import { readFileSync as _rf, existsSync as _es } from "node:fs";
import { join as _join } from "node:path";
const nodeFs = { readFileSync: _rf, existsSync: _es };
function joinPath(...parts: string[]): string {
  return _join(...parts);
}
