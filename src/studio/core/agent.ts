/**
 * Agent base — every studio agent has an identity, writes structured logs,
 * and produces artifacts. Agents are deterministic expert systems: they make
 * real decisions from real data using documented heuristics (no hidden LLM
 * calls). The seams where an LLM provider could plug in are explicit and
 * marked; without one, procedural generation is used everywhere.
 */
import type { Logger } from "./logger.js";
import type { Metrics } from "./metrics.js";
import type { ArtifactStore } from "./artifacts.js";
import type { Blackboard } from "./blackboard.js";
import { studioBus } from "./studio-events.js";
import { Rng } from "../../engine/core/rng.js";

export interface AgentContext {
  log: Logger;
  metrics: Metrics;
  artifacts: ArtifactStore;
  board: Blackboard;
  rng: Rng;
  runDir: string;
}

export abstract class Agent {
  abstract readonly id: string;
  abstract readonly title: string;
  protected ctx!: AgentContext;
  private scopedLog!: Logger["scoped"] extends (s: string) => infer R ? R : never;

  bind(ctx: AgentContext): void {
    this.ctx = ctx;
    this.scopedLog = ctx.log.scoped(this.id);
  }

  protected get log() {
    return this.scopedLog;
  }

  /** Record a meaningful action on the bus + audit trail. */
  act(action: string, detail?: string): void {
    studioBus.emit("agentAction", { agent: this.id, action, detail });
    this.log.info(action, detail ? { detail } : undefined);
  }

  protected artifact(name: string, content: string): void {
    const ref = this.ctx.artifacts.put(name, content);
    studioBus.emit("artifactWritten", { agent: this.id, name, bytes: ref.bytes });
  }

  protected artifactJson(name: string, data: unknown): void {
    const ref = this.ctx.artifacts.putJson(name, data);
    studioBus.emit("artifactWritten", { agent: this.id, name: ref.name, bytes: ref.bytes });
  }
}
