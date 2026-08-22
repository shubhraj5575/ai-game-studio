import { makeTestPack } from "../tests/fixtures/test-pack.js";
import { Simulation } from "../src/engine/sim/simulation.js";
import { ObjectiveBot } from "../src/qa/bots.js";
import { vdist } from "../src/engine/core/math.js";

const pack = makeTestPack();
const seed = Number(process.argv[2] ?? 101);
const sim = new Simulation(pack, seed);
const bot = new ObjectiveBot(seed);

for (let f = 0; f < 60 * 60 * 12 && sim.state.status === "playing"; f++) {
  sim.step(bot.drive(sim, f));
  if (f % 300 === 0) {
    const s = sim.state;
    const p = sim.player()!;
    const enemies = [...s.entities.values()].filter((e) => e.kind === "enemy" && !e.dead);
    enemies.sort((a, b) => vdist(a.pos, p.pos) - vdist(b.pos, p.pos));
    const near = enemies[0];
    console.log(
      `f=${f} d=${s.depth} pos=(${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)}) hp=${Math.round(p.hp)}/${p.maxHp}` +
      ` gold=${s.gold} kills=${s.stats.totalKills} enemiesNear=${enemies.length}` +
      (near ? ` nearest=${near.defId}@${vdist(near.pos, p.pos).toFixed(1)} windup=${(near.windupTimer ?? 0).toFixed(2)} state=${near.ai?.state}` : "") +
      ` dialogue=${s.dialogue ? "OPEN" : "-"} key=${s.keyCollected}`,
    );
  }
}
console.log("final:", sim.state.status);
