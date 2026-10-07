import { W, D, H } from './config';
import { AIR, GRASS, DIRT, STONE, SAND, LOG, LEAVES, BEDROCK } from './blocks';
import { fbm, rand, sstep } from './noise';

/** Block ids, indexed by I(x, y, z) (x fastest, then z, then y). */
export const vox = new Uint8Array(W * H * D);
export const I = (x: number, y: number, z: number) => x + W * (z + D * y);
export const inXZ = (x: number, z: number) => x >= 0 && x < W && z >= 0 && z < D;
export const get = (x: number, y: number, z: number) => (inXZ(x, z) && y >= 0 && y < H ? vox[I(x, y, z)] : AIR);
// collision: world edges are invisible walls, y<0 is solid floor
export const solid = (x: number, y: number, z: number) =>
  (!inXZ(x, z) || y < 0 ? true : y >= H ? false : vox[I(x, y, z)] !== AIR);
export function topY(x: number, z: number): number {
  for (let y = H - 1; y >= 0; y--) if (vox[I(x, y, z)] !== AIR) return y;
  return -1;
}

let onChange: ((x: number, y: number, z: number) => void) | null = null;
/** Register the (single) listener told about every setBlock — the mesher uses it to mark chunks dirty. */
export function onBlockChange(fn: (x: number, y: number, z: number) => void): void { onChange = fn; }

export function setBlock(x: number, y: number, z: number, id: number): void {
  vox[I(x, y, z)] = id;
  if (onChange) onChange(x, y, z);
}

/** Fill `vox` with the island and its trees. Consumes `rand`, so call it before anything else that does. */
export function generateWorld(): void {
  // island heightmap: fbm noise with a radial falloff so the edges become beach
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const nx = (x + 0.5) / W - 0.5, nz = (z + 0.5) / D - 0.5;
    const d = Math.sqrt(nx * nx + nz * nz) * 2;
    const mask = 1 - sstep(Math.min(1, Math.max(0, (d - 0.5) / 0.46)));
    const h = Math.min(H - 12, 7 + Math.floor(mask * (2 + fbm(x * 0.07, z * 0.07) * 14)));
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
    const x = 3 + Math.floor(rand() * (W - 6)), z = 3 + Math.floor(rand() * (D - 6));
    const g = topY(x, z), h = g + 1;
    if (vox[I(x, g, z)] !== GRASS || h > 17) continue;
    if (Math.hypot(x - W / 2, z - D / 2) < 4.5) continue;
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
        if (inXZ(X, Z) && Y < H && vox[I(X, Y, Z)] === AIR) vox[I(X, Y, Z)] = LEAVES;
      }
    }
  }
}

/* ===================== RAYCAST (voxel DDA) ===================== */
export interface Hit { x: number; y: number; z: number; nx: number; ny: number; nz: number }
const hit: Hit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };

/** First solid block along the ray, plus the face normal it was entered through. The result object is reused. */
export function raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): Hit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const ddx = dx ? Math.abs(1 / dx) : Infinity, ddy = dy ? Math.abs(1 / dy) : Infinity, ddz = dz ? Math.abs(1 / dz) : Infinity;
  let tx = dx ? (dx > 0 ? x + 1 - ox : ox - x) * ddx : Infinity;
  let ty = dy ? (dy > 0 ? y + 1 - oy : oy - y) * ddy : Infinity;
  let tz = dz ? (dz > 0 ? z + 1 - oz : oz - z) * ddz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  while (t <= max) {
    if (get(x, y, z) !== AIR) {
      hit.x = x; hit.y = y; hit.z = z; hit.nx = nx; hit.ny = ny; hit.nz = nz;
      return hit;
    }
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += ddx; nx = -sx; ny = 0; nz = 0; }
    else if (ty < tz) { y += sy; t = ty; ty += ddy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tz; tz += ddz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}
