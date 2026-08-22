/**
 * Replay capture & verification.
 *
 * Human sessions can be recorded frame-by-frame and re-simulated bit-exactly
 * (determinism guarantee). This turns "it crashed / felt wrong" player reports
 * into reproducible QA scenarios: attach the replay file, run the verifier.
 *
 * NOTE: this module is imported by BOTH the browser client (recorder) and
 * Node tooling (verifier) — it must stay free of Node-only imports.
 */
import type { ContentPack } from "../engine/content/types.js";
import { validateContentPack } from "../engine/content/types.js";
import { Simulation } from "../engine/sim/simulation.js";
import { emptyInput } from "../engine/sim/simulation.js";
import type { FrameInput } from "../engine/sim/simulation.js";
import { stateHash } from "../engine/debug/state-hash.js";
import { checkInvariants } from "./invariants.js";
import { makeIssueId } from "./issues.js";
import type { BugIssue } from "./issues.js";

export interface ReplayFile {
  magic: "EMBERFALL-REPLAY";
  version: 1;
  packVersion: string;
  seed: number;
  /** Recorded inputs; index = frame number. Sparse entries fall back to empty input.
   *  Values are stored at full double precision — any rounding would break
   *  bit-exact replay (a bug we hit and fixed). */
  frames: Array<[number, FrameInput]>;
  recordedAtIso?: string;
  finalHash?: string;
}

export class ReplayRecorder {
  private frames: Array<[number, FrameInput]> = [];
  constructor(readonly seed: number) {}

  capture(frame: number, input: FrameInput): void {
    this.frames.push([
      frame,
      {
        moveX: input.moveX,
        moveY: input.moveY,
        aimX: input.aimX,
        aimY: input.aimY,
        attackHeld: input.attackHeld,
        dodgePressed: input.dodgePressed,
        interactPressed: input.interactPressed,
      },
    ]);
  }

  serialize(packVersion: string): ReplayFile {
    return {
      magic: "EMBERFALL-REPLAY",
      version: 1,
      packVersion,
      seed: this.seed,
      frames: this.frames,
      recordedAtIso: new Date().toISOString(),
    };
  }
}

function inputAt(replay: ReplayFile, frame: number): FrameInput {
  const entry = replay.frames.find(([f]) => f === frame);
  if (!entry) return emptyInput();
  const [, i] = entry;
  return { ...emptyInput(), ...i };
}

export interface ReplayVerification {
  ok: boolean;
  seed: number;
  framesReplayed: number;
  statusAtEnd: string;
  finalHash: string;
  issues: BugIssue[];
  error?: string;
}

/**
 * Re-simulate a replay against the given pack, checking for crashes and
 * invariant blockers throughout. If the replay carries a finalHash from the
 * recorder's machine, it must match — proving identical behavior.
 */
export function verifyReplay(pack: ContentPack, replayJson: string | ReplayFile): ReplayVerification {
  try {
    const replay: ReplayFile =
      typeof replayJson === "string" ? (JSON.parse(replayJson) as ReplayFile) : replayJson;

    if (replay.magic !== "EMBERFALL-REPLAY") throw new Error("not a replay file");
    if (replay.version !== 1) throw new Error(`unsupported replay version ${replay.version}`);
    if (replay.packVersion !== pack.meta.version) {
      throw new Error(`replay targets content v${replay.packVersion}, installed v${pack.meta.version}`);
    }

    const problems = validateContentPack(pack);
    if (problems.length > 0) throw new Error(`invalid pack: ${problems[0]}`);

    const sim = new Simulation(pack, replay.seed);
    const maxFrame = replay.frames.length > 0 ? replay.frames[replay.frames.length - 1]![0] : 0;
    const issues: BugIssue[] = [];

    for (let frame = 0; frame <= maxFrame; frame++) {
      sim.step(inputAt(replay, frame));
      if (frame % 15 === 0) {
        issues.push(...checkInvariants(sim, { seed: replay.seed, frame }));
        issues.forEach((i) => {
          if (i.id.startsWith("BUG-") === false) i.id = makeIssueId(replay.seed, frame);
        });
      }
      if (sim.state.status !== "playing" || sim.state.fatalError) break;
    }

    const finalHash = stateHash(sim);
    let ok = issues.filter((i) => i.severity === "blocker").length === 0 && !sim.state.fatalError;
    if (replay.finalHash && replay.finalHash !== finalHash) {
      ok = false;
      issues.push({
        id: makeIssueId(replay.seed, maxFrame),
        severity: "blocker",
        kind: "invariant",
        title: "Replay hash mismatch",
        detail: `recorded=${replay.finalHash} replayed=${finalHash}`,
        seed: replay.seed,
        frame: maxFrame,
        depth: sim.state.depth,
      });
    }

    return {
      ok,
      seed: replay.seed,
      framesReplayed: maxFrame + 1,
      statusAtEnd: sim.state.status,
      finalHash,
      issues,
    };
  } catch (err) {
    return {
      ok: false,
      seed: -1,
      framesReplayed: 0,
      statusAtEnd: "error",
      finalHash: "",
      issues: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
