/**
 * Browser client entry: fixed-timestep loop, input mapping, screen flow.
 * The simulation is driven through the exact same API the QA bots use.
 */
import type { ContentPack } from "../engine/content/types.js";
import { Simulation } from "../engine/sim/simulation.js";
import type { FrameInput } from "../engine/sim/simulation.js";
import { emptyInput } from "../engine/sim/simulation.js";
import { snapshot, restoreFromSnapshot } from "../engine/sim/save.js";
import { gameBus } from "../engine/sim/game-events.js";
import { AudioSystem } from "./audio.js";
import { Renderer, toast } from "./render.js";
import { UI } from "./ui.js";

declare global {
  interface Window {
    CONTENT_PACK?: ContentPack;
  }
}

const SAVE_KEY = "ember-depths-save-v3";
const FIXED_DT = 1 / 60;

function boot(): void {
  const pack = window.CONTENT_PACK;
  if (!pack) {
    document.body.innerHTML =
      '<div style="display:grid;place-items:center;height:100vh;color:#e8e6df;font-family:monospace">content.js missing — run <code>npm run build:game</code></div>';
    return;
  }

  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const renderer = new Renderer(canvas, pack);
  const ui = new UI(pack);
  const audio = new AudioSystem();
  ui.applyBranding();
  audio.setTheme(pack.audio);
  renderer.audioCue = (name) => audio.playSfx(name);

  // SFX wiring via game events.
  const unsubSfx = [
    gameBus.on("swing", () => audio.playSfx("swing")),
    gameBus.on("hit", (e) => audio.playSfx(e.crit ? "hit" : "hit")),
    gameBus.on("hurt", () => audio.playSfx("hurt")),
    gameBus.on("pickup", () => audio.playSfx("pickup")),
    gameBus.on("gold", () => audio.playSfx("buy")),
    gameBus.on("potionUsed", () => audio.playSfx("pickup")),
    gameBus.on("chestOpened", () => audio.playSfx("chest")),
    gameBus.on("shrineUsed", () => audio.playSfx("levelUp")),
    gameBus.on("keyFound", () => {
      audio.playSfx("levelUp");
      toast("You found the Depth Key!");
    }),
    gameBus.on("questAccepted", (e) => toast(`Quest accepted — ${e.title}`)),
    gameBus.on("questCompleted", (e) => {
      audio.playSfx("levelUp");
      toast(`Quest complete — ${e.title}`);
    }),
    gameBus.on("buy", (e) => toast(`Bought for ${e.price}g`)),
    gameBus.on("portalLocked", (e) => toast(e.reason)),
    gameBus.on("death", (e) => audio.playSfx("death")),
    gameBus.on("descend", (e) => {
      if (e.depth > 1 && sim) {
        audio.playSfx("portal");
        ui.showFloorBanner(`DEPTH ${e.depth} · ${sim.state.floorName}`);
        audio.startMusic(currentFloorScale(), sim.state.seed ^ (e.depth << 12));
      }
    }),
  ];

  // ---------------------------------------------------------------------------
  // Game session state
  // ---------------------------------------------------------------------------
  let sim: Simulation | null = null;
  let running = false;
  let paused = false;
  let accumulator = 0;
  let lastTime = 0;
  let rafId = 0;
  let dialogueRefreshNeeded = false;

  const currentFloorScale = (): string =>
    sim?.pack.floors.find((f) => f.depth === sim!.state.depth)?.musicScaleId ?? "minorPentatonic";

  const keys = new Set<string>();
  let mouseAimX = 0;
  let mouseAimY = 0;
  let mouseDown = false;

  const readInput = (): FrameInput => {
    const input = emptyInput();
    if (keys.has("w") || keys.has("arrowup")) input.moveY -= 1;
    if (keys.has("s") || keys.has("arrowdown")) input.moveY += 1;
    if (keys.has("a") || keys.has("arrowleft")) input.moveX -= 1;
    if (keys.has("d") || keys.has("arrowright")) input.moveX += 1;

    // Mouse aim relative to player's screen position.
    if (sim) {
      const p = sim.player();
      if (p) {
        const px = window.innerWidth / 2 + (p.pos.x - renderer.camX) * 34;
        const py = window.innerHeight / 2 + (p.pos.y - renderer.camY) * 34;
        mouseAimX = lastMouseX - px;
        mouseAimY = lastMouseY - py;
      }
    }
    const aimLen = Math.hypot(mouseAimX, mouseAimY);
    if (aimLen > 4 && !usingKeyboardAimOnly()) {
      input.aimX = mouseAimX / aimLen;
      input.aimY = mouseAimY / aimLen;
    }
    input.attackHeld = mouseDown || keys.has("j");
    input.dodgePressed = consumeKey(" ");
    input.interactPressed = consumeKey("e");
    return input;
  };

  // Edge-triggered keys: track which were pressed since last read.
  const edgeKeys = new Set<string>();
  const markEdge = (k: string): void => {
    if (!keys.has(k)) edgeKeys.add(k);
  };
  const consumeKey = (k: string): boolean => {
    if (edgeKeys.has(k)) {
      edgeKeys.delete(k);
      return true;
    }
    return false;
  };
  function usingKeyboardAimOnly(): boolean {
    return false; // reserved: gamepad support
  }

  let lastMouseX = window.innerWidth / 2;
  let lastMouseY = window.innerHeight / 2;

  window.addEventListener("keydown", (ev) => {
    const k = ev.key.toLowerCase();
    if (k === " " || k.startsWith("arrow")) ev.preventDefault();
    if (!keys.has(k)) edgeKeys.add(k);
    keys.add(k);

    // Global hotkeys (work while playing).
    if (!running || paused) return;
    if (k === "q" && sim) {
      const res = sim.usePotion();
      if (res === "none") toast("No potions!");
      else if (res === "full-hp") toast("Already at full health");
    }
    if ((k === "i" || k === "tab") && sim) {
      ev.preventDefault();
      ui.toggleInventory(sim);
    }
  });
  window.addEventListener("keyup", (ev) => keys.delete(ev.key.toLowerCase()));
  window.addEventListener("mousemove", (ev) => {
    lastMouseX = ev.clientX;
    lastMouseY = ev.clientY;
  });
  window.addEventListener("mousedown", (ev) => {
    audio.unlock();
    if (ev.button === 0) mouseDown = true;
  });
  window.addEventListener("mouseup", (ev) => {
    if (ev.button === 0) mouseDown = false;
  });

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------
  const hasSave = (): boolean => localStorage.getItem(SAVE_KEY) !== null;

  const refreshContinue = (): void => {
    if (hasSave()) {
      try {
        const env = JSON.parse(localStorage.getItem(SAVE_KEY)!);
        ui.setContinueInfo(`Saved descent: depth ${env.depth}, level ${env.data.level} (${new Date(env.savedAtIso).toLocaleString()})`);
      } catch {
        ui.setContinueInfo("");
      }
    } else {
      ui.setContinueInfo("");
    }
  };

  const startRun = (seed?: number): void => {
    const chosenSeed =
      seed ??
      (() => {
        const raw = ui.seedInputValue();
        if (raw.length > 0) {
          const asNum = Number(raw);
          if (Number.isFinite(asNum) && raw.match(/^\d+$/)) return asNum | 0;
          // String seed → hash.
          let h = 2166136261;
          for (let i = 0; i < raw.length; i++) {
            h ^= raw.charCodeAt(i);
            h = Math.imul(h, 16777619);
          }
          return h | 0;
        }
        return (Math.random() * 2 ** 31) | 0;
      })();

    sim = new Simulation(pack, chosenSeed);
    beginPlay();
  };

  const continueRun = (): void => {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    try {
      sim = restoreFromSnapshot(pack, raw);
      beginPlay();
    } catch (err) {
      toast(`Save incompatible: ${(err as Error).message.split("\n")[0]?.slice(0, 80)}`);
      localStorage.removeItem(SAVE_KEY);
      refreshContinue();
    }
  };

  const beginPlay = (): void => {
    ui.hide("titleScreen");
    ui.hide("deathScreen");
    ui.hide("victoryScreen");
    running = true;
    paused = false;
    accumulator = 0;
    lastTime = performance.now();
    audio.unlock();
    audio.startMusic(currentFloorScale(), sim!.state.seed);
    ui.showFloorBanner(`DEPTH 1 · ${sim!.state.floorName}`);
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  };

  const quitToTitle = (): void => {
    running = false;
    paused = false;
    audio.stopMusic();
    ui.hide("pauseScreen");
    ui.hide("shopPanel");
    ui.hide("inventory");
    ui.closeDialogue();
    ui.show("titleScreen");
    refreshContinue();
  };

  const saveGame = (): void => {
    if (!sim) return;
    try {
      localStorage.setItem(SAVE_KEY, snapshot(sim));
      ui.setSaveStatus(`Saved at depth B${sim.state.depth}.`);
      toast("Game saved");
    } catch (err) {
      ui.setSaveStatus(`Save failed: ${(err as Error).message}`);
    }
  };

  (document.getElementById("btnNewRun") as HTMLButtonElement).addEventListener("click", () => startRun());
  (document.getElementById("btnContinue") as HTMLButtonElement).addEventListener("click", () => continueRun());
  (document.getElementById("btnHow") as HTMLButtonElement).addEventListener("click", () => {
    ui.show("howScreen");
  });
  (document.getElementById("howBack") as HTMLButtonElement).addEventListener("click", () => ui.hide("howScreen"));
  (document.getElementById("btnResume") as HTMLButtonElement).addEventListener("click", () => togglePause(false));
  (document.getElementById("btnSaveGame") as HTMLButtonElement).addEventListener("click", () => saveGame());
  (document.getElementById("btnMute") as HTMLButtonElement).addEventListener("click", () => {
    audio.setMuted(!audio.isMuted);
    toast(audio.isMuted ? "Sound off" : "Sound on");
  });
  (document.getElementById("btnQuitToTitle") as HTMLButtonElement).addEventListener("click", () => quitToTitle());
  (document.getElementById("btnDeathTitle") as HTMLButtonElement).addEventListener("click", () => quitToTitle());
  (document.getElementById("btnVictoryTitle") as HTMLButtonElement).addEventListener("click", () => quitToTitle());
  (document.getElementById("shopClose") as HTMLButtonElement).addEventListener("click", () => {
    ui.hide("shopPanel");
    ui.closeDialogue();
  });

  const togglePause = (on: boolean): void => {
    paused = on;
    if (on) ui.show("pauseScreen");
    else {
      ui.hide("pauseScreen");
      lastTime = performance.now();
    }
  };

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (ui.isVisible("shopPanel")) {
        ui.hide("shopPanel");
        ui.closeDialogue();
      } else if (ui.isVisible("inventory")) {
        ui.hide("inventory");
      } else if (running) {
        togglePause(!paused);
      }
    }
  });

  ui.onItemClick = (s, def, equipped) => {
    if (equipped) {
      toast(`${def.name}: unequipping not needed — swap by equipping another`);
      return;
    }
    if (def.kind === "potion") {
      const res = s.usePotion();
      if (res === "ok") audio.playSfx("pickup");
      return;
    }
    if (def.kind === "weapon" || def.kind === "armor" || def.kind === "relic") {
      if (s.equipFromBag(def.id)) audio.playSfx("buy");
      else toast("No free relic slot (max 2)");
    }
  };

  // Shrine autosave hook.
  gameBus.on("shrineUsed", () => saveGame());

  refreshContinue();

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  function loop(now: number): void {
    rafId = requestAnimationFrame(loop);
    if (!running || !sim) return;
    if (paused) {
      renderer.render(sim, 0);
      return;
    }

    let frameTime = (now - lastTime) / 1000;
    lastTime = now;
    if (frameTime > 0.25) frameTime = 0.25; // tab-switch guard
    accumulator += frameTime;

    let steps = 0;
    while (accumulator >= FIXED_DT && steps < 5) {
      if (ui.isVisible("dialogue")) {
        // While talking, movement is zeroed but time passes (NPC idle etc.).
        const input = emptyInput();
        sim.step(input);
      } else {
        renderer.capturePreStep(sim);
        sim.step(readInput());
      }
      accumulator -= FIXED_DT;
      steps++;

      // Dialogue may have opened this tick.
      if (sim.state.dialogue && !ui.isVisible("dialogue")) {
        dialogueRefreshNeeded = true;
      }
    }

    if (dialogueRefreshNeeded && sim.state.dialogue) {
      dialogueRefreshNeeded = false;
      ui.openDialogue(sim, () => {});
    } else if (!sim.state.dialogue && ui.isVisible("dialogue")) {
      ui.closeDialogue();
    } else if (sim.state.dialogue) {
      // Refresh button availability (turn-in becomes possible mid-conversation).
      ui.openDialogue(sim, () => {});
    }

    // End states.
    if (sim.state.status === "dead" && running) {
      running = false;
      audio.stopMusic();
      ui.showDeath(sim.state.lastDamageSource, sim);
    }
    if (sim.state.status === "victory" && running) {
      running = false;
      audio.stopMusic();
      audio.playSfx(pack && "victory" in pack.audio.sfx ? "victory" : "levelUp");
      ui.showVictory(sim);
    }

    // Per-frame updates.
    const dtSec = Math.min(frameTime, 0.05);
    renderer.updateFx(dtSec);
    renderer.render(sim, accumulator / FIXED_DT);
    ui.updateHud(sim);
    ui.updateQuests(sim);
    ui.renderMinimap(sim);
  }
}

boot();
