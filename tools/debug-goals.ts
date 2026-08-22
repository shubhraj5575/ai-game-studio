import { makeTestPack } from "../tests/fixtures/test-pack.js";
import { Simulation } from "../src/engine/sim/simulation.js";
import { ObjectiveBot } from "../src/qa/bots.js";
import { vdist } from "../src/engine/core/math.js";

const pack = makeTestPack();
const seed = Number(process.argv[2] ?? 101);
const sim = new Simulation(pack, seed);
const bot = new ObjectiveBot(seed);

// Track which entities the bot navigates toward by observing input+state.
let lastPosStr = "";
for (let f = 0; f < 60 * 60 * 6 && sim.state.status === "playing"; f++) {
  const input = bot.drive(sim, f);
  const s = sim.state;
  const p = sim.player()!;
  // Heuristic: log frames where interactPressed or dialogue events occur.
  if (input.interactPressed || s.dialogue) {
    const npcNear = [...s.entities.values()].find((e) => e.kind === "npc" && vdist(e.pos, p.pos) < 2);
    console.log(`f=${f} interact=${input.interactPressed} dialogue=${s.dialogue ? "open:" + s.dialogue.line.slice(0, 40) : "-"} npcNear=${npcNear?.npcDefId ?? "-"}`);
  }
  if (f % 1200 === 0) {
    const qs = s.quests.map((q) => `${q.templateId}[${q.status}]`);
    const npcsWorth = [...s.entities.values()].filter(
      (e) => e.kind === "npc" && s.quests.some((q) => q.giverEntityId === e.id && (q.status === "offered" || q.status === "readyTurnIn")),
    );
    console.log(`f=${f} d=${s.depth} pos=(${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)}) quests=${qs.join(",") || "none"} worthVisiting=${npcsWorth.map((n) => n.id).join(",") || "-"} distToThem=${npcsWorth.map((n) => vdist(n.pos, p.pos).toFixed(1)).join(",") || "-"}`);
  }
  void lastPosStr;
  sim.step(input);
}
console.log("final:", sim.state.status);
