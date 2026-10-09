import { CB, CS, H, W, D, SEA_LEVEL as S, CHUNK_VOL, CI, inWorld } from './config';
import { AIR, GRASS, DIRT, STONE, SAND, LOG, LEAVES, BEDROCK, WATER } from './blocks';
import { hash2, hash3, vnoise, fbm, sstep } from './noise';

/* ===================== ARCHIPELAGO GENERATION ===================== */
// Pure: every block is a function of (seed, world x, y, z) only, so a chunk comes out the same
// whichever order chunks are generated in, on any thread. No shared PRNG state, no trig.

// Salts that decorrelate the noise fields made from one seed
const K_CONT = 0x2c1b3c6d, K_WARPX = 0x297a2d39, K_WARPZ = 0x7ed55d16, K_SEABED = 0x165667b1, K_SAND = 0x0f3a9c51;
const K_TREE = 0x68e31da4, K_TX = 0x1b56c4e9, K_TZ = 0x3c6ef372, K_TH = 0x5be0cd19, K_PRI = 0x6a09e667;
const K_FOREST = 0x510e527f, K_LEAF = 0x1f83d9ab, K_MTN = 0x9b05688c;
const K_LAKE = 0x2f9c7b41, K_LX = 0x4b1d8e27, K_LZ = 0x6c3a0f95, K_LR = 0x1e7d5a63, K_LD = 0x58b2c94d;

/** Continent value above which a column is land (about the 70th percentile of the raw noise). */
const ISLAND_T = 0.6;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** "Island-ness" of a column: > ISLAND_T is land. Low-frequency noise + a central island − edge falloff. */
function continent(seed: number, x: number, z: number): number {
  // a light domain warp so coastlines don't follow the noise grid
  const wx = x + (vnoise(seed ^ K_WARPX, x / 53, z / 53) - 0.5) * 40;
  const wz = z + (vnoise(seed ^ K_WARPZ, x / 53, z / 53) - 0.5) * 40;
  const f = 1 / 110, sc = seed ^ K_CONT;
  const n = vnoise(sc, wx * f, wz * f) * 0.6 + vnoise(sc, wx * f * 2.03 + 17.3, wz * f * 2.03 - 9.1) * 0.27 +
    vnoise(sc, wx * f * 4.1 - 5.7, wz * f * 4.1 + 23.9) * 0.13;
  // the central island always exists (the player spawns on it): a raised disc merged into the noise
  const dx = x + 0.5 - W / 2, dz = z + 0.5 - D / 2;
  const centre = 1 - sstep(clamp01((Math.sqrt(dx * dx + dz * dz) - 14) / 40));
  // open deep ocean toward the world edge
  const de = Math.min(x + 0.5, z + 0.5, W - x - 0.5, D - z - 0.5);
  const edge = sstep(clamp01((de - 20) / 60));
  return Math.max(n + centre * 0.3, centre * 0.74) * edge;
}

/** Height of column (x, z) before lakes are dug: h ≥ SEA_LEVEL is dry land. */
function baseHeight(seed: number, x: number, z: number): number {
  const t = continent(seed, x, z) - ISLAND_T;
  let h;
  if (t >= 0) {
    // land rises from the beach over a band into the original island's hills; some inland areas
    // (a separate low-frequency mask) grow mountains with bare stone peaks
    const m = sstep(Math.min(1, t / 0.12)), inland = sstep(clamp01((t - 0.06) / 0.2));
    const mtn = sstep(clamp01((vnoise(seed ^ K_MTN, x / 64, z / 64) - 0.5) / 0.25)) * inland;
    h = S + Math.floor(m * (2 + fbm(seed, x * 0.07, z * 0.07) * (14 + 12 * mtn)));
  } else {
    // shelf from the shore down to the deep ocean floor
    const d = sstep(Math.min(1, -t / 0.18));
    h = S - 1 - Math.floor(d * 12 + vnoise(seed ^ K_SEABED, x * 0.09, z * 0.09) * 2.5);
  }
  return Math.min(H - 12, h);
}

/* ============================ LAKES ============================ */
// At most one lake per LC×LC cell, well inside it: a bowl dug into inland ground and filled up to
// the lowest point of the ground around it (where it would spill over). Where a gap in that rim
// between the points looked at would let the water out, a bank is raised, so a lake always holds
// its water.
const LCB = 5, LC = 1 << LCB;
/** 16 directions round a circle (cos, sin), written out: generation uses no trig */
const RIM = [[1, 0], [0.924, 0.383], [0.707, 0.707], [0.383, 0.924], [0, 1], [-0.383, 0.924], [-0.707, 0.707], [-0.924, 0.383],
  [-1, 0], [-0.924, -0.383], [-0.707, -0.707], [-0.383, -0.924], [0, -1], [0.383, -0.924], [0.707, -0.707], [0.924, -0.383]];
interface Lake { x: number; z: number; r: number; depth: number; level: number }

function makeLake(seed: number, gx: number, gz: number): Lake | null {
  if (hash2(seed ^ K_LAKE, gx, gz) >= 0.85) return null;
  const r = 4 + Math.floor(hash2(seed ^ K_LR, gx, gz) * 6), m = r + 4;
  const x = gx * LC + m + Math.floor(hash2(seed ^ K_LX, gx, gz) * (LC - 2 * m));
  const z = gz * LC + m + Math.floor(hash2(seed ^ K_LZ, gx, gz) * (LC - 2 * m));
  if (!inWorld(x, z) || continent(seed, x, z) - ISLAND_T < 0.05) return null;      // inland only
  let level = H;
  for (const [dx, dz] of RIM) level = Math.min(level, baseHeight(seed, x + Math.round(dx * (r + 1)), z + Math.round(dz * (r + 1))));
  const depth = 3 + Math.floor(hash2(seed ^ K_LD, gx, gz) * 3);
  // above the sea, below the peaks, and the bowl has to reach below the rim
  if (level < S + 2 || level > S + 11 || baseHeight(seed, x, z) - depth >= level) return null;
  return { x, z, r, depth, level };
}

let lakeSeed = NaN;
const lakeMemo = new Map<number, Lake | null>();
/** The lake in cell (gx, gz), if any (remembered: it is a pure function of the seed and the cell) */
function lakeIn(seed: number, gx: number, gz: number): Lake | null {
  if (seed !== lakeSeed) { lakeMemo.clear(); lakeSeed = seed; }
  const k = (gx + 64) * 512 + gz + 64;
  let l = lakeMemo.get(k);
  if (l === undefined) lakeMemo.set(k, (l = makeLake(seed, gx, gz)));
  return l;
}

/** Column height: blocks y < h are filled, so the surface is at y = h. h ≥ SEA_LEVEL is dry land (or a lake). */
export function columnHeight(seed: number, x: number, z: number): number {
  const h = baseHeight(seed, x, z), lk = lakeIn(seed, x >> LCB, z >> LCB);
  if (!lk) return h;
  const dx = x - lk.x, dz = z - lk.z, d2 = dx * dx + dz * dz, r2 = lk.r * lk.r;
  if (d2 < r2) return h - Math.round(lk.depth * (1 - d2 / r2));           // the lake's bowl
  return d2 < (lk.r + 2) * (lk.r + 2) ? Math.max(h, lk.level) : h;       // its bank holds the water in
}

/** Water in column (x, z) fills the air up to y < waterLevel: the sea, or a lake's surface. */
export function waterLevel(seed: number, x: number, z: number): number {
  const lk = lakeIn(seed, x >> LCB, z >> LCB);
  if (lk) {
    const dx = x - lk.x, dz = z - lk.z;
    if (dx * dx + dz * dz < lk.r * lk.r) return Math.max(S, lk.level);
  }
  return S;
}

/** Block at height y in a column of height h with water up to `lv` (same layering as the original island). */
function layer(seed: number, x: number, z: number, y: number, h: number, lv: number): number {
  if (y === 0) return BEDROCK;
  if (h >= S) {
    if (h < lv) return y >= h - 2 ? SAND : y >= h - 4 ? DIRT : STONE;   // a lake's bed
    if (h <= S + 1) return y >= h - 3 ? SAND : STONE;          // beach
    if (y === h - 1) return h >= S + 12 ? STONE : GRASS;       // grass, or bare stone on high peaks
    return y >= h - 4 ? DIRT : STONE;
  }
  // seabed: sand in the shallows and in patches further out, stone elsewhere
  const sandy = h >= S - 6 || vnoise(seed ^ K_SAND, x * 0.08, z * 0.08) > 0.55;
  return sandy && y >= h - 3 ? SAND : STONE;
}

/* ============================ TREES ============================ */
// One candidate per TC×TC cell, anywhere in the cell. A candidate grows if the ground suits it
// and no higher-priority candidate in a neighbouring cell is within 4 blocks, so trees keep the
// original spacing (5+ apart on some axis) and their canopies (radius 2) never overlap.
const TC = 6;

export interface Tree { x: number; z: number; h: number; th: number; pri: number }

function candidate(seed: number, gx: number, gz: number): Tree | null {
  const x = gx * TC + Math.floor(hash2(seed ^ K_TX, gx, gz) * TC);
  const z = gz * TC + Math.floor(hash2(seed ^ K_TZ, gx, gz) * TC);
  if (!inWorld(x, z)) return null;
  // density varies: groves and open meadows
  if (hash2(seed ^ K_TREE, gx, gz) >= 0.1 + 0.55 * vnoise(seed ^ K_FOREST, x / 40, z / 40)) return null;
  const h = columnHeight(seed, x, z);
  if (h < S + 2 || h > S + 10 || h < waterLevel(seed, x, z)) return null;   // on grass, not too high up, not in a lake
  return { x, z, h, th: 4 + Math.floor(hash2(seed ^ K_TH, gx, gz) * 2), pri: hash2(seed ^ K_PRI, gx, gz) };
}

/** The tree that grows in cell (gx, gz), if any. `cand` may memoize candidate(). */
function treeIn(seed: number, gx: number, gz: number, cand = candidate): Tree | null {
  const t = cand(seed, gx, gz);
  if (!t) return null;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dz) continue;
    const o = cand(seed, gx + dx, gz + dz);
    if (o && Math.abs(o.x - t.x) <= 4 && Math.abs(o.z - t.z) <= 4 &&
        (o.pri > t.pri || (o.pri === t.pri && (dz > 0 || (dz === 0 && dx > 0))))) return null;
  }
  return t;
}

/** Trees whose trunk or canopy touches the block rectangle [x0, x1] × [z0, z1]. */
export function treesNear(seed: number, x0: number, z0: number, x1: number, z1: number): Tree[] {
  const memo = new Map<number, Tree | null>();
  const cand = (s: number, gx: number, gz: number) => {
    const k = (gx + 64) * 4096 + gz + 64;
    let t = memo.get(k);
    if (t === undefined) memo.set(k, (t = candidate(s, gx, gz)));
    return t;
  };
  const out: Tree[] = [];
  for (let gz = Math.floor((z0 - 2) / TC); gz <= Math.floor((z1 + 2) / TC); gz++)
    for (let gx = Math.floor((x0 - 2) / TC); gx <= Math.floor((x1 + 2) / TC); gx++) {
      const t = treeIn(seed, gx, gz, cand);
      if (t && t.x + 2 >= x0 && t.x - 2 <= x1 && t.z + 2 >= z0 && t.z - 2 <= z1) out.push(t);
    }
  return out;
}

/** Stamp the part of tree t that falls inside the chunk at (x0, z0). Same shape as the original oaks. */
function stampTree(seed: number, data: Uint8Array, x0: number, z0: number, t: Tree): void {
  const { x, z, h, th } = t, inside = (lx: number, lz: number) => lx >= 0 && lx < CS && lz >= 0 && lz < CS;
  if (inside(x - x0, z - z0)) {
    data[CI(x - x0, h - 1, z - z0)] = DIRT;                    // no grass under the trunk
    for (let y = h; y < h + th; y++) data[CI(x - x0, y, z - z0)] = LOG;
  }
  for (let dy = th - 2; dy <= th + 1; dy++) {
    const r = dy <= th - 1 ? 2 : 1;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const X = x + dx, Y = h + dy, Z = z + dz;
      if (!inside(X - x0, Z - z0) || Y >= H) continue;
      const corner = Math.abs(dx) === r && Math.abs(dz) === r;
      if (corner && (r === 2 ? hash3(seed ^ K_LEAF, X, Y, Z) < 0.5 : dy === th + 1)) continue;
      const i = CI(X - x0, Y, Z - z0);
      if (data[i] === AIR) data[i] = LEAVES;
    }
  }
}

/** Generate chunk (cx, cz) of the world with this seed. */
export function generateChunk(seed: number, cx: number, cz: number): Uint8Array {
  const data = new Uint8Array(CHUNK_VOL), x0 = cx * CS, z0 = cz * CS;
  for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
    const x = x0 + lx, z = z0 + lz, h = columnHeight(seed, x, z), lv = waterLevel(seed, x, z);
    for (let y = 0; y < h; y++) data[CI(lx, y, lz)] = layer(seed, x, z, y, h, lv);
    for (let y = h; y < lv; y++) data[CI(lx, y, lz)] = WATER;   // still water: sources (state 0)
  }
  // trees from this chunk and its neighbours whose canopies reach in
  for (const t of treesNear(seed, x0, z0, x0 + CS - 1, z0 + CS - 1)) stampTree(seed, data, x0, z0, t);
  return data;
}

/* ============================ SPAWN ============================ */
/**
 * The spawn column: the beach or grass column nearest the world centre (on the central island)
 * with no tree over it. The player stands at y = columnHeight(seed, x, z).
 */
export function findSpawn(seed: number): [number, number] {
  const ok = (x: number, z: number) => {
    const h = columnHeight(seed, x, z);
    if (h < S || h >= S + 12 || h < waterLevel(seed, x, z)) return false;   // water, or a bare stone peak
    return treesNear(seed, x, z, x, z).length === 0;            // no trunk or leaves above
  };
  const cx = W / 2, cz = D / 2;
  for (let r = 0; r < W / 2; r++) {                              // square rings outward from the centre
    for (let i = -r; i <= r; i++) {
      for (const [x, z] of [[cx + i, cz - r], [cx + i, cz + r], [cx - r, cz + i], [cx + r, cz + i]]) {
        if (inWorld(x, z) && ok(x, z)) return [x, z];
      }
    }
  }
  return [cx, cz];
}

/* ============================ OLD SAVES ============================ */
/**
 * Saves from before the sea was made of water blocks hold air where the sea is. This fills the air
 * below sea level in chunk (cx, cz) that is open to the sea — reachable from the sea's top layer or
 * from the chunk's sides, in columns the generator makes sea — with still water. Air shut off from
 * it (a room built on the seabed) stays dry. Returns how many blocks became water.
 */
export function floodSea(data: Uint8Array, seed: number, cx: number, cz: number): number {
  const x0 = cx * CS, z0 = cz * CS, q: number[] = [], L = CS * CS;
  let n = 0;
  const fill = (i: number) => { if (data[i] === AIR) { data[i] = WATER; q.push(i); n++; } };
  for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
    if (baseHeight(seed, x0 + lx, z0 + lz) >= S) continue;               // land
    fill(CI(lx, S - 1, lz));
    if (lx === 0 || lz === 0 || lx === CS - 1 || lz === CS - 1) for (let y = 0; y < S - 1; y++) fill(CI(lx, y, lz));
  }
  while (q.length) {
    const i = q.pop()!, lx = i & (CS - 1), lz = (i >> CB) & (CS - 1), y = i >> (2 * CB);
    if (lx > 0) fill(i - 1);
    if (lx < CS - 1) fill(i + 1);
    if (lz > 0) fill(i - CS);
    if (lz < CS - 1) fill(i + CS);
    if (y > 0) fill(i - L);
    if (y < S - 1) fill(i + L);
  }
  return n;
}
