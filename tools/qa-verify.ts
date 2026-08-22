/** Wide QA verification sweep across 8 seeds against the shipped pack. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContentPack } from "../src/engine/content/types.js";
import { runSuite } from "../src/qa/suite.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pack = JSON.parse(readFileSync(join(root, "content", "pack.json"), "utf8")) as ContentPack;
const r = runSuite(pack, { seeds: [11, 22, 33, 44, 55, 66, 77, 88] });

console.log("WIDE SWEEP:", r.verdict);
console.log(
  "victory", r.aggregate.victoryRate.toFixed(2),
  "| coverage", r.aggregate.coverageFraction.toFixed(2),
  "| avgTick", r.aggregate.avgTickMs.toFixed(3),
);
console.log("blockers", r.aggregate.blockerCount, "majors", r.aggregate.majorCount, "minors", r.aggregate.minorCount);
for (const s of r.seeds) {
  console.log(`  seed ${s.seed}: ${s.outcome} d${s.depthReached} kills=${s.kills}`);
}
process.exit(r.verdict === "PASS" ? 0 : 1);
