/**
 * Fix-loop machinery tests — pins the triage→fix mapping that lets the studio
 * recover autonomously from QA findings.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProgrammerAgent } from "../../src/studio/agents/programmer.js";
import { GameDirectorAgent } from "../../src/studio/agents/game-director.js";
import type { AgentContext } from "../../src/studio/core/agent.js";
import { Logger } from "../../src/studio/core/logger.js";
import { Metrics } from "../../src/studio/core/metrics.js";
import { ArtifactStore } from "../../src/studio/core/artifacts.js";
import { Blackboard } from "../../src/studio/core/blackboard.js";
import { Rng } from "../../src/engine/core/rng.js";
import type { ContentPack } from "../../src/engine/content/types.js";
import type { BugIssue } from "../../src/qa/issues.js";
import { makeTestPack } from "../fixtures/test-pack.js";

let tmpDir: string;

function makeCtx(): AgentContext {
  tmpDir = mkdtempSync(join(tmpdir(), "studio-test-"));
  const log = new Logger();
  const ctx: AgentContext = {
    log,
    metrics: new Metrics(),
    artifacts: new ArtifactStore(tmpDir),
    board: new Blackboard(),
    rng: new Rng(1),
    runDir: tmpDir,
  };
  return ctx;
}

function bug(partial: Partial<BugIssue>): BugIssue {
  return {
    id: partial.id ?? "X",
    severity: partial.severity ?? "major",
    kind: partial.kind ?? "balance",
    title: partial.title ?? "",
    detail: partial.detail ?? "",
    seed: 0,
    frame: 0,
    depth: 0,
  };
}

describe("programmer auto-fix strategies", () => {
  let ctx: AgentContext;
  let programmer: ProgrammerAgent;
  let pack: ContentPack;

  beforeEach(() => {
    ctx = makeCtx();
    programmer = new ProgrammerAgent();
    programmer.bind(ctx);
    pack = makeTestPack();
  });

  it("eases difficulty on balance issues within guardrails", () => {
    const hpBefore = pack.systems.player.baseMaxHp;
    const budgetBefore = pack.floors[0]!.enemyBudgetPerDepth;
    const applied = programmer.applyFixes(pack, [bug({ kind: "balance", title: "mean depth progress low" })], 1);
    expect(applied).toContain("balance.ease");
    expect(pack.systems.player.baseMaxHp).toBe(Math.round(hpBefore * 1.08));
    expect(pack.floors[0]!.enemyBudgetPerDepth).toBeLessThan(budgetBefore);
    expect(ctx.board.fixes).toHaveLength(1);
    expect(ctx.board.fixes[0]!.strategy).toBe("balance.ease");
  });

  it("shrinks maps on tick-performance breaches", () => {
    const w = pack.floors[0]!.mapWidth;
    const applied = programmer.applyFixes(pack, [bug({ kind: "performance", title: "Average tick time above budget" })], 1);
    expect(applied).toContain("perf.shrinkMaps");
    expect(pack.floors[0]!.mapWidth).toBeLessThan(w);
  });

  it("guarantees merchant + shrines for coverage gaps", () => {
    pack.floors.forEach((f) => (f.hasShrine = false));
    const applied = programmer.applyFixes(
      pack,
      [
        bug({ kind: "qa-coverage", title: "Coverage gap: shopUsed" }),
        bug({ kind: "qa-coverage", title: "Coverage gap: shrineUsed" }),
      ],
      1,
    );
    expect(applied).toContain("coverage.merchantGuarantee");
    expect(applied).toContain("coverage.shrinesEverywhere");
    expect(pack.floors.every((f) => f.hasShrine)).toBe(true);
    const merchantId = pack.npcDefs.find((n) => n.role === "merchant")?.id;
    if (merchantId) {
      expect(pack.floors[0]!.npcIds).toContain(merchantId);
    }
  });

  it("routes crashes to engine issues instead of faking fixes", () => {
    const applied = programmer.applyFixes(pack, [bug({ kind: "crash", title: "Harness-level exception" })], 1);
    expect(applied).toHaveLength(0);
    expect(ctx.board.engineIssues).toHaveLength(1);
    expect(ctx.board.engineIssues[0]!.kind).toBe("crash");
  });

  it("never applies the same fix twice for one issue", () => {
    const issue = bug({ kind: "performance", title: "Average tick time above budget" });
    programmer.applyFixes(pack, [issue], 1);
    const w = pack.floors[0]!.mapWidth;
    const applied2 = programmer.applyFixes(pack, [{ ...issue, id: issue.id }], 2);
    void applied2;
    expect(pack.floors[0]!.mapWidth).toBe(w); // unchanged second time
  });

  it("cleans up temp dirs", () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("director triage routing", () => {
  it("separates engine-suspects from data-fixable findings", () => {
    const ctx = makeCtx();
    const director = new GameDirectorAgent();
    director.bind(ctx);

    const { autoFixable, engineLevel } = director.triage([
      bug({ kind: "performance", title: "Average tick above budget" }),
      bug({ kind: "qa-coverage", title: "Coverage gap: shrineUsed" }),
      bug({ kind: "progression-blocker", title: "Key unreachable" }),
      bug({ kind: "stuck", title: "Bot stuck" }),
      bug({ kind: "crash", title: "Harness-level exception" }),
      bug({ kind: "save-load", title: "Save mismatch" }),
    ]);

    expect(autoFixable.map((i) => i.kind).sort()).toEqual(["performance", "progression-blocker", "qa-coverage", "stuck"]);
    expect(engineLevel.map((i) => i.kind).sort()).toEqual(["crash", "save-load"]);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
