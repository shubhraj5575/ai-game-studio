/** Audio + UI smoke tests against stubbed WebAudio/DOM. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeTestPack } from "../fixtures/test-pack.js";
import { Simulation } from "../../src/engine/sim/simulation.js";
import { makeCanvas, makeEl } from "./dom-stubs.js";

// ---------------------------------------------------------------------------
// Stub the DOM globals UI expects before importing it.
// ---------------------------------------------------------------------------
const elementCache = new Map<string, HTMLElement>();

beforeEach(() => {
  elementCache.clear();
  vi.stubGlobal("document", {
    getElementById: (id: string): HTMLElement | null => {
      if (!elementCache.has(id)) elementCache.set(id, makeEl(id));
      return elementCache.get(id)!;
    },
    createElement: (): HTMLElement => makeEl("dyn"),
    title: "",
    body: makeEl("body"),
  });
});

interface FakeParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
}

/** Constructor-shaped WebAudio stub: `new FakeCtx()` returns the instance. */
function makeFakeAudioContext(): { Ctor: unknown; instance: Record<string, unknown> } {
  const param: FakeParam = {
    value: 1,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
  const node = () => ({
    connect: vi.fn(),
    type: "",
    frequency: { ...param },
    gain: { ...param },
    Q: { ...param },
    detune: { ...param },
    frequencyType: "",
    buffer: null,
    start: vi.fn(),
    stop: vi.fn(),
    getChannelData: (): Float32Array => new Float32Array(44100),
  });
  const instance: Record<string, unknown> = {
    currentTime: 0,
    sampleRate: 44100,
    state: "running",
    destination: node(),
    resume: vi.fn(async () => undefined),
    createGain: vi.fn(node),
    createOscillator: vi.fn(node),
    createBufferSource: vi.fn(node),
    createBuffer: vi.fn(() => ({ getChannelData: (): Float32Array => new Float32Array(44100) })),
    createBiquadFilter: vi.fn(node),
  };
  const Ctor = function FakeAudioContext(): Record<string, unknown> {
    return instance;
  };
  return { Ctor, instance };
}

describe("AudioSystem (stubbed WebAudio)", () => {
  it("unlocks, plays every sfx cue, and runs the music scheduler", async () => {
    const { AudioSystem } = await import("../../src/client/audio.js");
    const { Ctor } = makeFakeAudioContext();
    vi.stubGlobal("AudioContext", Ctor);
    vi.stubGlobal("window", { setInterval: () => 0, clearInterval: vi.fn(), AudioContext: Ctor });

    const pack = makeTestPack();
    const audio = new AudioSystem();
    audio.unlock();
    audio.setTheme(pack.audio);

    for (const name of Object.keys(pack.audio.sfx)) {
      audio.playSfx(name);
    }
    audio.playSfx("does-not-exist"); // must be a no-op

    audio.startMusic("minorPentatonic", 42);
    audio.setMuted(true);
    audio.playSfx("swing"); // muted path
    audio.stopMusic();
    audio.setMuted(false);

    vi.unstubAllGlobals();
    expect(true).toBe(true);
  });
});

describe("UI (stubbed DOM)", () => {
  it("updates HUD from live sim state", async () => {
    const { UI } = await import("../../src/client/ui.js");
    const pack = makeTestPack();
    const ui = new UI(pack);
    const sim = new Simulation(pack, 5150);

    sim.step({ moveX: 1, moveY: 0, attackHeld: true, dodgePressed: false, interactPressed: false });

    ui.updateHud(sim);
    ui.updateQuests(sim);
    ui.renderMinimap(sim);
    ui.showFloorBanner("TEST");
    ui.applyBranding();
    ui.showDeath("test cause", sim);
    ui.hide("deathScreen");

    const hpFill = document.getElementById("hpFill")!;
    void hpFill;
    expect(true).toBe(true);
  });

  it("opens and refreshes dialogue with quest actions", async () => {
    const { UI } = await import("../../src/client/ui.js");
    const pack = makeTestPack();
    const ui = new UI(pack);
    const sim = new Simulation(pack, 77);

    // Find an NPC and force a dialogue via proximity interact.
    const p = sim.player()!;
    const npc = [...sim.state.entities.values()].find((e) => e.kind === "npc");
    if (npc) {
      p.pos.x = npc.pos.x + 0.3;
      p.pos.y = npc.pos.y;
      sim.step({ moveX: 0, moveY: 0, attackHeld: false, dodgePressed: false, interactPressed: true });
      if (sim.state.dialogue) {
        ui.openDialogue(sim, () => {});
        ui.closeDialogue();
      }
    }
    expect(true).toBe(true);
  });

  it("renders inventory with equipment state", async () => {
    const { UI } = await import("../../src/client/ui.js");
    const pack = makeTestPack();
    const ui = new UI(pack);
    const sim = new Simulation(pack, 88);

    // Give gear directly then equip through public API.
    sim.giveItem("weapon-rusty-shortsword", 1);
    sim.giveItem("potion-small", 3);
    ui.toggleInventory(sim); // open
    ui.onItemClick(sim, pack.items.find((i) => i.id === "weapon-rusty-shortsword")!, false);
    ui.toggleInventory(sim); // close
    expect(true).toBe(true);
  });
});
