import { CB, CS, H, NCX, NCZ, CHUNK_VOL, CI, inWorld } from './config';
import { AIR, WATER, SOLID, TARGETABLE, MODEL, liquidHeight } from './blocks';
import { torchBox } from './torch';

/* ============================ CHUNKS ============================ */
export interface Chunk {
  readonly cx: number;
  readonly cz: number;
  /** Block ids (CI layout) */
  readonly data: Uint8Array;
  /**
   * Per-block state, 1 byte per block in the same layout (torch facing, water level, …). null while
   * every block's state is 0, which is true of all generated terrain; allocated on first use.
   */
  state: Uint8Array | null;
  /** Differs from what the seed generates (edited by the player, now or in an earlier session) */
  edited: boolean;
  /**
   * Light, 1 byte per block in the same layout: skylight << 4 | block light (see light.ts). null
   * until the chunk is lit (that needs its 8 neighbours loaded), and while it is being lit again.
   */
  light: Uint8Array | null;
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
  /** Told about every block change made through setBlock, with the block that was there before. */
  onChange: ((x: number, y: number, z: number, old: number) => void) | null = null;

  chunk(cx: number, cz: number): Chunk | undefined {
    return cx >= 0 && cx < NCX && cz >= 0 && cz < NCZ ? this.chunks[cx + cz * NCX] : undefined;
  }
  /** Install chunk data and state (used directly, not copied). */
  setChunk(cx: number, cz: number, data: Uint8Array, state: Uint8Array | null = null, edited = false): Chunk {
    const c: Chunk = { cx, cz, data, state, edited, light: null };
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
  /** A block's state byte (0 outside the world, in unloaded chunks and wherever none was set). */
  getState(x: number, y: number, z: number): number {
    if (y < 0 || y >= H || !inWorld(x, z)) return 0;
    const c = this.chunks[(x >> CB) + (z >> CB) * NCX];
    return c && c.state ? c.state[CI(x & (CS - 1), y, z & (CS - 1))] : 0;
  }
  /** Packed light at a block (skylight << 4 | block light); 0 where nothing is lit. */
  getLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= H || !inWorld(x, z)) return y >= H ? 0xf0 : 0;
    const c = this.chunks[(x >> CB) + (z >> CB) * NCX];
    return c && c.light ? c.light[CI(x & (CS - 1), y, z & (CS - 1))] : 0;
  }
  /**
   * Change one block and its state. Returns false (and changes nothing) outside the world or in an
   * unloaded chunk.
   */
  setBlock(x: number, y: number, z: number, id: number, state = 0): boolean {
    if (y < 0 || y >= H || !inWorld(x, z)) return false;
    const c = this.chunks[(x >> CB) + (z >> CB) * NCX];
    if (!c) return false;
    const i = CI(x & (CS - 1), y, z & (CS - 1)), old = c.data[i];
    c.data[i] = id;
    if (state && !c.state) c.state = new Uint8Array(CHUNK_VOL);
    if (c.state) c.state[i] = state;
    c.edited = true;
    if (this.onChange) this.onChange(x, y, z, old);
    return true;
  }
  /** Collision: world edges are invisible walls, y<0 is solid floor, unloaded chunks are solid. */
  isSolid(x: number, y: number, z: number): boolean {
    if (y < 0 || !inWorld(x, z)) return true;
    if (y >= H) return false;
    const c = this.chunks[(x >> CB) + (z >> CB) * NCX];
    return c ? SOLID[c.data[CI(x & (CS - 1), y, z & (CS - 1))]] === 1 : true;
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

/** Is point (x, y, z) in water: inside a water block, below its surface? */
export function inWater(x: number, y: number, z: number): boolean {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  if (world.getBlock(bx, by, bz) !== WATER) return false;
  return y - by < liquidHeight(world.getState(bx, by, bz), world.getBlock(bx, by + 1, bz) === WATER);
}

/* ===================== RAYCAST (voxel DDA) ===================== */
export interface Hit { x: number; y: number; z: number; nx: number; ny: number; nz: number }
const hit: Hit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };

/**
 * Where a ray (origin relative to a cell, direction d) enters box b = [x0, y0, z0, x1, y1, z1]:
 * distance along the ray and the face normal, or null if it misses (or only beyond `max`).
 */
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: number[], max: number) {
  let t0 = -Infinity, t1 = Infinity, axis = 0;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < b[a] || o[a] > b[a + 3]) return null; continue; }
    let n = (b[a] - o[a]) / d[a], f = (b[a + 3] - o[a]) / d[a];
    if (n > f) { const tmp = n; n = f; f = tmp; }
    if (n > t0) { t0 = n; axis = a; }
    t1 = Math.min(t1, f);
  }
  if (t0 > t1 || t1 < 0 || t0 > max) return null;
  const nrm = [0, 0, 0];
  nrm[axis] = d[axis] > 0 ? -1 : 1;
  return nrm;
}

/**
 * First block that can be aimed at (not air, not liquid) along the ray, plus the face normal it was
 * entered through. Torches only count where the ray meets their (small) hit box. Works across chunk
 * borders; unloaded chunks read as air. The result object is reused.
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
    const id = world.getBlock(x, y, z);
    if (TARGETABLE[id]) {
      if (MODEL[id] !== 1) {
        hit.x = x; hit.y = y; hit.z = z; hit.nx = nx; hit.ny = ny; hit.nz = nz;
        return hit;
      }
      const n = rayBox(ox - x, oy - y, oz - z, dx, dy, dz, torchBox(world.getState(x, y, z)), max);
      if (n) {
        hit.x = x; hit.y = y; hit.z = z; hit.nx = n[0]; hit.ny = n[1]; hit.nz = n[2];
        return hit;
      }
    }
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += ddx; nx = -sx; ny = 0; nz = 0; }
    else if (ty < tz) { y += sy; t = ty; ty += ddy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tz; tz += ddz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}
