import { CS, CHUNK_VOL, CI, H, W, D, inWorld } from './config';
import { AIR, GRASS, DIRT, STONE, LOG, LEAVES, BEDROCK, WATER, ICE, SNOW, OBSIDIAN, TERRACOTTA } from './blocks';
import { hash2, hash3, vnoise, vnoise3, fbm, sstep } from './noise';
import { BIOMES, NBIOMES, VOLCANIC, weights, coast, islands, biomeMap, type Biome, type Island } from './biomes';
import { network, carveCaves, placeOres, type Ground } from './caves';
import * as g1 from './gen1';

/* ============================ GENERATORS ============================ */
// A world remembers which generator made it (WorldRecord.generatorVersion), and its unexplored
// chunks always come from that one, so the ground never shifts under a saved world. Version 1 is the
// first archipelago (gen1.ts, frozen: every world made before versions existed uses it); new worlds
// get GENERATOR_VERSION. Every generator is pure: a chunk is a function of (seed, cx, cz) only.

/** The generator new worlds get */
export const GENERATOR_VERSION = 2;

export interface Generator {
  readonly version: number;
  /** Generation fills the air below y = seaLevel with water */
  readonly seaLevel: number;
  /** Where the clouds float (their lowest y) */
  readonly cloudY: number;
  /**
   * Work out what the seed's chunks share (generator 2: the biome map, the cave network), once per
   * seed and thread; generateChunk does it anyway, this is to time it on its own
   */
  prepare(seed: number): void;
  /** All the blocks of chunk (cx, cz) (CHUNK_VOL, CI layout) */
  generateChunk(seed: number, cx: number, cz: number): Uint8Array;
  /** The spawn column: the player stands on its highest block */
  findSpawn(seed: number): [number, number];
  /** Where the ground is in column (x, z) (y of the first block above it), roughly: the title fly-around keeps above it */
  surfaceHeight(seed: number, x: number, z: number): number;
}

/* ---------- generator 2: the biome archipelago ---------- */
// The islands and their biomes come from biomes.ts. Every biome shapes the ground its own way
// (landform); a column's height mixes the shapes of the biomes around it by their weights, so a
// border never makes a cliff of its own, and every shape meets the same coastline. Then the coast
// has its say (cliffs, sea stacks, arches), slopes and cliffs lean out into overhangs, the biome
// that counts most lays its blocks, and caves, caverns and ore go in underneath (caves.ts).

/** Generator 2's sea level */
export const SEA_LEVEL = 48;
const S = SEA_LEVEL;
const K_RELIEF = 0x7a3b9c41, K_BED = 0x2e6f81d3, K_DITHER = 0x5d1f2a77, K_TREE = 0x68e31da4, K_TX = 0x1b56c4e9, K_TZ = 0x3c6ef372;
const K_TH = 0x5be0cd19, K_PRI = 0x6a09e667, K_LEAF = 0x1f83d9ab, K_PATCH = 0x4c8f3b2d, K_ICE = 0x71d3a9e5, K_TRENCH = 0x2545f491;
const K_BARS = 0x4bb6c7e3, K_PEAK = 0x6c62272e, K_PWARP = 0x1d8e4e27, K_WIND = 0x7b3f9c12, K_DUNE = 0x3a5e8b71, K_RIPPLE = 0x5f1e3d29;
const K_MESA = 0x2c9a4e83, K_POOL = 0x6e3b5a17, K_STACK = 0x48d1c5b3, K_LEAN = 0x19f3a6d5, K_SNOW = 0x7e1c3b49, K_BAND = 0x53a9f1c7;
/** How far inland the ground takes to rise from the beach, and offshore the sea floor to sink (blocks) */
const RISE = 14, SHELF = 28;
/** A volcano's crater starts this far from the coast to its middle (0–1) */
const CRATER = 0.7;
/** The dunes' wind: one of these directions per world (unit vectors, no trig) */
const WIND = [[1, 0], [0.8, 0.6], [0.6, 0.8], [0, 1], [-0.6, 0.8], [-0.8, 0.6], [0.6, -0.8], [0.8, -0.6]];

/** 1 on a ridge line of noise, falling to 0 between them */
const ridge = (seed: number, x: number, z: number) => 1 - Math.abs(2 * vnoise(seed, x, z) - 1);

/**
 * Biome `bm`'s ground at column (x, z), t blocks from the coast (positive inland) of island `isl`:
 * from the beach, at sea level for every biome, it rises inland in the biome's shape; offshore its
 * floor sinks to around `depth` below the sea. Continuous in t, so blended biomes meet smoothly.
 */
function landform(seed: number, bm: Biome, x: number, z: number, t: number, isl: Island | null): number {
  if (t < 0) {                                                       // the sea floor
    const d = sstep(Math.min(1, -t / SHELF));
    let h = S - 1 - d * (bm.depth + 7 * (fbm(seed ^ K_BED, x / 40, z / 40) - 0.45));
    if (bm.seaShape === 'trench') {                                  // trenches: long, narrow and deep
      const r = ridge(seed ^ K_TRENCH, x / 70 + 0.6 * vnoise(seed ^ K_TRENCH, x / 31, z / 31), z / 70);
      h = Math.max(6, h - d * 24 * sstep(Math.max(0, (r - 0.84) / 0.16)));
    } else if (bm.seaShape === 'bars' && t > -22 && vnoise(seed ^ K_BARS, x / 90, z / 90) > 0.55) {   // sandbars, some just above the water
      const r = ridge(seed ^ K_BARS, x / 23, z / 23);
      if (r > 0.92) h = Math.max(h, S - 2.5 + ((r - 0.92) / 0.08) * 3.8);
    }
    return h;
  }
  const r = sstep(Math.min(1, t / RISE));
  switch (bm.shape) {
    case 'hills': {                                                  // steep hills, close together
      const n = sstep(fbm(seed ^ K_RELIEF, x * bm.freq, z * bm.freq));
      return S + r * (bm.lift + bm.amp * (sstep(n) - 0.3));
    }
    case 'peaks': {                                                  // jagged ridges, highest deep inland
      const wx = x + 16 * (vnoise(seed ^ K_PWARP, x / 29, z / 29) - 0.5), wz = z + 16 * (vnoise(seed ^ K_PWARP, x / 29 + 41, z / 29) - 0.5);
      const q = 0.55 * ridge(seed ^ K_PEAK, wx / 41, wz / 41) + 0.3 * ridge(seed ^ (K_PEAK + 1), wx / 19, wz / 19) +
        0.15 * ridge(seed ^ (K_PEAK + 2), wx / 9, wz / 9);
      return S + r * bm.lift + sstep(Math.min(1, t / 26)) * bm.amp * q * q;
    }
    case 'dunes': {                                                  // ridges across the wind: long windward slopes, steep lee sides
      const [ux, uz] = WIND[Math.floor(hash2(seed ^ K_WIND, 0, 0) * WIND.length)];
      const p = (x * ux + z * uz) / 19 + 1.3 * (vnoise(seed ^ K_DUNE, x / 37, z / 37) - 0.5), u = p - Math.floor(p);
      const prof = u < 0.72 ? sstep(u / 0.72) : sstep((1 - u) / 0.28);
      return S + r * (bm.lift + bm.amp * prof * (0.45 + 0.55 * vnoise(seed ^ K_DUNE, x / 53 + 7, z / 53)) +
        1.4 * (vnoise(seed ^ K_RIPPLE, x / 5, z / 5) - 0.5));
    }
    case 'mesa': {                                                   // flat-topped mesas, their sides in 4-block terraces
      const m = sstep(Math.max(0, Math.min(1, (fbm(seed ^ K_MESA, x * bm.freq, z * bm.freq) - 0.42) / 0.14)));
      const raw = r * (bm.lift + bm.amp * m * (0.8 + 0.2 * vnoise(seed ^ K_MESA, x / 31, z / 31)) + 1.5 * vnoise(seed ^ K_RELIEF, x / 13, z / 13));
      return S + (raw < 3 ? raw : 3 + Math.floor((raw - 3) / 4) * 4);
    }
    case 'marsh': {                                                  // flat, barely above the sea, with pools
      const pool = vnoise(seed ^ K_POOL, x / 9, z / 9);
      return S + r * (bm.lift + bm.amp * (fbm(seed ^ K_RELIEF, x * bm.freq, z * bm.freq) - 0.4) - (pool < 0.34 ? 1.6 + (0.34 - pool) * 9 : 0));
    }
    case 'volcano': {                                                // a cone round the island's middle, a crater on top
      if (!isl) return S + r * bm.amp;
      const u = Math.min(1.2, t / isl.r), q = Math.min(u, CRATER) / CRATER;
      return S + (bm.lift + isl.r * 0.5) * q * Math.sqrt(q) - 8 * sstep(Math.max(0, Math.min(1, (u - CRATER) / (1 - CRATER)))) +
        bm.amp * (vnoise(seed ^ K_RELIEF, x / 7, z / 7) - 0.5);
    }
    default:                                                         // rolling country
      return S + r * (bm.lift + bm.amp * (fbm(seed ^ K_RELIEF, x * bm.freq, z * bm.freq) - 0.35));
  }
}

/* ---------- the coast: cliffs, sea stacks, arches ---------- */
/** Sea stacks stand in cells of this many blocks off cliff coasts (one cell in six has one) */
const STACK = 11;
interface Stack { x: number; z: number; r: number; top: number; ux: number; uz: number; len: number }
let stackSeed = NaN;
const stackMemo = new Map<number, Stack | null>();
/** The stack of cell (gx, gz), if it has one: in the sea 4–18 blocks off a cliff coast; some reach back to it as an arch (len > 0) */
function stackIn(seed: number, gx: number, gz: number): Stack | null {
  if (seed !== stackSeed || stackMemo.size > 8192) { stackMemo.clear(); stackSeed = seed; }
  const key = (gx + 64) * 4096 + gz + 64;
  let s = stackMemo.get(key);
  if (s !== undefined) return s;
  s = null;
  const k = hash2(seed ^ K_STACK, gx, gz);
  if (k < 0.17) {
    const x = (gx + 0.2 + 0.6 * hash2(seed ^ K_STACK, gx + 3, gz)) * STACK, z = (gz + 0.2 + 0.6 * hash2(seed ^ K_STACK, gx, gz + 3)) * STACK;
    const c = coast(seed, x, z), isl = c.island;
    if (isl && isl.cliff && c.t < -4 && c.t > -18) {
      s = { x, z, r: 2 + 1.8 * hash2(seed ^ K_STACK, gx + 5, gz), top: S + 6 + Math.floor(9 * hash2(seed ^ K_STACK, gx, gz + 5)), ux: 0, uz: 0, len: 0 };
      if (k < 0.055) {                                               // an arch: from the stack back toward the island
        const dx = isl.x - x, dz = isl.z - z, l = Math.sqrt(dx * dx + dz * dz) || 1;
        s.ux = dx / l; s.uz = dz / l; s.len = -c.t + 3.5;
      }
    }
  }
  stackMemo.set(key, s);
  return s;
}

/** A column of generator 2 (column2 fills one in) */
export interface Col {
  /** The ground: blocks y < h are filled (before overhangs and caves) */
  h: number;
  /** The biome whose blocks are on top */
  biome: number;
  /** How far inland (blocks from the coast; negative out at sea) */
  t: number;
  /** How much of the sea's surface freezes here (0–1) */
  freeze: number;
  /** How far the ground leans out here (overhangs, blocks) */
  lean: number;
  /** An arch's rock: blocks lo ≤ y < hi are filled too (lo = hi: no arch) */
  lo: number;
  hi: number;
  /** In a volcano's crater */
  crater: boolean;
  /** A sea stack's or arch's rock: the biome (+ 1) of the island it stands off, whose cliffs it is made of (0: none) */
  rock: number;
}
export const newCol = (): Col => ({ h: 0, biome: 0, t: 0, freeze: 0, lean: 0, lo: 0, hi: 0, crater: false, rock: 0 });

const W8 = new Float32Array(NBIOMES);
/**
 * Column (x, z) of generator 2, into `out`: its ground (the biomes' landforms by weight, then the
 * coast's cliffs and stacks), the biome whose blocks are on top, and what else goes on there.
 */
export function column2(seed: number, x: number, z: number, out: Col = newCol()): Col {
  const { t, island } = coast(seed, x, z);
  let best = weights(seed, x, z, W8), second = -1, h = 0, freeze = 0, lean = 0, cliffy = 0;
  for (let i = 0; i < NBIOMES; i++) {
    const w = W8[i];
    if (w <= 0) continue;
    const bm = BIOMES[i];
    h += w * landform(seed, bm, x, z, t, island);
    freeze += w * bm.freeze;
    lean += w * bm.overhang;
    if (bm.cliffChance > 0) cliffy += w;                            // swamps, deserts and beaches have none
    if (i !== best && (second < 0 || w > W8[second])) second = i;
  }
  // near a border the two biomes' blocks mingle
  if (second >= 0 && hash2(seed ^ K_DITHER, x, z) < W8[second] * 0.9) best = second;
  out.lo = out.hi = out.rock = 0;
  if (island && island.cliff && cliffy > 0) {
    // sea cliffs (where the biomes have them): the ground rises by the cliff's height within 2.5
    // blocks of the coast, the water is deep at their foot, and the cliffs lean out here and there
    if (t >= 0) h += island.cliff * cliffy * sstep(Math.min(1, t / 2.5));
    else h -= 4 * cliffy * sstep(Math.min(1, -t / 6));
    lean += cliffy * Math.max(0, 3 - Math.abs(t - 3) * 0.4);
    // stacks standing off the coast, and arches from some of them back to the cliff
    if (t < -2 && t > -26) {
      const gx0 = Math.floor(x / STACK), gz0 = Math.floor(z / STACK);
      for (let gz = gz0 - 1; gz <= gz0 + 1; gz++) for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) {
        const s = stackIn(seed, gx, gz);
        if (!s) continue;
        const dx = x + 0.5 - s.x, dz = z + 0.5 - s.z, d2 = (dx * dx + dz * dz) / (s.r * s.r);
        if (d2 < 1) { h = Math.max(h, s.top - 2 * d2); out.rock = island.primary + 1; }
        const a = dx * s.ux + dz * s.uz, b = dz * s.ux - dx * s.uz;
        if (s.len && a > 0 && a < s.len && Math.abs(b) < 1.8) {
          const v = 2 * (a / s.len) - 1;                             // −1 at the stack, 1 at the cliff
          out.lo = S + 1 + Math.floor(4.5 * (1 - v * v));
          out.hi = S + 8;
          out.rock = island.primary + 1;
        }
      }
    }
  }
  out.h = Math.max(2, Math.min(H - 8, Math.round(h)));
  out.biome = best;
  out.t = t;
  out.freeze = freeze;
  out.lean = Math.min(4, lean);
  out.crater = best === VOLCANIC && island !== null && t > CRATER * island.r;
  return out;
}

/** Does column (x, z) of biome bm have a patch of its patch block on top (on land; on the sea floor for a sea biome)? */
const patched = (seed: number, bm: Biome, x: number, z: number, h: number) =>
  bm.patchAmount > 0 && (h < S) === bm.ocean && vnoise(seed ^ K_PATCH, x / 7, z / 7) * 0.8 + hash2(seed ^ K_PATCH, x, z) * 0.2 < bm.patchAmount;

/* ---------- the badlands' terracotta bands ---------- */
let bandSeed = NaN;
const BANDS = new Uint8Array(H);
/**
 * The seed's bands: a terracotta colour (0–5, see TERRACOTTAS) for every height. They come in
 * rounds of about 13 blocks, each with all five colours in an order of its own and plain terracotta
 * between them, so every mesa shows all six.
 */
function bands(seed: number): Uint8Array {
  if (seed === bandSeed) return BANDS;
  let y = 0;
  const run = (c: number, most: number) => { for (let n = 1 + Math.floor(hash2(seed ^ K_BAND, y, 2) * most); n > 0 && y < H; n--) BANDS[y++] = c; };
  for (let round = 0; y < H; round++) {
    const order = [1, 2, 3, 4, 5];
    for (let i = 4; i > 0; i--) { const j = Math.floor(hash2(seed ^ K_BAND, round, i) * (i + 1)), t = order[i]; order[i] = order[j]; order[j] = t; }
    run(0, 3); run(order[0], 2); run(0, 2); run(order[1], 2); run(order[2], 2); run(0, 3); run(order[3], 2); run(order[4], 2);
  }
  bandSeed = seed;
  return BANDS;
}
/** The terracotta at (x, y, z): the band at that height, the bands bending gently from place to place */
const band = (seed: number, x: number, y: number, z: number) =>
  TERRACOTTA + BANDS[Math.max(0, Math.min(H - 1, y + Math.round(4.8 * (vnoise(seed ^ K_BAND, x / 37, z / 37) - 0.5))))];

/* ---------- trees (for now: the oaks every biome with "oak" in its decorations grows) ---------- */
const TC = 6;
interface Tree { x: number; z: number; h: number; th: number; pri: number }
const TREE_CHANCE: Record<string, number> = { 'oak': 0.5, 'oak-sparse': 0.12 };
const TCOL = newCol();

function candidate(seed: number, gx: number, gz: number): Tree | null {
  const x = gx * TC + Math.floor(hash2(seed ^ K_TX, gx, gz) * TC), z = gz * TC + Math.floor(hash2(seed ^ K_TZ, gx, gz) * TC);
  if (!inWorld(x, z)) return null;
  const { h, biome, lean } = column2(seed, x, z, TCOL), bm = BIOMES[biome];
  const chance = bm.decorations.reduce((a, d) => a + (TREE_CHANCE[d] ?? 0), 0);
  if (!chance || hash2(seed ^ K_TREE, gx, gz) >= chance || h < S + 2 || bm.top !== GRASS || lean > 0.2) return null;
  // not on a slope: there the ground is rock
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (Math.abs(column2(seed, x + dx, z + dz, TCOL).h - h) >= 2) return null;
  return { x, z, h, th: 4 + Math.floor(hash2(seed ^ K_TH, gx, gz) * 2), pri: hash2(seed ^ K_PRI, gx, gz) };
}
/** Trees whose trunk or canopy touches the block rectangle [x0, x1] × [z0, z1] (spaced like generator 1's) */
function treesNear(seed: number, x0: number, z0: number, x1: number, z1: number): Tree[] {
  const memo = new Map<number, Tree | null>();
  const cand = (gx: number, gz: number) => {
    const k = (gx + 64) * 4096 + gz + 64;
    let t = memo.get(k);
    if (t === undefined) memo.set(k, (t = candidate(seed, gx, gz)));
    return t;
  };
  const out: Tree[] = [];
  for (let gz = Math.floor((z0 - 2) / TC); gz <= Math.floor((z1 + 2) / TC); gz++) for (let gx = Math.floor((x0 - 2) / TC); gx <= Math.floor((x1 + 2) / TC); gx++) {
    const t = cand(gx, gz);
    if (!t || t.x + 2 < x0 || t.x - 2 > x1 || t.z + 2 < z0 || t.z - 2 > z1) continue;
    let ok = true;
    for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const o = cand(gx + dx, gz + dz);
      if (o && Math.abs(o.x - t.x) <= 4 && Math.abs(o.z - t.z) <= 4 && (o.pri > t.pri || (o.pri === t.pri && (dz > 0 || (dz === 0 && dx > 0))))) { ok = false; break; }
    }
    if (ok) out.push(t);
  }
  return out;
}
function stampTree(seed: number, data: Uint8Array, x0: number, z0: number, t: Tree): void {
  const { x, z, h, th } = t, inside = (lx: number, lz: number) => lx >= 0 && lx < CS && lz >= 0 && lz < CS;
  if (inside(x - x0, z - z0)) {
    data[CI(x - x0, h - 1, z - z0)] = DIRT;
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

/* ---------- a chunk ---------- */
/** Columns of ground kept round a chunk: overhangs lean up to 4 blocks; caves keep 2 from any water */
const BR = 4, NB = CS + 2 * BR;
const HM = new Int16Array(NB * NB), DRY = new Int16Array(CS * CS);
const COLS: Col[] = Array.from({ length: CS * CS }, newCol), BCOL = newCol();
/** How the ground leans (x and z offsets, −1…1) on a lattice every LS blocks over the chunk, from LY0 up */
const LS = 4, LN = CS / LS + 1, LY0 = S + 2, LNY = Math.ceil((H - LY0) / LS) + 1;
const LEANX = new Float32Array(LN * LN * LNY), LEANZ = new Float32Array(LN * LN * LNY);

/** What a seed's chunks share: its islands and biome map, terracotta bands and cave network */
function prepare2(seed: number): void {
  islands(seed);
  biomeMap(seed);
  bands(seed);
  network(seed, ground(seed), S);
}
const ground = (seed: number): Ground => ({
  height: (x, z) => column2(seed, x, z, BCOL).h,
  inland: (x, z) => coast(seed, x, z).t,
});
/** The lean (x or z, from L) at local (lx, y, lz), filled in between the lattice's points */
function leanAt(L: Float32Array, lx: number, y: number, lz: number): number {
  const fx = lx / LS, fy = (y - LY0) / LS, fz = lz / LS, i = Math.min(LN - 2, fx | 0), k = Math.min(LNY - 2, fy | 0), j = Math.min(LN - 2, fz | 0);
  const u = fx - i, v = fy - k, w = fz - j, n = i + LN * (j + LN * k), a = LN, b = LN * LN;
  const p = L[n] + (L[n + 1] - L[n]) * u, q = L[n + a] + (L[n + a + 1] - L[n + a]) * u;
  const r = L[n + b] + (L[n + b + 1] - L[n + b]) * u, s = L[n + b + a] + (L[n + b + a + 1] - L[n + b + a]) * u;
  const pq = p + (q - p) * w, rs = r + (s - r) * w;
  return pq + (rs - pq) * v;
}

function generateChunk2(seed: number, cx: number, cz: number): Uint8Array {
  prepare2(seed);
  const data = new Uint8Array(CHUNK_VOL), x0 = cx * CS, z0 = cz * CS;
  // the chunk's columns, then the ground round it: as far as overhangs reach, 2 at least (for the caves)
  let lean = 0, top = S;
  for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
    const c = column2(seed, x0 + lx, z0 + lz, COLS[lx + CS * lz]);
    HM[lx + BR + NB * (lz + BR)] = c.h;
    lean = Math.max(lean, c.lean);
  }
  const br = lean > 0 ? BR : 2;
  for (let bz = BR - br; bz < BR + CS + br; bz++) for (let bx = BR - br; bx < BR + CS + br; bx++) {
    if (bx < BR || bz < BR || bx >= BR + CS || bz >= BR + CS) HM[bx + NB * bz] = column2(seed, x0 + bx - BR, z0 + bz - BR, BCOL).h;
    top = Math.max(top, HM[bx + NB * bz]);
  }
  // where the ground leans: smooth 3D noise on a coarse lattice
  if (lean > 0) {
    for (let k = 0; k < LNY; k++) for (let j = 0; j < LN; j++) for (let i = 0; i < LN; i++) {
      const x = x0 + i * LS, y = LY0 + k * LS, z = z0 + j * LS, n = i + LN * (j + LN * k);
      LEANX[n] = 2 * vnoise3(seed ^ K_LEAN, x / 9, y / 7, z / 9) - 1;
      LEANZ[n] = 2 * vnoise3(seed ^ (K_LEAN + 1), x / 9, y / 7, z / 9) - 1;
    }
  }

  for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
    const c = COLS[lx + CS * lz], x = x0 + lx, z = z0 + lz, h = c.h, bm = BIOMES[c.biome], m = lx + BR + NB * (lz + BR);
    // how steep: the most the ground steps to a neighbour (3 or more and its faces are rock, 6 under
    // snow); dry: caves stay 2 below any water within 2 columns
    const steep = Math.max(Math.abs(HM[m + 1] - h), Math.abs(HM[m - 1] - h), Math.abs(HM[m + NB] - h), Math.abs(HM[m - NB] - h));
    let dry = H;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const hn = HM[m + dx + NB * dz]; if (hn < S) dry = Math.min(dry, hn - 2); }
    DRY[lx + CS * lz] = dry;
    const patch = patched(seed, bm, x, z, h), shore = h < S + 2 && h >= S && bm.shore !== bm.top && !c.rock;
    const rock = c.rock ? BIOMES[c.rock - 1] : null;
    const snow = bm.snowLine ? bm.snowLine + Math.round(6 * (vnoise(seed ^ K_SNOW, x / 19, z / 19) - 0.5)) : H;
    /** Is (x, y, z) rock? The ground (leaning out above the sea where it overhangs), or an arch */
    const solid = (y: number) => {
      if (y >= c.lo && y < c.hi) return true;
      if (y < LY0 || c.lean <= 0) return y < h;
      const ox = Math.round(c.lean * leanAt(LEANX, lx, y, lz)), oz = Math.round(c.lean * leanAt(LEANZ, lx, y, lz));
      return y < HM[Math.max(0, Math.min(NB - 1, lx + BR + ox)) + NB * Math.max(0, Math.min(NB - 1, lz + BR + oz))];
    };
    // top down: how deep each rock block is under the open air above it decides what it is made of
    let d = -1;
    for (let y = Math.min(H - 1, Math.max(top, c.hi) + 1); y > 0; y--) {
      const i = CI(lx, y, lz);
      if (!solid(y)) {
        d = -1;
        if (y < S) data[i] = WATER;                                  // the sea (still water: sources)
        continue;
      }
      d++;
      let b: number;
      if (rock && y >= S - 1) b = d === 0 && rock.top === GRASS && steep < 3 ? GRASS : rock.bands ? band(seed, x, y, z) : rock.cliff;  // stacks, arches
      else if (h < S && y < h) b = d === 0 && patch ? bm.patch : d < 3 ? bm.bed : STONE;          // the sea floor
      else if (shore && y < h) b = d === 0 ? bm.shore : d < 4 ? (bm.shore === GRASS ? DIRT : bm.shore) : STONE;   // a beach, gravel, mud…
      else if (steep >= (y >= snow ? 6 : 3) && d < 3) b = bm.bands ? band(seed, x, y, z) : bm.cliff;   // rock faces
      else if (d === 0) b = c.crater ? OBSIDIAN : y >= snow ? SNOW : patch ? bm.patch : bm.top;
      else if (d <= bm.fillDepth) b = bm.fill;
      else if (d <= bm.fillDepth + bm.underDepth) b = bm.bands ? band(seed, x, y, z) : bm.under;
      else b = STONE;
      data[i] = b;
    }
    data[CI(lx, 0, lz)] = BEDROCK;
    // a cold sea freezes over in floes
    if (h < S && c.freeze > 0 && data[CI(lx, S - 1, lz)] === WATER &&
      vnoise(seed ^ K_ICE, x / 6, z / 6) * 0.85 + hash2(seed ^ K_ICE, x, z) * 0.15 < c.freeze) data[CI(lx, S - 1, lz)] = ICE;
  }
  placeOres(seed, data, cx, cz);
  carveCaves(seed, network(seed, ground(seed), S), data, cx, cz, DRY);
  for (const t of treesNear(seed, x0, z0, x0 + CS - 1, z0 + CS - 1)) stampTree(seed, data, x0, z0, t);
  return data;
}

/** Generator 2's spawn: the dry grass nearest the middle of the start island, with no tree over it */
function findSpawn2(seed: number): [number, number] {
  const cx = W / 2, cz = D / 2;
  for (let r = 0; r < W / 2; r++) for (let i = -r; i <= r; i++) {
    for (const [x, z] of [[cx + i, cz - r], [cx + i, cz + r], [cx - r, cz + i], [cx + r, cz + i]]) {
      if (!inWorld(x, z)) continue;
      const { h, biome } = column2(seed, x, z);
      if (h >= S + 1 && BIOMES[biome].top === GRASS && treesNear(seed, x, z, x, z).length === 0) return [x, z];
    }
  }
  return [cx, cz];
}

const GENERATORS: Record<number, Generator> = {
  1: {
    version: 1, seaLevel: g1.SEA_LEVEL_1, cloudY: 64, prepare: () => {}, generateChunk: g1.generateChunk, findSpawn: g1.findSpawn,
    surfaceHeight: g1.columnHeight,
  },
  2: {
    version: 2, seaLevel: SEA_LEVEL, cloudY: 108, prepare: prepare2, generateChunk: generateChunk2, findSpawn: findSpawn2,
    surfaceHeight: (seed, x, z) => column2(seed, x, z).h,
  },
};

/** The generator with this version; throws for a version this build doesn't know. */
export function generator(version: number): Generator {
  const g = GENERATORS[version];
  if (!g) throw new Error(`unknown world generator ${version}`);
  return g;
}
