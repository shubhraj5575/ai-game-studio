/**
 * Studio event bus + typed events. Phases, agent actions, verdicts, and fix
 * applications all flow through here; the pipeline records an audit trail.
 */
import { EventBus } from "../../engine/core/events.js";

export type StudioPhase =
  | "brief"
  | "design"
  | "implement"
  | "build"
  | "qa"
  | "performance"
  | "triage"
  | "fix"
  | "review"
  | "release";

export interface StudioEvents {
  [key: string]: unknown;
  runStarted: { runId: string; startedAt: string };
  phaseEntered: { phase: StudioPhase; iteration: number };
  phaseExited: { phase: StudioPhase; iteration: number; durationMs: number; ok: boolean };
  agentAction: { agent: string; action: string; detail?: string };
  artifactWritten: { agent: string; name: string; bytes: number };
  qaVerdict: { verdict: "PASS" | "REJECT"; reasons: string[] };
  perfVerdict: { verdict: "PASS" | "REJECT"; reasons: string[] };
  issueFound: { id: string; severity: string; kind: string; title: string };
  fixApplied: { agent: string; strategy: string; detail: string };
  regressionRecorded: { seed: number; issueId: string; testPath: string };
  directorDecision: { decision: string; rationale: string };
  buildProduced: { distDir: string; manifest: unknown };
  runFinished: { ok: boolean; summary: Record<string, unknown> };
}

export const studioBus = new EventBus<StudioEvents>();
