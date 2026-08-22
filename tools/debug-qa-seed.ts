import { makeTestPack } from "../tests/fixtures/test-pack.js";
import { runSeed } from "../src/qa/harness.js";
import { DEFAULT_SEED_OPTIONS } from "../src/qa/harness.js";

const seed = Number(process.argv[2] ?? 101);
const maxTicks = Number(process.argv[3] ?? DEFAULT_SEED_OPTIONS.maxTicks);
const result = runSeed(makeTestPack(), seed, { ...DEFAULT_SEED_OPTIONS, maxTicks });

console.log("=== SEED RESULT ===");
console.log(JSON.stringify({
  outcome: result.outcome,
  ticksUsed: result.ticksUsed,
  depthReached: result.depthReached,
  kills: result.kills,
  goldEarned: result.goldEarned,
  questsCompleted: result.questsCompleted,
  statusAtEnd: result.statusAtEnd,
}, null, 2));
console.log("perf:", JSON.stringify(result.perf, null, 2));
console.log("coverage:", JSON.stringify(result.coverage, null, 2));
console.log("issues:", result.issues.length);
for (const i of result.issues.slice(0, 20)) {
  console.log(` - [${i.severity}/${i.kind}] ${i.title} @f${i.frame} d${i.depth}: ${i.detail.slice(0, 140)}`);
}
