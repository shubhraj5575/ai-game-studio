/**
 * Structured bug reports produced by QA runs.
 *
 * Every issue carries enough information to reproduce it exactly:
 * content version + seed + frame index (+ optional replay script path).
 */

export type IssueSeverity = "blocker" | "major" | "minor" | "polish";
export type IssueKind =
  | "crash"
  | "invariant"
  | "progression-blocker"
  | "stuck"
  | "save-load"
  | "performance"
  | "balance";

export interface BugIssue {
  id: string;
  severity: IssueSeverity;
  kind: IssueKind;
  title: string;
  detail: string;
  seed: number;
  frame: number;
  depth: number;
  /** Machine-actionable hint for the fix loop. */
  suggestedFix?: string;
  context?: Record<string, unknown>;
}

export interface CoverageFlags {
  combatSeen: boolean;
  damageTakenSeen: boolean;
  killSeen: boolean;
  itemPickupSeen: boolean;
  goldSeen: boolean;
  questAccepted: boolean;
  questCompleted: boolean;
  shopUsed: boolean;
  potionUsed: boolean;
  chestOpened: boolean;
  shrineUsed: boolean;
  keyFound: boolean;
  descended: boolean;
  saveLoadChecked: boolean;
  levelUpSeen: boolean;
}

export function emptyCoverage(): CoverageFlags {
  return {
    combatSeen: false,
    damageTakenSeen: false,
    killSeen: false,
    itemPickupSeen: false,
    goldSeen: false,
    questAccepted: false,
    questCompleted: false,
    shopUsed: false,
    potionUsed: false,
    chestOpened: false,
    shrineUsed: false,
    keyFound: false,
    descended: false,
    saveLoadChecked: false,
    levelUpSeen: false,
  };
}

let issueCounter = 0;
export function makeIssueId(seed: number, frame: number): string {
  return `BUG-${seed.toString(36)}-${frame.toString(36)}-${(++issueCounter).toString(36)}`;
}
