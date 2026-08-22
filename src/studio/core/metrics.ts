/**
 * Metrics registry — counters and timers with a Prometheus-ish text export.
 * Used to quantify the studio's own work (generation counts, fix loop
 * iterations, QA wall time) and game benchmarks.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export class Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private timings = new Map<string, { count: number; totalMs: number; maxMs: number }>();

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  /** Time a function; records count/total/max. */
  time<T>(name: string, fn: () => T): T {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      const ms = performance.now() - t0;
      const cur = this.timings.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
      cur.count++;
      cur.totalMs += ms;
      cur.maxMs = Math.max(cur.maxMs, ms);
      this.timings.set(name, cur);
    }
  }

  async timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      const ms = performance.now() - t0;
      const cur = this.timings.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
      cur.count++;
      cur.totalMs += ms;
      cur.maxMs = Math.max(cur.maxMs, ms);
      this.timings.set(name, cur);
    }
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.counters) out[`counter:${k}`] = v;
    for (const [k, v] of this.gauges) out[`gauge:${k}`] = v;
    for (const [k, t] of this.timings) {
      out[`timing:${k}:count`] = t.count;
      out[`timing:${k}:avg_ms`] = t.count ? t.totalMs / t.count : 0;
      out[`timing:${k}:max_ms`] = t.maxMs;
    }
    return out;
  }

  exportText(dir: string): void {
    mkdirSync(dir, { recursive: true });
    const lines: string[] = ["# studio metrics", ""];
    for (const [k, v] of Object.entries(this.snapshot())) {
      lines.push(`${k} ${Number.isFinite(v) ? v.toFixed(3) : "NaN"}`);
    }
    writeFileSync(join(dir, "metrics.txt"), lines.join("\n") + "\n");
  }
}
