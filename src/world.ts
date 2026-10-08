import { CB, CS, H, NCX, NCZ, W, D, SEA_LEVEL } from './config';
import { AIR, GRASS, DIRT, STONE, SAND, LOG, LEAVES, BEDROCK } from './blocks';
import { fbm, rand, sstep } from './noise';

/* ============================ CHUNKS ============================ */
/** Blocks in one chunk: CS × CS columns, full height. */
export const CHUNK_VOL = CS * CS * H;
/** Index of local block (lx, y, lz) in chunk data: x fastest, then z, then y. */
export const CI = (lx: number, y: number, lz: number) => lx + CS * (lz + CS * y);
/** Is column (x, z) inside the world? */
export const inWorld = (x: number, z: number) => x >= 0 && x < W && z >= 0 && z < D;

export interface Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly data: Uint8Array;
}

/* ============================ WORLD ============================ */
/**
 * All block access in world coordinates, routed to the loaded chunks.
 * Outside the world and in unloaded chunks getBlock() reads AIR, but isSolid() reads SOLID:
 * the world edge is an invisible wall and the player can never fall into ungenerated terrain.
 */
export class World {
  private readonly chunks: (Chunk | undefined)[] = new Array(NCX * NCZ).fill(undefined);
  /** Told about every block change made through setBlock (the mesher marks chunks dirty). */
  onChange: ((x: number, y: number, z: number) => void) | null = null;

  chunk(cx: number, cz: number): Chunk | undefined {
    return cx >= 0 && cx < NCX && cz >= 0 && cz < NCZ ? this.chunks[cx + cz * NCX] : undefined;
  }
  /** Install chunk data (it is used directly, not copied). */
  setChunk(cx: number, cz: number, data: Uint8Array): Chunk {
    const c: Chunk = { cx, cz, data };
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

/* ======================= ISLAND (stand-in generator) ======================= */
// The original 32×32 island, generated exactly as before and placed in the four chunks at the
// centre of the world, lifted so its beaches sit at SEA_LEVEL. Everything else stays unloaded,
// so the island keeps its invisible walls.
const IW = 32, ID = 32, IH = 40;
export const ISLAND_X = W / 2 - IW / 2, ISLAND_Z = D / 2 - ID / 2, ISLAND_LIFT = SEA_LEVEL - 7;

/** Fill the island chunks. Consumes `rand`, so call it before anything else that does. */
export function generateWorld(): void {
  const vox = new Uint8Array(IW * IH * ID);
  const I = (x: number, y: number, z: number) => x + IW * (z + ID * y);
  const inXZ = (x: number, z: number) => x >= 0 && x < IW && z >= 0 && z < ID;
  const topY = (x: number, z: number) => { for (let y = IH - 1; y >= 0; y--) if (vox[I(x, y, z)] !== AIR) return y; return -1; };

  // island heightmap: fbm noise with a radial falloff so the edges become beach
  for (let z = 0; z < ID; z++) for (let x = 0; x < IW; x++) {
    const nx = (x + 0.5) / IW - 0.5, nz = (z + 0.5) / ID - 0.5;
    const d = Math.sqrt(nx * nx + nz * nz) * 2;
    const mask = 1 - sstep(Math.min(1, Math.max(0, (d - 0.5) / 0.46)));
    const h = Math.min(IH - 12, 7 + Math.floor(mask * (2 + fbm(x * 0.07, z * 0.07) * 14)));
    for (let y = 0; y < h; y++) {
      let b;
      if (y === 0) b = BEDROCK;
      else if (h <= 8) b = y >= h - 3 ? SAND : STONE;
      else if (y === h - 1) b = h >= 19 ? STONE : GRASS;
      else if (y >= h - 4) b = DIRT;
      else b = STONE;
      vox[I(x, y, z)] = b;
    }
  }
  // a few oak-style trees (kept away from spawn)
  const trees: [number, number][] = [];
  for (let tries = 0; tries < 300 && trees.length < 7; tries++) {
    const x = 3 + Math.floor(rand() * (IW - 6)), z = 3 + Math.floor(rand() * (ID - 6));
    const g = topY(x, z), h = g + 1;
    if (vox[I(x, g, z)] !== GRASS || h > 17) continue;
    if (Math.hypot(x - IW / 2, z - ID / 2) < 4.5) continue;
    if (trees.some((t) => Math.abs(t[0] - x) < 5 && Math.abs(t[1] - z) < 5)) continue;
    trees.push([x, z]);
    const th = 4 + Math.floor(rand() * 2);
    vox[I(x, g, z)] = DIRT;
    for (let y = h; y < h + th; y++) vox[I(x, y, z)] = LOG;
    for (let dy = th - 2; dy <= th + 1; dy++) {
      const r = dy <= th - 1 ? 2 : 1;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (r === 2 ? rand() < 0.5 : dy === th + 1)) continue;
        const X = x + dx, Y = h + dy, Z = z + dz;
        if (inXZ(X, Z) && Y < IH && vox[I(X, Y, Z)] === AIR) vox[I(X, Y, Z)] = LEAVES;
      }
    }
  }

  // copy into chunks: bedrock moves down to y=0 and the lift underneath is stone
  for (let cz = ISLAND_Z >> CB; cz < (ISLAND_Z + ID) >> CB; cz++) for (let cx = ISLAND_X >> CB; cx < (ISLAND_X + IW) >> CB; cx++) {
    const data = new Uint8Array(CHUNK_VOL);
    for (let y = 0; y < H; y++) for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const x = cx * CS + lx - ISLAND_X, z = cz * CS + lz - ISLAND_Z, iy = y - ISLAND_LIFT;
      let b = iy > 0 && iy < IH ? vox[I(x, iy, z)] : AIR;
      if (y === 0) b = BEDROCK;
      else if (iy <= 0) b = STONE;
      data[CI(lx, y, lz)] = b;
    }
    world.setChunk(cx, cz, data);
  }
}

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
