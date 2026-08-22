/**
 * Uniform-grid spatial hash for broad-phase entity queries.
 *
 * Rebuilt per tick from the live entity list — O(n) with tiny constants,
 * which beats incremental updates at our scale (<1k entities) because it
 * avoids bookkeeping bugs and keeps behavior deterministic and simple.
 */
import type { Vec2 } from "./math";

export interface SpatialEntry {
  id: number;
  pos: Vec2;
  radius: number;
}

export class SpatialGrid {
  readonly cellSize: number;
  readonly width: number;
  readonly height: number;
  private buckets: number[][];
  private entries: SpatialEntry[] = [];

  constructor(width: number, height: number, cellSize = 2) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.buckets = new Array(Math.ceil(width / cellSize) * Math.ceil(height / cellSize));
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
  }

  /** Rebuild from a fresh set of entries. */
  rebuild(entries: SpatialEntry[]): void {
    for (const b of this.buckets) b.length = 0;
    this.entries = entries;
    for (const e of entries) {
      const idx = this.indexOf(e.pos.x, e.pos.y);
      if (idx >= 0) this.buckets[idx]!.push(e.id);
    }
  }

  private indexOf(x: number, y: number): number {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    if (cx < 0 || cy < 0 || cx >= this.cols() || cy >= this.rows()) return -1;
    return cy * this.cols() + cx;
  }

  cols(): number {
    return Math.ceil(this.width / this.cellSize);
  }

  rows(): number {
    return Math.ceil(this.height / this.cellSize);
  }

  /** Collect candidate ids near a circle. Results are ids only; caller filters precisely. */
  queryCircle(center: Vec2, radius: number, out: number[] = []): number[] {
    out.length = 0;
    const minCx = Math.max(0, Math.floor((center.x - radius) / this.cellSize));
    const maxCx = Math.min(this.cols() - 1, Math.floor((center.x + radius) / this.cellSize));
    const minCy = Math.max(0, Math.floor((center.y - radius) / this.cellSize));
    const maxCy = Math.min(this.rows() - 1, Math.floor((center.y + radius) / this.cellSize));
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.buckets[cy * this.cols() + cx];
        if (bucket) for (const id of bucket) out.push(id);
      }
    }
    return out;
  }
}
