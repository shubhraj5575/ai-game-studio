/** Director multi-sprint memory: prior-run outcomes shape the next brief. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameDirectorAgent } from "../../src/studio/agents/game-director.js";
import { Logger } from "../../src/studio/core/logger.js";
import { Metrics } from "../../src/studio/core/metrics.js";
import { ArtifactStore } from "../../src/studio/core/artifacts.js";
import { Blackboard } from "../../src/studio/core/blackboard.js";
import { Rng } from "../../src/engine/core/rng.js";
import type { AgentContext } from "../../src/studio/core/agent.js";

let root: string;
let ctx: AgentContext;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "director-mem-"));
  // Mirror the repo layout the Director expects: <root>/studio-output/<id>
  mkdirSync(join(root, "studio-output", "some-run"), { recursive: true });
  ctx = {
    log: new Logger(),
    metrics: new Metrics(),
    artifacts: new ArtifactStore(join(root, "studio-output", "this-run")),
    board: new Blackboard(),
    rng: new Rng(7),
    runDir: join(root, "studio-output", "this-run"),
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeLatest(data: object): void {
  writeFileSync(join(root, "studio-output", "LATEST.json"), JSON.stringify(data));
}

describe("director memory", () => {
  it("hardens after a dominant prior run", () => {
    writeLatest({ ok: true, version: "9.9.9", victoryRate: 1 });
    const d = new GameDirectorAgent();
    d.bind(ctx);
    const brief = d.brief(1);
    expect(brief.difficultyIntent).toBe("punishing");
  });

  it("eases after a struggling blocked run", () => {
    writeLatest({ ok: false, version: "9.9.8", victoryRate: 0.4, fixIterations: 3 });
    const d = new GameDirectorAgent();
    d.bind(ctx);
    const brief = d.brief(2);
    expect(brief.difficultyIntent).toBe("welcoming");
  });

  it("holds course on a mixed-but-shipped run", () => {
    writeLatest({ ok: true, version: "9.9.7", victoryRate: 0.75 });
    const d = new GameDirectorAgent();
    d.bind(ctx);
    const brief = d.brief(3);
    expect(brief.difficultyIntent).toBe("standard");
  });

  it("defaults to standard when no history exists", () => {
    const d = new GameDirectorAgent();
    d.bind(ctx);
    const brief = d.brief(4);
    expect(brief.difficultyIntent).toBe("standard");
  });

  it("survives a corrupt LATEST.json", () => {
    writeFileSync(join(root, "studio-output", "LATEST.json"), "{{{ not json");
    const d = new GameDirectorAgent();
    d.bind(ctx);
    const brief = d.brief(5);
    expect(brief.difficultyIntent).toBe("standard");
  });
});
