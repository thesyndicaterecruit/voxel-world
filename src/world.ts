import { CB, CS, H, NCX, NCZ, CHUNK_VOL, CI, inWorld } from './config';
import { AIR } from './blocks';

/* ============================ CHUNKS ============================ */
export interface Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly data: Uint8Array;
  /** Differs from what the seed generates (edited by the player, now or in an earlier session) */
  edited: boolean;
}

/* ============================ WORLD ============================ */
/**
 * All block access in world coordinates, routed to the loaded chunks.
 * Outside the world and in unloaded chunks getBlock() reads AIR, but isSolid() reads SOLID:
 * the world edge is an invisible wall and the player can never fall into ungenerated terrain.
 */
export class World {
  private readonly chunks: (Chunk | undefined)[] = new Array(NCX * NCZ).fill(undefined);
  /** World seed: terrain generation and per-block texture variation derive from it. */
  seed = 0;
  /** Told about every block change made through setBlock (the mesher marks chunks dirty). */
  onChange: ((x: number, y: number, z: number) => void) | null = null;

  chunk(cx: number, cz: number): Chunk | undefined {
    return cx >= 0 && cx < NCX && cz >= 0 && cz < NCZ ? this.chunks[cx + cz * NCX] : undefined;
  }
  /** Install chunk data (it is used directly, not copied). */
  setChunk(cx: number, cz: number, data: Uint8Array, edited = false): Chunk {
    const c: Chunk = { cx, cz, data, edited };
    this.chunks[cx + cz * NCX] = c;
    return c;
  }
  removeChunk(cx: number, cz: number): void { this.chunks[cx + cz * NCX] = undefined; }
  forEachChunk(f: (c: Chunk) => void): void { for (const c of this.chunks) if (c) f(c); }

  /** Is the chunk holding column (x, z) loaded? (false outside the world) */
  isLoaded(x: number, z: number): boolean {
    return inWorld(x, z) && this.chunks[(x >> CB) + (z >> CB) * NCX] !== undefined;
  }
  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= H || !inWorld(x, z)) return AIR;
    const c = this.chunks[(x >> CB) + (z >> CB) * NCX];
    return c ? c.data[CI(x & (CS - 1), y, z & (CS - 1))] : AIR;
  }
  /** Change one block. Returns false (and changes nothing) outside the world or in an unloaded chunk. */
  setBlock(x: number, y: number, z: number, id: number): boolean {
    if (y < 0 || y >= H || !inWorld(x, z)) return false;
    const c = this.chunks[(x >> CB) + (z >> CB) * NCX];
    if (!c) return false;
    c.data[CI(x & (CS - 1), y, z & (CS - 1))] = id;
    c.edited = true;
    if (this.onChange) this.onChange(x, y, z);
    return true;
  }
  /** Collision: world edges are invisible walls, y<0 is solid floor, unloaded chunks are solid. */
  isSolid(x: number, y: number, z: number): boolean {
    if (y < 0 || !inWorld(x, z)) return true;
    if (y >= H) return false;
    const c = this.chunks[(x >> CB) + (z >> CB) * NCX];
    return c ? c.data[CI(x & (CS - 1), y, z & (CS - 1))] !== AIR : true;
  }
  /** Highest non-air block in column (x, z), or -1 (empty or unloaded). */
  topY(x: number, z: number): number {
    for (let y = H - 1; y >= 0; y--) if (this.getBlock(x, y, z) !== AIR) return y;
    return -1;
  }
  /** Non-air blocks in all loaded chunks. */
  count(): number {
    let n = 0;
    this.forEachChunk((c) => { for (let i = 0; i < CHUNK_VOL; i++) if (c.data[i] !== AIR) n++; });
    return n;
  }
}

export const world = new World();

/* ===================== RAYCAST (voxel DDA) ===================== */
export interface Hit { x: number; y: number; z: number; nx: number; ny: number; nz: number }
const hit: Hit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };

/**
 * First non-air block along the ray, plus the face normal it was entered through. Works across
 * chunk borders; unloaded chunks read as air. The result object is reused.
 */
export function raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): Hit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const ddx = dx ? Math.abs(1 / dx) : Infinity, ddy = dy ? Math.abs(1 / dy) : Infinity, ddz = dz ? Math.abs(1 / dz) : Infinity;
  let tx = dx ? (dx > 0 ? x + 1 - ox : ox - x) * ddx : Infinity;
  let ty = dy ? (dy > 0 ? y + 1 - oy : oy - y) * ddy : Infinity;
  let tz = dz ? (dz > 0 ? z + 1 - oz : oz - z) * ddz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  while (t <= max) {
    if (world.getBlock(x, y, z) !== AIR) {
      hit.x = x; hit.y = y; hit.z = z; hit.nx = nx; hit.ny = ny; hit.nz = nz;
      return hit;
    }
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += ddx; nx = -sx; ny = 0; nz = 0; }
    else if (ty < tz) { y += sy; t = ty; ty += ddy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tz; tz += ddz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}
