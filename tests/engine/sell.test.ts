/** Sell-economy regression tests: the loop the shop UI and bots rely on. */
import { describe, it, expect } from "vitest";
import { makeTestPack } from "../fixtures/test-pack.js";
import { Simulation } from "../../src/engine/sim/simulation.js";
import { countItem } from "../../src/engine/sim/inventory.js";
import { gameBus } from "../../src/engine/sim/game-events.js";

describe("sell economy", () => {
  it("sells unequipped gear for 40% value and emits event", () => {
    const pack = makeTestPack();
    const sim = new Simulation(pack, 1);
    sim.giveItem("weapon-legion-blade", 1); // value 48 → sell 19
    const goldBefore = sim.state.gold;

    let soldEvent: { itemId: string; gain: number } | null = null;
    const unsub = gameBus.on("sold", (e) => {
      soldEvent = e;
    });
    const res = sim.sellItem("weapon-legion-blade");
    unsub();

    expect(res).toBe("ok");
    expect(sim.state.gold).toBe(goldBefore + 19);
    expect(soldEvent).toEqual({ itemId: "weapon-legion-blade", gain: 19 });
    expect(countItem(sim.state, "weapon-legion-blade")).toBe(0);
  });

  it("refuses to sell equipped items", () => {
    const pack = makeTestPack();
    const sim = new Simulation(pack, 2);
    sim.giveItem("weapon-ember-fang", 1);
    expect(sim.equipFromBag("weapon-ember-fang")).toBe(true);
    expect(sim.sellItem("weapon-ember-fang")).toBe("equipped");
  });

  it("refuses unknown or unowned items without state change", () => {
    const pack = makeTestPack();
    const sim = new Simulation(pack, 3);
    expect(sim.sellItem("no-such-item")).toBe("not-owned");
    expect(sim.sellItem("relic-hawk-eye")).toBe("not-owned");
  });
});
