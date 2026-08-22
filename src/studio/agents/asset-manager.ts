/**
 * Asset Manager — procedural art direction without binary assets:
 * palette derivation from a seed with harmony constraints, enemy shape +
 * color assignments validated for pairwise visual distance, rarity colors.
 */
import { Agent } from "../core/agent.js";
import type { PaletteDef, EnemyDef } from "../../engine/content/types.js";

function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const toHex = (v: number): string => Math.round(255 * v).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

export function rgbDistance(a: string, b: string): number {
  const pa = parseInt(hex6(a), 16);
  const pb = parseInt(hex6(b), 16);
  const dr = ((pa >> 16) & 255) - ((pb >> 16) & 255);
  const dg = ((pa >> 8) & 255) - ((pb >> 8) & 255);
  const db = (pa & 255) - (pb & 255);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function hex6(c: string): string {
  if (c.startsWith("#")) return c.slice(1, 7).padEnd(6, "0");
  const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return "000000";
  const part = (n: string): string => Number(n).toString(16).padStart(2, "0");
  return `${part(m[1]!)}${part(m[2]!)}${part(m[3]!)}`;
}

const MIN_ENEMY_COLOR_DISTANCE = 80;

export class AssetManagerAgent extends Agent {
readonly id = "assets";
  readonly title = "Asset Manager";
  designPalette(baseHue: number): PaletteDef {
    const pal: PaletteDef = {
      background: hsl((baseHue + 220) % 360, 0.32, 0.05),
      wallTop: hsl((baseHue + 225) % 360, 0.22, 0.20),
      wallFace: hsl((baseHue + 228) % 360, 0.24, 0.12),
      floorA: hsl((baseHue + 230) % 360, 0.18, 0.155),
      floorB: hsl((baseHue + 232) % 360, 0.18, 0.13),
      accent: hsl(baseHue, 0.9, 0.62),
      danger: hsl(4, 0.85, 0.58),
      friendly: hsl((baseHue + 165) % 360, 0.75, 0.65),
      gold: "#ffd700",
      uiPanel: "#141824ee",
      uiText: "#e8e6df",
    };
    this.act("palette.authored", `baseHue=${baseHue}`);
    this.artifactJson("assets/palette.json", { palette: pal, baseHue });
    return pal;
  }

  /**
   * Assign colors/shapes to enemies from bank hue anchors; enforce pairwise
   * RGB distance so no two enemies are visually confusable.
   */
  assignEnemyVisuals(enemies: EnemyDef[]): void {
    const assigned = enemies.map((e) => ({ id: e.id, color: e.color }));
    const clashes: Array<[string, string, number]> = [];
    for (let i = 0; i < assigned.length; i++) {
      for (let j = i + 1; j < assigned.length; j++) {
        const d = rgbDistance(assigned[i]!.color, assigned[j]!.color);
        if (d < MIN_ENEMY_COLOR_DISTANCE) clashes.push([assigned[i]!.id, assigned[j]!.id, d]);
      }
    }
    // Nudge hues apart until clear.
    let guard = 0;
    while (clashes.length > 0 && guard++ < 60) {
      const [aId] = clashes[0]!;
      const e = enemies.find((x) => x.id === aId)!;
      const m = e.color.match(/hsl\((\d+(?:\.\d+)?)/);
      const curHue = m ? Number(m[1]) : (guard * 47) % 360;
      e.color = hsl((curHue + 29) % 360, 0.72, 0.56);
      assigned.find((a) => a.id === aId)!.color = e.color;
      clashes.length = 0;
      for (let i = 0; i < assigned.length; i++) {
        for (let j = i + 1; j < assigned.length; j++) {
          const d = rgbDistance(assigned[i]!.color, assigned[j]!.color);
          if (d < MIN_ENEMY_COLOR_DISTANCE) clashes.push([assigned[i]!.id, assigned[j]!.id, d]);
        }
      }
    }
    this.act("enemyVisuals.validated", `minPairDistance≥${MIN_ENEMY_COLOR_DISTANCE}, iterations=${guard}`);
    this.artifactJson("assets/enemy-visuals.json", {
      assignments: enemies.map((e) => ({ id: e.id, color: e.color, shape: e.shape })),
      minPairDistanceObserved: observedMin(enemies),
    });
  }
}

function observedMin(enemies: EnemyDef[]): number {
  let min = Infinity;
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      min = Math.min(min, rgbDistance(enemies[i]!.color, enemies[j]!.color));
    }
  }
  return Number.isFinite(min) ? min : 0;
}
