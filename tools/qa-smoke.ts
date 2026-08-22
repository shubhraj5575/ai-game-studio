/**
 * CI smoke: headless QA against the SHIPPED content pack (content/pack.json).
 * Fast — 2 seeds, reduced tick budget. Exit code gates CI.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContentPack } from "../src/engine/content/types.js";
import type { ContentPack } from "../src/engine/content/types.js";
import { runSuite } from "../src/qa/suite.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pack = JSON.parse(readFileSync(join(root, "content", "pack.json"), "utf8")) as ContentPack;

const problems = validateContentPack(pack);
if (problems.length > 0) {
  console.error("SHIPPED PACK INVALID:", problems);
  process.exit(1);
}

const report = runSuite(pack, {
  seeds: [101, 202],
  maxTicks: 60 * 60 * 8,
});

console.log(`QA SMOKE: ${report.verdict}`);
console.log(`  victory=${report.aggregate.victoryRate} coverage=${report.aggregate.coverageFraction.toFixed(2)} avgTick=${report.aggregate.avgTickMs.toFixed(3)}ms`);
for (const r of report.reasons) console.log(`  reason: ${r}`);
for (const i of report.issues.filter((x) => x.severity === "blocker").slice(0, 5)) {
  console.log(`  blocker: ${i.title} (seed ${i.seed})`);
}
process.exit(report.verdict === "PASS" ? 0 : 1);
