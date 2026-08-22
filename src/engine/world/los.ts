/**
 * Grid line-of-sight using the Amanatides–Woo DDA traversal.
 * Returns true when a and b can see each other (no wall between).
 */
import type { GameMap } from "./map";

export function hasLineOfSight(map: GameMap, ax: number, ay: number, bx: number, by: number): boolean {
  let x = Math.floor(ax);
  let y = Math.floor(ay);
  const endX = Math.floor(bx);
  const endY = Math.floor(by);

  const dx = bx - ax;
  const dy = by - ay;

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

  // Guard against zero components.
  const invDx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const invDy = dy !== 0 ? Math.abs(1 / dy) : Infinity;

  // Distance from origin to first grid boundary along each axis.
  let tMaxX = stepX > 0 ? (x + 1 - ax) * invDx : stepX < 0 ? (ax - x) * invDx : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - ay) * invDy : stepY < 0 ? (ay - y) * invDy : Infinity;

  // Cap iterations to avoid pathological loops on degenerate input.
  const maxSteps = map.width + map.height + 8;
  for (let i = 0; i <= maxSteps; i++) {
    if (x === endX && y === endY) return true;
    if (tMaxX < tMaxY) {
      x += stepX;
      tMaxX += invDx;
    } else {
      y += stepY;
      tMaxY += invDy;
    }
    if (x === endX && y === endY) return true;
    if (!map.isWalkable(x, y)) return false;
  }
  return false;
}
