/** Small 2D vector / math helpers. All pure functions. */

export interface Vec2 {
  x: number;
  y: number;
}

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function vadd(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vsub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vscale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function vlen(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function vlen2(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function vdist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function vdist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function vnorm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  if (l < 1e-9) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/** Normalize angle into [-PI, PI]. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Shortest signed angular difference from a to b (-PI..PI). */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** Rotate vec by radians. */
export function vrotate(a: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export function approach(cur: number, target: number, maxDelta: number): number {
  if (cur < target) return Math.min(cur + maxDelta, target);
  return Math.max(cur - maxDelta, target);
}

/** Circle-vs-axis-aligned-rect overlap test. */
export function circleRectOverlap(
  cx: number, cy: number, r: number,
  rx: number, ry: number, rw: number, rh: number,
): boolean {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

/** Format seconds as m:ss. */
export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
