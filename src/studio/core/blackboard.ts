/**
 * Blackboard — shared mutable state agents read from and write to during a
 * studio run. Simple and explicit by design: the pipeline passes phases in
 * order, so coordination is sequential with clear ownership per artifact.
 */
import type { ContentPack } from "../../engine/content/types.js";
import type { SuiteReport } from "../../qa/suite.js";
import type { BugIssue } from "../../qa/issues.js";

export interface CreativeBrief {
  workingTitleSeedWord: string;
  genre: string;
  pillars: string[];
  targetDepthCount: number;
  difficultyIntent: "welcoming" | "standard" | "punishing";
  toneWords: string[];
  mustHaveSystems: string[];
  constraints: string[];
}

export interface GDD {
  title: string;
  logline: string;
  pillars: Array<{ name: string; description: string }>;
  coreLoop: string[];
  mechanics: Array<{ name: string; summary: string; parameters: Record<string, number | string> }>;
  progression: {
    playerGrowth: string;
    difficultyArc: string;
    economyNotes: string;
  };
  winCondition: string;
  loseCondition: string;
  coverageGoals: string[];
}

export interface PerfReport {
  verdict: "PASS" | "REJECT";
  budgets: Record<string, { budget: number; actual: number; pass: boolean; unit: string }>;
  notes: string[];
}

export interface FixRecord {
  iteration: number;
  strategy: string;
  target: string;
  before: string;
  after: string;
  rationale: string;
  appliedBy: string;
  atIso: string;
}

export interface RegressionRecord {
  seed: number;
  issueId: string;
  testPath: string;
  addedAtIso: string;
}

export class Blackboard {
  brief!: CreativeBrief;
  gdd: GDD | null = null;
  /** In-progress pack during DESIGN (before programmer integration). */
  packDraft: ContentPack | null = null;
  pack: ContentPack | null = null;

  /** QA reports keyed by build iteration (0 = first). */
  qaHistory: Array<{ iteration: number; report: SuiteReport }> = [];
  latestQa: SuiteReport | null = null;
  perfHistory: Array<{ iteration: number; report: PerfReport }> = [];
  latestPerf: PerfReport | null = null;

  /** Open issues routed for fixing. */
  openIssues: BugIssue[] = [];
  fixedIssueIds = new Set<string>();
  fixes: FixRecord[] = [];
  regressions: RegressionRecord[] = [];

  /** Engine-level problems the programmer cannot auto-fix (honest limits). */
  engineIssues: BugIssue[] = [];

  directorApproval: { approved: boolean; rationale: string; atIso: string } | null = null;
  releaseVersion = "";

  get iteration(): number {
    return this.qaHistory.length;
  }
}
