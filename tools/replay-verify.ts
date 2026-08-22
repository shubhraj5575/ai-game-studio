/** CLI: verify a recorded human-session replay against the shipped pack. */
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContentPack } from "../src/engine/content/types.js";
import { verifyReplay } from "../src/qa/replay.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2];

if (!file) {
  console.error("usage: npm run replay:verify -- <replay.json>");
  process.exit(2);
}

const pack = JSON.parse(readFileSync(join(root, "content", "pack.json"), "utf8")) as ContentPack;
const result = verifyReplay(pack, readFileSync(resolve(process.cwd(), file), "utf8"));

console.log(`REPLAY VERIFY: ${result.ok ? "OK" : "FAILED"}`);
if (result.error) console.log(`  error: ${result.error}`);
else {
  console.log(`  seed ${result.seed} · ${result.framesReplayed} frames · end=${result.statusAtEnd}`);
  console.log(`  finalHash ${result.finalHash}`);
}
for (const i of result.issues.filter((x) => x.severity === "blocker").slice(0, 8)) {
  console.log(`  blocker [${i.kind}] ${i.title} @f${i.frame}: ${i.detail.slice(0, 120)}`);
}
process.exit(result.ok ? 0 : 1);
