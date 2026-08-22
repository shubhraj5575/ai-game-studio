/**
 * Studio CLI — runs the full autonomous production pipeline.
 *
 *   npm run studio                # full run: design → build → QA → fix → release
 *   npm run studio -- --seeds 7   # custom QA seed count (first pass)
 *   npm run studio -- --loops 4   # max fix-loop iterations
 */
import { runStudio } from "../src/studio/pipeline.js";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function safeInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) ? n : fallback;
}
const seedCount = Math.max(1, Math.min(safeInt(argValue("--seeds"), 3), 12));
const loops = Math.max(0, Math.min(safeInt(argValue("--loops"), 3), 8));
const skipBuild = process.argv.includes("--skip-build");

const seeds: number[] = [];
for (let i = 0; i < seedCount; i++) {
  seeds.push(101 + i * 101);
}

console.log("╔══════════════════════════════════════════╗");
console.log("║  AI GAME STUDIO — autonomous production  ║");
console.log("╚══════════════════════════════════════════╝");

const result = runStudio({ seeds, maxFixLoops: loops, skipBuild });

console.log("");
console.log("────────────── RUN RESULT ──────────────");
console.log(`ok:            ${result.ok}`);
console.log(`runId:         ${result.runId}`);
console.log(`version:       ${result.version ?? "-"}`);
console.log(`qa verdict:    ${result.qaVerdict}`);
console.log(`perf verdict:  ${result.perfVerdict}`);
console.log(`fix loops:     ${result.fixIterations}`);
console.log(`engine issues: ${result.engineIssues}`);
console.log(`artifacts:     ${result.artifactsDir}`);
process.exit(result.ok ? 0 : 2);
