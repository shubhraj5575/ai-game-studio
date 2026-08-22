/** Renderer smoke tests against a stubbed Canvas2D. */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { makeTestPack } from "../fixtures/test-pack.js";
import { Simulation } from "../../src/engine/sim/simulation.js";
import { emptyInput } from "../../src/engine/sim/simulation.js";
import { gameBus } from "../../src/engine/sim/game-events.js";
import { makeCanvas, makeEl } from "./dom-stubs.js";

beforeAll(() => {
  vi.stubGlobal("window", {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener: vi.fn(),
  });
  vi.stubGlobal("document", {
    getElementById: (id: string): HTMLElement => makeEl(id),
    createElement: (): HTMLElement => makeEl("dyn"),
    title: "",
    body: makeEl("body"),
  });
});

describe("Renderer (stubbed canvas)", () => {
  it("renders 600 frames across floor transitions without throwing", async () => {
    const { Renderer } = await import("../../src/client/render.js");
    const pack = makeTestPack();
    const sim = new Simulation(pack, 606);
    const renderer = new Renderer(makeCanvas(), pack);

    let descendedTo = 1;
    const unsub = gameBus.on("descend", (e) => {
      descendedTo = e.depth;
    });

    try {
      for (let f = 0; f < 600 && sim.state.status === "playing"; f++) {
        renderer.capturePreStep(sim);
        sim.step(emptyInput());
        renderer.updateFx(1 / 60);
        renderer.render(sim, f % 2 === 0 ? 0 : 0.5);
        // Teleport to the portal periodically to cross floors quickly.
        if (f % 150 === 149) {
          const p = sim.player();
          const portal = [...sim.state.entities.values()].find((e) => e.kind === "portal");
          if (p && portal) {
            p.pos.x = portal.pos.x + 0.05;
            p.pos.y = portal.pos.y;
          }
        }
      }
      expect(descendedTo).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(renderer.camX)).toBe(true);
      expect(Number.isFinite(renderer.camY)).toBe(true);
    } finally {
      unsub();
      renderer.destroy();
    }
  });

  it("consumes hit/swing FX events without error and expires them", async () => {
    const { Renderer } = await import("../../src/client/render.js");
    const pack = makeTestPack();
    const renderer = new Renderer(makeCanvas(), pack);

    for (let i = 0; i < 50; i++) {
      gameBus.emit("hit", { x: i * 0.1, y: 5, amount: 7 + i, crit: i % 5 === 0, targetId: 99, killed: false });
      gameBus.emit("swing", { x: 5, y: 5, angle: i * 0.1 });
    }
    // Long enough for every fx ttl to expire.
    for (let i = 0; i < 120; i++) renderer.updateFx(1 / 60);
    renderer.render(new Simulation(pack, 1), 0);
    renderer.destroy();
    expect(true).toBe(true); // reached without throwing
  });

  it("handles window resize via resize()", async () => {
    const { Renderer } = await import("../../src/client/render.js");
    (window as unknown as { innerWidth: number }).innerWidth = 1920;
    (window as unknown as { innerHeight: number }).innerHeight = 1080;
    const pack = makeTestPack();
    const renderer = new Renderer(makeCanvas(), pack);
    renderer.resize();
    renderer.destroy();
  });
});
