/**
 * A* pathfinding over the tile grid. 8-directional movement with no corner
 * cutting (diagonal allowed only when both orthogonal neighbors are open).
 *
 * Paths are computed lazily by AI agents and cached; this module is stateless.
 */
import type { GameMap } from "./map";

interface Node {
  idx: number;
  g: number;
  f: number;
}

const NEIGHBORS: Array<[number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * Find a path of tile centers from (sx,sy) to (tx,ty), both in tile coords.
 * Returns array of {x,y} world-space waypoints (tile centers), excluding the
 * start tile and including the goal. Empty array when unreachable.
 */
export function findPath(
  map: GameMap,
  sx: number, sy: number,
  tx: number, ty: number,
  maxExpand = 4000,
): Array<{ x: number; y: number }> {
  sx = Math.floor(sx); sy = Math.floor(sy);
  tx = Math.floor(tx); ty = Math.floor(ty);
  if (!map.inBounds(sx, sy) || !map.inBounds(tx, ty)) return [];
  if (!map.isWalkable(tx, ty) || !map.isWalkable(sx, sy)) return [];
  if (sx === tx && sy === ty) return [];

  const w = map.width;
  const startIdx = sy * w + sx;
  const goalIdx = ty * w + tx;

  const gScore = new Float32Array(w * map.height).fill(Infinity);
  const cameFrom = new Int32Array(w * map.height).fill(-1);
  const closed = new Uint8Array(w * map.height);

  // Binary heap of nodes keyed by f.
  const heap: Node[] = [];
  const push = (n: Node) => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.f <= heap[i]!.f) break;
      const t = heap[p]!; heap[p] = heap[i]!; heap[i] = t;
      i = p;
    }
  };
  const pop = (): Node | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]!.f < heap[m]!.f) m = l;
        if (r < heap.length && heap[r]!.f < heap[m]!.f) m = r;
        if (m === i) break;
        const t = heap[m]!; heap[m] = heap[i]!; heap[i] = t;
        i = m;
      }
    }
    return top;
  };

  const h = (x: number, y: number): number => {
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };

  gScore[startIdx] = 0;
  push({ idx: startIdx, g: 0, f: h(sx, sy) });

  let expanded = 0;
  while (heap.length > 0 && expanded < maxExpand) {
    const cur = pop()!;
    if (cur.idx === goalIdx) break;
    if (closed[cur.idx]) continue;
    closed[cur.idx] = 1;
    expanded++;

    const cx = cur.idx % w;
    const cy = (cur.idx / w) | 0;

    for (const [ox, oy, cost] of NEIGHBORS) {
      const nx = cx + ox;
      const ny = cy + oy;
      if (!map.inBounds(nx, ny)) continue;
      if (!map.isWalkable(nx, ny)) continue;
      // No corner cutting.
      if (ox !== 0 && oy !== 0) {
        if (!map.isWalkable(cx + ox, cy) || !map.isWalkable(cx, cy + oy)) continue;
      }
      const nIdx = ny * w + nx;
      if (closed[nIdx]) continue;
      const tentative = cur.g + cost;
      if (tentative < gScore[nIdx]) {
        gScore[nIdx] = tentative;
        cameFrom[nIdx] = cur.idx;
        push({ idx: nIdx, g: tentative, f: tentative + h(nx, ny) });
      }
    }
  }

  if (cameFrom[goalIdx] === -1 && goalIdx !== startIdx) return [];

  const path: Array<{ x: number; y: number }> = [];
  let cur = goalIdx;
  let guard = 0;
  while (cur !== startIdx && cur !== -1 && guard++ < 10000) {
    path.push({ x: (cur % w) + 0.5, y: ((cur / w) | 0) + 0.5 });
    cur = cameFrom[cur]!;
  }
  path.reverse();
  return path;
}

/** BFS flood fill returning set of reachable walkable tile indices from a point. */
export function reachableTiles(map: GameMap, sx: number, sy: number): Set<number> {
  const out = new Set<number>();
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (!map.inBounds(sx, sy) || !map.isWalkable(sx, sy)) return out;
  const queue: number[] = [sy * map.width + sx];
  out.add(queue[0]!);
  for (let qi = 0; qi < queue.length; qi++) {
    const idx = queue[qi]!;
    const x = idx % map.width;
    const y = (idx / map.width) | 0;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + ox;
      const ny = y + oy;
      if (!map.inBounds(nx, ny)) continue;
      const nIdx = ny * map.width + nx;
      if (out.has(nIdx) || !map.isWalkable(nx, ny)) continue;
      out.add(nIdx);
      queue.push(nIdx);
    }
  }
  return out;
}
