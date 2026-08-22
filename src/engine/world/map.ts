/** Tile-based world representation shared by simulation, rendering, and tools. */

export const enum Tile {
  Wall = 0,
  Floor = 1,
  Door = 2,
  Rubble = 3, // decorative variant of wall face
}

export interface Room {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class GameMap {
  readonly width: number;
  readonly height: number;
  tiles: Uint8Array;
  /** Rooms discovered during generation (may be empty for hand-authored maps). */
  rooms: Room[] = [];

  constructor(width: number, height: number, fill: Tile = Tile.Wall) {
    this.width = width;
    this.height = height;
    this.tiles = new Uint8Array(width * height).fill(fill);
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  tileAt(x: number, y: number): Tile {
    if (!this.inBounds(x, y)) return Tile.Wall;
    return this.tiles[y * this.width + x] as Tile;
  }

  setTile(x: number, y: number, t: Tile): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[y * this.width + x] = t;
  }

  isWalkableTile(t: Tile): boolean {
    return t === Tile.Floor || t === Tile.Door;
  }

  isWalkable(tx: number, ty: number): boolean {
    return this.isWalkableTile(this.tileAt(tx, ty));
  }

  isWalkableWorld(wx: number, wy: number): boolean {
    return this.isWalkable(Math.floor(wx), Math.floor(wy));
  }

  roomCenter(r: Room): { x: number; y: number } {
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  countTiles(match: (t: Tile) => boolean): number {
    let n = 0;
    for (let i = 0; i < this.tiles.length; i++) if (match(this.tiles[i] as Tile)) n++;
    return n;
  }
}
