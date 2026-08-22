/**
 * Canvas 2D renderer. Draws the simulation state plus client-side visual FX
 * derived from game events (damage numbers, sparks, swing arcs). Supports
 * position interpolation between sim ticks and camera shake.
 */
import { clamp } from "../engine/core/math.js";
import type { Vec2 } from "../engine/core/math.js";
import type { ContentPack } from "../engine/content/types.js";
import type { Entity, SimState } from "../engine/sim/state.js";
import type { Simulation } from "../engine/sim/simulation.js";
import { gameBus } from "../engine/sim/game-events.js";

const TILE = 34;

interface FloatText {
  x: number; y: number; text: string; color: string; age: number; ttl: number; size: number;
}
interface Spark {
  x: number; y: number; vx: number; vy: number; age: number; ttl: number; color: string; size: number;
}
interface ArcFx {
  x: number; y: number; angle: number; age: number; ttl: number; range: number; arc: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private pack: ContentPack;
  camX = 0;
  camY = 0;
  shake = 0;
  private floatTexts: FloatText[] = [];
  private sparks: Spark[] = [];
  private arcs: ArcFx[] = [];
  private prevPositions = new Map<number, Vec2>();
  private unsubscribers: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement, pack: ContentPack) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    this.pack = pack;

    const onResize = (): void => this.resize();
    window.addEventListener("resize", onResize);
    this.resize();

    // Event-driven FX.
    this.unsubscribers.push(
      gameBus.on("hit", (e) => {
        this.spawnFloat(e.x, e.y, e.crit ? `${e.amount}!` : `${e.amount}`, e.crit ? "#ffd700" : "#ff8a7a", e.crit ? 15 : 12);
        for (let i = 0; i < (e.crit ? 10 : 6); i++) this.spawnSpark(e.x, e.y, "#ffb454");
        this.shake = Math.min(this.shake + (e.crit ? 5 : 2.5), 9);
        if (e.killed) for (let i = 0; i < 14; i++) this.spawnSpark(e.x, e.y, "#c95aff");
      }),
      gameBus.on("hurt", () => {
        this.shake = Math.min(this.shake + 6, 12);
        flashHurtVignette();
      }),
      gameBus.on("swing", (e) => {
        this.arcs.push({
          x: e.x, y: e.y, angle: e.angle, age: 0,
          ttl: 0.13,
          range: this.pack.systems.player.attackRange,
          arc: (this.pack.systems.player.attackArcDeg * Math.PI) / 180,
        });
      }),
      gameBus.on("gold", () => this.spawnFloat(0, 0, "", "", 0)), // handled via pickups text below
      gameBus.on("levelUp", () => {
        toast("LEVEL UP!");
        this.audioCue?.("levelUp");
      }),
    );
  }

  /** Optional audio hook to keep sfx in one place. */
  audioCue?: (name: string) => void;

  resize(): void {
    this.canvas.width = window.innerWidth * window.devicePixelRatio;
    this.canvas.height = window.innerHeight * window.devicePixelRatio;
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
  }

  /** Record entity positions before a step so rendering can interpolate. */
  capturePreStep(sim: Simulation): void {
    this.prevPositions.clear();
    for (const e of sim.state.entities.values()) {
      this.prevPositions.set(e.id, { x: e.pos.x, y: e.pos.y });
    }
  }

  private lerpPos(e: Entity, alpha: number): Vec2 {
    const prev = this.prevPositions.get(e.id);
    if (!prev) return e.pos;
    return {
      x: prev.x + (e.pos.x - prev.x) * alpha,
      y: prev.y + (e.pos.y - prev.y) * alpha,
    };
  }

  updateFx(dtSec: number): void {
    for (const f of this.floatTexts) {
      f.age += dtSec;
      f.y -= dtSec * 1.4;
    }
    this.floatTexts = this.floatTexts.filter((f) => f.age < f.ttl);
    for (const s of this.sparks) {
      s.age += dtSec;
      s.x += s.vx * dtSec;
      s.y += s.vy * dtSec;
      s.vy += 6 * dtSec;
    }
    this.sparks = this.sparks.filter((s) => s.age < s.ttl);
    for (const a of this.arcs) a.age += dtSec;
    this.arcs = this.arcs.filter((a) => a.age < a.ttl);
    this.shake = Math.max(0, this.shake - dtSec * 26);
  }

  spawnFloat(x: number, y: number, text: string, color: string, size: number): void {
    this.floatTexts.push({ x, y, text, color, age: 0, ttl: 0.85, size });
  }

  spawnSpark(x: number, y: number, color: string): void {
    const a = Math.random() * Math.PI * 2;
    const sp = 1.5 + Math.random() * 3.5;
    this.sparks.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2,
      age: 0, ttl: 0.4 + Math.random() * 0.25, color, size: 2 + Math.random() * 2,
    });
  }

  render(sim: Simulation, alpha: number): void {
    const s = sim.state;
    const ctx = this.ctx;
    const pal = this.pack.palette;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // Camera.
    const player = s.entities.get(s.playerId);
    if (player) {
      const p = this.lerpPos(player, alpha);
      this.camX += (p.x - this.camX) * 0.18;
      this.camY += (p.y - this.camY) * 0.18;
    }
    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const originX = W / 2 - this.camX * TILE + shakeX;
    const originY = H / 2 - this.camY * TILE + shakeY;

    ctx.fillStyle = pal.background;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(originX, originY);

    this.drawTiles(s.map.tiles, s.map.width, s.map.height);
    this.drawTorches(s, alpha);
    if (player) this.drawPlayerLight(player, alpha);

    // Entities under FX.
    for (const e of s.entities.values()) {
      if (e.kind === "player" || e.kind === "fx") continue;
      this.drawEntity(sim, e, alpha);
    }
    if (player && s.status === "playing") this.drawPlayer(sim, player, alpha);
    this.drawArcs();
    this.drawSparks();

    ctx.restore();
    this.drawFloatingTexts(originX, originY);

    // Darkness vignette (screen-space).
    const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(3,4,8,0.55)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------------------
  private drawTiles(tiles: Uint8Array, w: number, h: number): void {
    const ctx = this.ctx;
    const pal = this.pack.palette;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = tiles[y * w + x]!;
        const px = x * TILE;
        const py = y * TILE;
        if (t === 0 || t === 3) {
          // Wall face + top lip.
          ctx.fillStyle = pal.wallFace;
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = t === 3 ? "#20263a" : pal.wallTop;
          ctx.fillRect(px, py, TILE, 7);
          if (t === 3) {
            ctx.fillStyle = "#39415c";
            ctx.fillRect(px + 8, py + 16, 5, 4);
            ctx.fillRect(px + 20, py + 22, 6, 4);
            ctx.fillRect(px + 13, py + 26, 4, 3);
          }
        } else {
          const alt = (x + y) % 2 === 0;
          ctx.fillStyle = t === 2 ? mix(pal.floorA, pal.accent, 0.22) : alt ? pal.floorA : pal.floorB;
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = "rgba(0,0,0,0.12)";
          ctx.fillRect(px, py + TILE - 2, TILE, 2);
          ctx.fillRect(px + TILE - 2, py, 2, TILE);
        }
      }
    }
  }

  private drawTorches(s: SimState, _alpha: number): void {
    const ctx = this.ctx;
    for (const t of s.floorDecor.torches) {
      const flicker = 0.85 + 0.15 * Math.sin(s.timeSec * 9 + t.x * 3.1);
      const g = ctx.createRadialGradient(t.x * TILE, t.y * TILE, 4, t.x * TILE, t.y * TILE, 90 * flicker);
      g.addColorStop(0, "rgba(255,170,70,0.28)");
      g.addColorStop(1, "rgba(255,140,40,0)");
      ctx.fillStyle = g;
      ctx.fillRect((t.x - 3) * TILE, (t.y - 3) * TILE, TILE * 6, TILE * 6);
      // Flame dot.
      ctx.fillStyle = "#ffd27a";
      ctx.beginPath();
      ctx.arc(t.x * TILE, t.y * TILE, 3.4 * flicker, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPlayerLight(player: Entity, _alpha: number): void {
    const ctx = this.ctx;
    // Soft glow around the ember-carrying hero.
    const grad = ctx.createRadialGradient(player.pos.x * TILE, player.pos.y * TILE, 8, player.pos.x * TILE, player.pos.y * TILE, 130);
    grad.addColorStop(0, "rgba(255,190,110,0.20)");
    grad.addColorStop(1, "rgba(255,160,80,0)");
    ctx.fillStyle = grad;
    ctx.fillRect((player.pos.x - 4) * TILE, (player.pos.y - 4) * TILE, TILE * 8, TILE * 8);
  }

  private drawEntity(sim: Simulation, e: Entity, alpha: number): void {
    const ctx = this.ctx;
    const pos = this.lerpPos(e, alpha);
    const px = pos.x * TILE;
    const py = pos.y * TILE;
    const r = e.radius * TILE;

    switch (e.kind) {
      case "portal": {
        const unlocked = sim.state.exitUnlocked;
        const pulse = 0.6 + 0.4 * Math.sin(sim.state.timeSec * 4);
        ctx.save();
        ctx.translate(px, py);
        if (unlocked) {
          const g = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 1.6);
          g.addColorStop(0, `rgba(120,220,255,${0.75 * pulse})`);
          g.addColorStop(1, "rgba(60,120,255,0)");
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#9fe8ff";
          ctx.lineWidth = 2.4;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(0, 0, r * (0.55 + i * 0.24), sim.state.timeSec * (1.4 + i * 0.7), sim.state.timeSec * (1.4 + i * 0.7) + 2.1);
            ctx.stroke();
          }
        } else {
          ctx.strokeStyle = "#5a637d";
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.stroke();
          // Chains / lock bars.
          ctx.strokeStyle = "#7a8299";
          ctx.lineWidth = 2;
          for (let i = 0; i < 3; i++) {
            const a0 = sim.state.timeSec * 0.4 + i * 2.1;
            ctx.beginPath(); ctx.arc(0, 0, r * 0.9, a0, a0 + 1.1); ctx.stroke();
          }
        }
        ctx.restore();
        break;
      }
      case "chest": {
        ctx.fillStyle = "#6b4a2b";
        roundedRect(ctx, px - r, py - r * 0.75, r * 2, r * 1.5, 4); ctx.fill();
        ctx.fillStyle = e.opened ? "#3d2c1c" : "#8a6238";
        roundedRect(ctx, px - r, py - r * 0.75, r * 2, r * 0.7, 4); ctx.fill();
        ctx.fillStyle = e.opened ? "#555" : "#ffd700";
        ctx.fillRect(px - 2.5, py - r * 0.35, 5, 6);
        break;
      }
      case "shrine": {
        const lit = !e.opened;
        const pulse = lit ? 0.65 + 0.35 * Math.sin(sim.state.timeSec * 3) : 0.25;
        ctx.fillStyle = "#3a4257";
        ctx.fillRect(px - r * 0.9, py - r * 0.2, r * 1.8, r * 1.1);
        const g = ctx.createRadialGradient(px, py - r * 0.5, 1, px, py - r * 0.5, r * 1.8);
        g.addColorStop(0, `rgba(255,180,84,${pulse})`);
        g.addColorStop(1, "rgba(255,150,50,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(px, py - r * 0.4, r * 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffd27a";
        ctx.beginPath();
        ctx.ellipse(px, py - r * 0.45, 3.5, 6 * pulse, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "npc": {
        const def = this.pack.npcDefs.find((n) => n.id === e.npcDefId);
        ctx.fillStyle = e.color ?? def?.color ?? "#c9b98a";
        ctx.beginPath();
        ctx.arc(px, py - 3 + Math.sin(sim.state.timeSec * 2.4 + e.bobPhase!) * 1.6, r, 0, Math.PI * 2);
        ctx.fill();
        // Marker when they have work for us.
        ctx.fillStyle = "#ffd700";
        ctx.font = "bold 13px monospace";
        ctx.textAlign = "center";
        ctx.fillText("!", px, py - r - 8 + Math.sin(sim.state.timeSec * 4) * 2);
        break;
      }
      case "enemy": {
        const def = sim.enemyDef(e.defId!);
        if (!def) break;
        const bob = Math.sin(sim.state.timeSec * 6 + e.bobPhase!) * 1.8;
        // Windup telegraph.
        if ((e.windupTimer ?? 0) > 0) {
          const k = 1 + 0.35 * Math.sin(sim.state.timeSec * 30);
          ctx.strokeStyle = `rgba(255,90,90,${0.5 + 0.4 * k})`;
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(px, py, r * 1.45, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.fillStyle = def.color;
        switch (def.shape) {
          case "blob":
            ctx.beginPath();
            ctx.ellipse(px, py + bob * 0.4, r * 1.08, r * (0.92 - 0.06 * Math.sin(sim.state.timeSec * 8)), 0, 0, Math.PI * 2);
            ctx.fill();
            break;
          case "imp":
            ctx.beginPath();
            ctx.moveTo(px, py - r - 3 + bob);
            ctx.lineTo(px + r, py + r * 0.7);
            ctx.lineTo(px - r, py + r * 0.7);
            ctx.closePath(); ctx.fill();
            break;
          case "brute":
            roundedRect(ctx, px - r, py - r + bob * 0.3, r * 2, r * 2, 5); ctx.fill();
            break;
          case "wraith": {
            const g = ctx.createRadialGradient(px, py, 2, px, py, r * 1.7);
            g.addColorStop(0, def.color);
            g.addColorStop(1, "rgba(255,180,84,0)");
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(px, py + bob, r * 1.7, 0, Math.PI * 2); ctx.fill();
            break;
          }
        }
        // Eyes.
        if (def.shape !== "wraith") {
          ctx.fillStyle = "#141019";
          const ex = Math.cos(e.facing) * r * 0.35;
          const ey = Math.sin(e.facing) * r * 0.35;
          ctx.beginPath(); ctx.arc(px - r * 0.28 + ex, py + ey - 2, 2.1, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(px + r * 0.28 + ex, py + ey - 2, 2.1, 0, Math.PI * 2); ctx.fill();
        }
        // HP bar when damaged.
        if (e.hp < e.maxHp) {
          const wpx = r * 2.2;
          ctx.fillStyle = "rgba(0,0,0,.6)";
          ctx.fillRect(px - wpx / 2, py - r - 10, wpx, 4);
          ctx.fillStyle = "#ff5a5a";
          ctx.fillRect(px - wpx / 2, py - r - 10, wpx * clamp(e.hp / e.maxHp, 0, 1), 4);
        }
        break;
      }
      case "itemDrop": {
        const def = this.pack.items.find((i) => i.id === e.itemId);
        const bob = Math.sin(sim.state.timeSec * 4 + e.bobPhase!) * 2.4;
        const col =
          def?.rarity === "epic" ? "#c95aff" :
          def?.rarity === "rare" ? "#5ad0ff" :
          def?.rarity === "uncommon" ? "#7ec850" : "#c9b98a";
        ctx.fillStyle = col;
        ctx.save();
        ctx.translate(px, py + bob);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-4.5, -4.5, 9, 9);
        ctx.restore();
        if (def?.rarity === "epic" || def?.rarity === "rare") {
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.4 + 0.3 * Math.sin(sim.state.timeSec * 5);
          ctx.beginPath(); ctx.arc(px, py + bob, 11, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        break;
      }
      case "key": {
        const bob = Math.sin(sim.state.timeSec * 3.4) * 2.6;
        ctx.fillStyle = "#ffd700";
        ctx.beginPath(); ctx.arc(px, py + bob, 4.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(px + 2, py + bob - 1.6, 9, 3.2);
        ctx.fillRect(px + 8, py + bob + 1.4, 2.6, 3);
        const g = ctx.createRadialGradient(px, py + bob, 2, px, py + bob, 26);
        g.addColorStop(0, "rgba(255,215,0,0.5)");
        g.addColorStop(1, "rgba(255,215,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(px, py + bob, 26, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "gold": {
        const bob = Math.sin(sim.state.timeSec * 5 + e.bobPhase!) * 1.8;
        ctx.fillStyle = "#ffd700";
        ctx.beginPath(); ctx.arc(px - 3, py + bob, 3.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(px + 3.5, py + bob + 1.5, 3, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "projectile": {
        ctx.fillStyle = "#ff8a5a";
        ctx.beginPath(); ctx.arc(px, py, 4.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,138,90,0.35)";
        ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "prop": {
        if (e.itemId === "barrel") {
          ctx.fillStyle = "#7a5230";
          ctx.beginPath(); ctx.ellipse(px, py, r, r * 1.15, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#4d3018"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(px - r, py - 2); ctx.lineTo(px + r, py - 2); ctx.stroke();
        } else {
          ctx.fillStyle = "#8a6f4a";
          rotatedRect(ctx, px, py, r * 1.9, r * 1.7, 0.3);
        }
        break;
      }
    }
  }

  private drawPlayer(sim: Simulation, p: Entity, alpha: number): void {
    const ctx = this.ctx;
    const pos = this.lerpPos(p, alpha);
    const px = pos.x * TILE;
    const py = pos.y * TILE;
    const r = p.radius * TILE;
    const pt = p.playerTimers!;

    // Dodge ghost trail.
    if (pt.dodgeTimeLeft > 0) {
      ctx.fillStyle = "rgba(127,215,255,0.25)";
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(px - pt.dodgeDirX * i * 7, py - pt.dodgeDirY * i * 7, r * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // I-frame flicker.
    const invulnerable = pt.iframes > 0 || pt.dodgeTimeLeft > 0;
    if (!invulnerable || Math.floor(sim.state.tick / 3) % 2 === 0) {
      // Body.
      ctx.fillStyle = "#e8dcc8";
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      // Cloak half facing direction.
      ctx.fillStyle = "#4a5a8a";
      ctx.beginPath();
      ctx.arc(px, py, r, p.facing + Math.PI / 2 + 0.5, p.facing - Math.PI / 2 - 0.5 + Math.PI * 2);
      ctx.closePath(); ctx.fill();
      // Ember core.
      ctx.fillStyle = "#ffb454";
      ctx.beginPath(); ctx.arc(px + Math.cos(p.facing) * r * 0.42, py + Math.sin(p.facing) * r * 0.42, 3, 0, Math.PI * 2); ctx.fill();
      // Aim wedge.
      ctx.strokeStyle = "rgba(255,214,140,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(p.facing) * (r + 2), py + Math.sin(p.facing) * (r + 2));
      ctx.lineTo(px + Math.cos(p.facing) * (r + 9), py + Math.sin(p.facing) * (r + 9));
      ctx.stroke();
    }
  }

  private drawArcs(): void {
    const ctx = this.ctx;
    for (const a of this.arcs) {
      const k = 1 - a.age / a.ttl;
      ctx.strokeStyle = `rgba(255,225,160,${0.75 * k})`;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(a.x * TILE, a.y * TILE, a.range * TILE * (0.7 + 0.3 * (1 - k)), a.angle - a.arc / 2, a.angle + a.arc / 2);
      ctx.stroke();
    }
  }

  private drawSparks(): void {
    const ctx = this.ctx;
    for (const s of this.sparks) {
      const k = 1 - s.age / s.ttl;
      ctx.fillStyle = s.color;
      ctx.globalAlpha = k;
      ctx.fillRect(s.x * TILE - s.size / 2, s.y * TILE - s.size / 2, s.size, s.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawFloatingTexts(originX: number, originY: number): void {
    const ctx = this.ctx;
    ctx.textAlign = "center";
    for (const f of this.floatTexts) {
      const k = 1 - f.age / f.ttl;
      ctx.font = `bold ${f.size}px monospace`;
      ctx.fillStyle = f.color;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.fillText(f.text, originX + f.x * TILE, originY + f.y * TILE);
    }
    ctx.globalAlpha = 1;
  }

  destroy(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
  }
}

// ---------------------------------------------------------------------------
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function rotatedRect(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, angle: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const rr = Math.round(ar + (br - ar) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  return `rgb(${rr},${rg},${rb})`;
}

function flashHurtVignette(): void {
  const el = document.getElementById("vignetteHurt");
  if (!el) return;
  el.style.boxShadow = "inset 0 0 120px 40px rgba(200,30,30,0.55)";
  setTimeout(() => {
    el.style.boxShadow = "inset 0 0 120px 40px rgba(200,30,30,0)";
  }, 180);
}

export function toast(text: string): void {
  const wrap = document.getElementById("toasts");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
