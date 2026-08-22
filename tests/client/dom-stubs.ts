/**
 * Headless client-layer smoke tests.
 *
 * The renderer/audio/UI are the one layer QA bots can't reach, so we exercise
 * them here against minimal DOM/Canvas/WebAudio stubs. These tests catch
 * null-reference drift and API misuse that typechecking alone misses.
 */
import { vi } from "vitest";
import { makeTestPack } from "../fixtures/test-pack.js";
import { Simulation } from "../../src/engine/sim/simulation.js";
import { emptyInput } from "../../src/engine/sim/simulation.js";
import { gameBus } from "../../src/engine/sim/game-events.js";

// ---------------------------------------------------------------------------
// Minimal DOM stubs
// ---------------------------------------------------------------------------

const gradient = { addColorStop: vi.fn() };

/**
 * Recording no-op Canvas2D. Handlers are cached per property name — a naive
 * proxy returning a fresh mock per access OOMs under render loops.
 */
export function makeCtx2D(): CanvasRenderingContext2D {
  const cache = new Map<PropertyKey, unknown>();
  return new Proxy(
    { __cache: cache },
    {
      get(_t, prop) {
        if (cache.has(prop)) return cache.get(prop);
        let value: unknown;
        if (prop === "createRadialGradient" || prop === "createLinearGradient") {
          value = vi.fn(() => gradient);
        } else if (prop === "measureText") {
          value = vi.fn(() => ({ width: 10 }));
        } else if (prop === "canvas") {
          value = {};
        } else if (typeof prop === "symbol") {
          value = undefined;
        } else {
          value = vi.fn();
        }
        cache.set(prop, value);
        return value;
      },
      set(_t, prop, v) {
        cache.set(prop, v);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

export function makeCanvas(): HTMLCanvasElement {
  return {
    width: 800,
    height: 600,
    style: {},
    getContext: () => makeCtx2D(),
    addEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;
}

export function makeEl(id: string): HTMLElement {
  const classes = new Set<string>();
  const el = {
    id,
    style: {} as CSSStyleDeclaration,
    classList: {
      add: (c: string): void => void classes.add(c),
      remove: (c: string): void => void classes.delete(c),
      contains: (c: string): boolean => classes.has(c),
    },
    textContent: "",
    innerHTML: "",
    appendChild: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    disabled: false,
    value: "",
    // Canvas-shaped elements (minimap) work through the same stub.
    width: 180,
    height: 180,
    getContext: () => makeCtx2D(),
  };
  return el as unknown as HTMLElement;
}
