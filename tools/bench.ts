/**
 * Performance benchmarks — standalone, repeatable, budget-aware.
 *   npm run bench            # full suite
 *   npm run bench -- --quick # reduced iterations
 */
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Rng } from "../src/engine/core/rng.js";
import { generateFloor } from "../src/engine/world/procgen.js";
import { findPath, reachableTiles } from "../src/engine/world/pathfind.js";
import { hasLineOfSight } from "../src/engine/world/los.js";
import { Simulation } from "../src/engine/sim/simulation.js";
import { emptyInput } from "../src/engine/sim/simulation.js";
import { snapshot, restoreFromSnapshot } from "../src/engine/sim/save.js";
import { validateContentPack } from "../src/engine/content/types.js";
import type { ContentPack } from "../src/engine/content/types.js";
import { ObjectiveBot } from "../src/qa/bots.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const quick = process.argv.includes("--quick");

function loadPack(): ContentPack {
  return JSON.parse(readFileSync(join(root, "content", "pack.json"), "utf8")) as ContentPack;
}

interface BenchResult {
  name: string;
  ops: number;
  totalMs: number;
  perOpMs: number;
  opsPerSec: number;
}

function bench(name: string, ops: number, fn: (i: number) => void): BenchResult {
  // Warm-up.
  for (let i = 0; i < Math.min(ops, 50); i++) fn(i);
  const t0 = performance.now();
  for (let i = 0; i < ops; i++) fn(i);
  const totalMs = performance.now() - t0;
  const r: BenchResult = {
    name,
    ops,
    totalMs,
    perOpMs: totalMs / ops,
    opsPerSec: ops / (totalMs / 1000),
  };
  console.log(
    `${name.padEnd(34)} ${String(ops).padStart(7)} ops · ${r.perOpMs.toFixed(4)} ms/op · ${Math.round(r.opsPerSec).toLocaleString()} ops/s`,
  );
  return r;
}

function main(): void {
  const pack = loadPack();
  validateContentPack(pack);
  const scale = quick ? 0.25 : 1;
  const results: BenchResult[] = [];
  let failures = 0;

  console.log(`\nAI Game Studio benchmarks — content v${pack.meta.version} (${quick ? "quick" : "full"})\n`);

  // --- Simulation throughput -------------------------------------------------
  {
    const sim = new Simulation(pack, 9001);
    const ops = Math.round(30000 * scale);
    results.push(
      bench("sim.step(idle-input)", ops, () => {
        sim.step(emptyInput());
      }),
    );
  }
  {
    const sim = new Simulation(pack, 9001);
    const bot = new ObjectiveBot(1);
    const ops = Math.round(6000 * scale);
    let restarts = 0;
    results.push(
      bench("sim.step(objective-bot)", ops, (i) => {
        sim.step(bot.drive(sim, i));
        if (sim.state.status !== "playing") {
          // restart silently to keep the loop combat-heavy on average
          const again = new Simulation(pack, 9001);
          Object.assign(sim.state, again.state);
          restarts++;
        }
      }),
    );
    void restarts;
  }

  // --- Floor generation --------------------------------------------------------
  {
    const cfg = pack.floors[Math.min(3, pack.floors.length - 1)]!;
    const ops = Math.round(60 * scale);
    results.push(bench("procgen.generateFloor(largest)", ops, (i) => void generateFloor(pack, cfg, 7000 + i)));
  }

  // --- Pathfinding ---------------------------------------------------------------
  {
    const cfg = pack.floors[0]!;
    const floor = generateFloor(pack, cfg, 12345);
    const rng = new Rng(77);
    const targets: Array<[number, number]> = [];
    for (let i = 0; i < 400; i++) {
      const x = rng.intInclusive(1, floor.map.width - 2);
      const y = rng.intInclusive(1, floor.map.height - 2);
      if (floor.map.isWalkable(x, y)) targets.push([x, y]);
    }
    const start = floor.spawns.playerStart;
    const ops = Math.round(targets.length * scale);
    results.push(
      bench("pathfind.findPath(random pairs)", ops, (i) => {
        const [tx, ty] = targets[i % targets.length]!;
        void findPath(floor.map, start.x, start.y, tx + 0.5, ty + 0.5);
      }),
    );
    results.push(
      bench("pathfind.reachableTiles(full map)", Math.round(20 * scale), () => {
        void reachableTiles(floor.map, start.x, start.y);
      }),
    );
  }

  // --- LOS -----------------------------------------------------------------------
  {
    const cfg = pack.floors[0]!;
    const floor = generateFloor(pack, cfg, 555);
    const rng = new Rng(9);
    const a = floor.spawns.playerStart;
    const ops = Math.round(20000 * scale);
    results.push(
      bench("world.hasLineOfSight", ops, (i) => {
        const b = {
          x: a.x + rng.range(-14, 14),
          y: a.y + rng.range(-14, 14),
        };
        void hasLineOfSight(floor.map, a.x, a.y, b.x, b.y);
      }),
    );
  }

  // --- Save / restore --------------------------------------------------------------
  {
    const sim = new Simulation(pack, 31337);
    const bot = new ObjectiveBot(2);
    for (let f = 0; f < 3000; f++) sim.step(bot.drive(sim, f));
    const snapStr = snapshot(sim);
    const opsSave = Math.round(50 * scale) + 10;
    const opsRest = Math.round(50 * scale) + 10;
    results.push(
      bench(`save.snapshot(${(snapStr.length / 1024).toFixed(1)}KB)`, opsSave, () => {
        if (snapshot(sim).length === 0) throw new Error("empty save");
      }),
    );
    results.push(
      bench("save.restoreFromSnapshot", opsRest, () => {
        void restoreFromSnapshot(pack, snapStr);
      }),
    );
  }

  // --- Budgets ----------------------------------------------------------------------
  console.log("");
  const tickBench = results.find((r) => r.name.startsWith("sim.step(idle"))!;
  const botBench = results.find((r) => r.name.startsWith("sim.step(obj"))!;
  const genBench = results.find((r) => r.name.startsWith("procgen"))!;
  const ticksPerSec = 1000 / tickBench.perOpMs;
  const budgets: Array<[string, number, number, boolean]> = [
    ["engine tick avg ≤ 1.5ms", tickBench.perOpMs, 1.5, true],
    ["bot-driven tick avg ≤ 2.5ms", botBench.perOpMs, 2.5, true],
    ["throughput ≥ 10k idle ticks/s", ticksPerSec, 10_000, false],
    ["floor gen ≤ 30ms", genBench.perOpMs, 30, true],
  ];
  console.log("Budgets:");
  for (const [label, actual, limit, lowerIsBetter] of budgets) {
    const pass = lowerIsBetter ? actual <= limit : actual >= limit;
    if (!pass) failures++;
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${label} (actual ${actual.toFixed(4)})`);
  }

  console.log("");
  process.exit(failures > 0 ? 1 : 0);
}

main();
