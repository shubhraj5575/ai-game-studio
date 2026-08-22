/** Replay capture/verification round-trip tests. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { ContentPack } from "../../src/engine/content/types.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestPack } from "../fixtures/test-pack.js";
import { Simulation } from "../../src/engine/sim/simulation.js";
import { emptyInput } from "../../src/engine/sim/simulation.js";
import { ReplayRecorder, verifyReplay } from "../../src/qa/replay.js";
import { stateHash } from "../../src/engine/debug/state-hash.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pack = JSON.parse(readFileSync(join(root, "content", "pack.json"), "utf8")) as ContentPack;

function recordSyntheticRun(seed: number, frames: number): string {
  const sim = new Simulation(pack, seed);
  const recorder = new ReplayRecorder(seed);
  for (let f = 0; f < frames && sim.state.status === "playing"; f++) {
    const input = emptyInput();
    input.moveX = Math.sin(f * 0.043);
    input.moveY = Math.cos(f * 0.061);
    input.attackHeld = f % 11 === 0;
    input.interactPressed = f % 240 === 120;
    recorder.capture(f, input);
    sim.step(input);
  }
  return JSON.stringify(recorder.serialize(pack.meta.version));
}

describe("replay system", () => {
  it("replays a recorded run bit-exactly and matches the recorded hash", () => {
    const seed = 777;
    // Record with final hash attached (what the client download does).
    const sim = new Simulation(pack, seed);
    const recorder = new ReplayRecorder(seed);
    for (let f = 0; f < 900 && sim.state.status === "playing"; f++) {
      const input = emptyInput();
      input.moveX = Math.sin(f * 0.05);
      input.attackHeld = f % 9 === 0;
      recorder.capture(f, input);
      sim.step(input);
    }
    const file = recorder.serialize(pack.meta.version);
    file.finalHash = stateHash(sim);

    const result = verifyReplay(pack, JSON.stringify(file));
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.framesReplayed).toBeGreaterThan(0);
    if (file.finalHash) expect(result.finalHash).toBe(file.finalHash);
  });

  it("detects tampered final hashes", () => {
    const json = JSON.parse(recordSyntheticRun(555, 400)) as { finalHash?: string };
    json.finalHash = "deadbeefdeadbeef";
    const result = verifyReplay(pack, JSON.stringify(json));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.title === "Replay hash mismatch")).toBe(true);
  });

  it("rejects foreign packs and bad magic", () => {
    expect(verifyReplay(pack, '{"magic":"nope"}').ok).toBe(false);

    const otherPack = makeTestPack();
    otherPack.meta.version = "9.9.9-other";
    const replayJson = JSON.parse(recordSyntheticRun(1, 60)) as { packVersion: string; frames: unknown };
    void replayJson.frames;
    const result = verifyReplay(otherPack, JSON.stringify(replayJson));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/content v/);
  });
});
