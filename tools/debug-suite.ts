import { makeTestPack } from "../tests/fixtures/test-pack.js";
import { runSuite } from "../src/qa/suite.js";

const report = runSuite(makeTestPack(), { seeds: [101, 202, 303, 404, 505] });
console.log("VERDICT:", report.verdict);
console.log("reasons:", report.reasons);
console.log("aggregate:", JSON.stringify(report.aggregate, (k, v) => (k === "coverage" ? v : v), 2));
console.log("issues by severity:");
const bySev: Record<string, number> = {};
for (const i of report.issues) bySev[i.severity] = (bySev[i.severity] ?? 0) + 1;
console.log(bySev);
process.exit(report.verdict === "PASS" ? 0 : 1);
