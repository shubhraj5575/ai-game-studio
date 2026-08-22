/**
 * Deterministic state fingerprinting for QA, replay verification, and tests.
 * Canonical form: the save serializer's data section, key-sorted, hashed
 * with FNV-1a (64-bit folded variant).
 */
import { fnv1a } from "../core/hash.js";
import { snapshot } from "../sim/save.js";
import type { Simulation } from "../sim/simulation.js";

/** Deterministic JSON stringify with sorted object keys. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Hash of the full simulation state. Two sims with equal hashes are equivalent. */
export function stateHash(sim: Simulation): string {
  const env = JSON.parse(snapshot(sim)) as { data: unknown };
  return fnv1a(stableStringify(env.data));
}
