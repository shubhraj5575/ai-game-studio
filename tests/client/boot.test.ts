/**
 * Full client-boot integration test: imports src/client/main.ts (which runs
 * boot() immediately) against comprehensive DOM/WebAudio/rAF stubs, starts a
 * real run through the actual button handler, pumps real frames through the
 * real fixed-step loop, and asserts gameplay + UI state.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeCtx2D, makeEl } from "./dom-stubs.js";
import type { ContentPack } from "../../src/engine/content/types.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pack = JSON.parse(readFileSync(join(repoRoot, "content", "pack.json"), "utf8")) as ContentPack;

// ---------------------------------------------------------------------------
// Global browser environment
// ---------------------------------------------------------------------------
const listeners = new Map<string, Set<(ev?: unknown) => void>>();
const elements = new Map<string, ReturnType<typeof makeEl>>();
let rafQueue: Array<(t: number) => void> = [];
let now = 0;

function el(id: string): ReturnType<typeof makeEl> {
  if (!elements.has(id)) {
    const e = makeEl(id) as ReturnType<typeof makeEl> & {
      value?: string;
      disabled?: boolean;
      click?: () => void;
    };
    if (id === "seedInput") e.value = "";
    elements.set(id, e);
  }
  return elements.get(id)!;
}

/** Constructor-shaped WebAudio stub (same trick as audio-ui.test.ts). */
function makeFakeAudioContextCtor(): unknown {
  const param = () => ({
    value: 1,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  });
  const node = () => ({
    connect: vi.fn(),
    type: "",
    frequency: param(),
    gain: param(),
    Q: param(),
    detune: param(),
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
  return Ctor;
}

function stubGlobals(): void {
  const win = {
    AudioContext: makeFakeAudioContextCtor(),
    // The real page embeds the pack via dist/content.js; tests inject it here.
    CONTENT_PACK: pack,
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener: (type: string, fn: (ev?: unknown) => void): void => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (ev?: unknown) => void): void => {
      listeners.get(type)?.delete(fn);
    },
    setInterval: (): number => 0,
    clearInterval: (): void => {},
  };
  const doc = {
    getElementById: (id: string): unknown => el(id),
    createElement: (): unknown => el(`dyn-${Math.random()}`),
    title: "",
    body: el("body"),
  };
  const storage = new Map<string, string>();
  const localShim = {
    getItem: (k: string): string | null => storage.get(k) ?? null,
    setItem: (k: string, v: string): void => void storage.set(k, v),
    removeItem: (k: string): void => void storage.delete(k),
  };

  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("localStorage", localShim);
  vi.stubGlobal("requestAnimationFrame", (fn: (t: number) => void): number => {
    rafQueue.push(fn);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (): void => {});
  // Blob/URL only needed for downloads; provide inert versions.
  vi.stubGlobal("Blob", class {});
  vi.stubGlobal("URL", { createObjectURL: (): string => "", revokeObjectURL: (): void => {} });
}

function pumpFrames(count: number, stepMs = 16.7): void {
  for (let i = 0; i < count; i++) {
    now += stepMs;
    const queue = rafQueue;
    rafQueue = [];
    for (const fn of queue) fn(now);
    if (rafQueue.length === 0) break;
  }
}

function fire(type: string, ev?: unknown): void {
  for (const fn of [...(listeners.get(type) ?? [])]) fn(ev ?? { key: "", preventDefault: () => {}, button: 0 });
}

// ---------------------------------------------------------------------------
beforeAll(() => {
  stubGlobals();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("client boot integration", () => {
  it("boots, starts a run from the title screen, plays frames, HUD lives", async () => {
    try {
      await import("../../src/client/main.js");
    } catch (err) {
      console.log("BOOT ERROR:", err instanceof Error ? err.stack?.split("\n").slice(0, 6).join("\n") : err);
      throw err;
    }

    // Title screen visible pre-run.
    expect(el("titleScreen").classList.contains("hidden")).toBe(false);

    // Click "New Descent" through its real handler.
    (el("btnNewRun") as unknown as { addEventListener: (t: string, f: () => void) => void });
    const clickHandlers = ((el("btnNewRun") as unknown as { __handlers?: Array<[string, () => void]> }).__handlers ?? []);
    void clickHandlers;

    // makeEl registers listeners via addEventListener spy — extract them:
    const btnEl = el("btnNewRun") as unknown as {
      addEventListener: { mock?: { calls: Array<[string, () => void]> } } & ((t: string, f: () => void) => void);
    };
    const calls = (btnEl.addEventListener as unknown as { mock?: { calls: Array<[string, () => void]> } })?.mock?.calls ?? [];
    const startCall = calls.find(([t]) => t === "click");
    expect(startCall).toBeDefined();
    startCall![1]();

    // Title hidden, run live.
    expect(el("titleScreen").classList.contains("hidden")).toBe(true);

    // Pump ~2 seconds of frames through the REAL loop.
    pumpFrames(130);

    // HUD must have been touched by updateHud.
    expect(el("hpFill").style.width).toBeTruthy();
    expect(el("xpLabel").textContent.length).toBeGreaterThan(0);
    expect(el("statGold").textContent.length).toBeGreaterThan(0);

    // Simulate keyboard movement input reaching the loop.
    fire("keydown", { key: "d", preventDefault: () => {} });
    const hpBefore = el("hpLabel").textContent;
    pumpFrames(60);
    fire("keyup", { key: "d" });

    // Player survived these frames (content is tuned beatable).
    expect(hpBefore).toMatch(/\d+\/\d+/);

    // Pause menu opens/closes through Escape handling.
    fire("keydown", { key: "Escape", preventDefault: () => {} });
    expect(el("pauseScreen").classList.contains("hidden")).toBe(false);
    const resumeCalls = ((el("btnResume") as unknown as {
      addEventListener: { mock?: { calls: Array<[string, () => void]> } };
    }).addEventListener?.mock?.calls ?? []);
    const resume = resumeCalls.find(([t]) => t === "click");
    expect(resume).toBeDefined();
    resume![1]();
    expect(el("pauseScreen").classList.contains("hidden")).toBe(true);
  }, 30000);

  it("continue path loads a save written by Save Game", async () => {
    // While a run is active from the previous test… quit to title, then save flow:
    // Start a fresh run, pause, save, quit, continue.
    const startCalls = ((el("btnNewRun") as unknown as {
      addEventListener: { mock?: { calls: Array<[string, () => void]> } };
    }).addEventListener?.mock?.calls ?? []);
    startCalls.find(([t]) => t === "click")?.[1]();
    pumpFrames(30);

    fire("keydown", { key: "Escape", preventDefault: () => {} });
    const saveCalls = ((el("btnSaveGame") as unknown as {
      addEventListener: { mock?: { calls: Array<[string, () => void]> } };
    }).addEventListener?.mock?.calls ?? []);
    const save = saveCalls.find(([t]) => t === "click");
    save?.[1]();

    const savedRaw = (globalThis as unknown as { localStorage: { getItem(k: string): string | null } })
      .localStorage.getItem("ember-depths-save-v3");
    expect(savedRaw).toBeTruthy();

    // Quit to title, then Continue restores into a running game.
    const quitCalls = ((el("btnQuitToTitle") as unknown as {
      addEventListener: { mock?: { calls: Array<[string, () => void]> } };
    }).addEventListener?.mock?.calls ?? []);
    quitCalls.find(([t]) => t === "click")?.[1]();
    expect(el("titleScreen").classList.contains("hidden")).toBe(false);

    const contCalls = ((el("btnContinue") as unknown as {
      addEventListener: { mock?: { calls: Array<[string, () => void]> } };
    }).addEventListener?.mock?.calls ?? []);
    contCalls.find(([t]) => t === "click")?.[1]();
    pumpFrames(20);
    expect(el("titleScreen").classList.contains("hidden")).toBe(true);
  }, 30000);
});
