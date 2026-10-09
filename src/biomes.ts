import { W, D } from './config';
import { AIR, GRASS, DIRT, STONE, SAND, GRAVEL, CLAY, PODZOL, MUD, MOSS, SNOW, SANDSTONE, RED_SAND, TERRACOTTA, BASALT, COARSE_DIRT } from './blocks';
import { hash2, vnoise } from './noise';

/* ============================ BIOMES ============================ */
// Generator 2's world is made of biomes. Pure: everything here is a function of the seed and world
// coordinates, the same on every thread.
//
// Climate comes from smooth noise maps — temperature (colder toward the north, −z), humidity — and
// continentalness: how far a column is from the coast (coast(): ocean → coast → inland). Each island
// (one per cell of a jittered grid, islands()) gets the climate of its middle, and the islands are
// ranked by it, so each has one or two dominant biomes (primary, and secondary in patches, round its
// mountains or on its coast) and they differ from each other; the temperature changes slowly across
// the world, so neighbours make sense (no snow next to desert). The ocean's biome follows the
// temperature and the distance from land. Biomes are worked out on a coarse grid (CELL blocks) and
// blended (weights): terrain heights mix the biomes within BLEND blocks, so a border never makes a
// cliff of its own.

export const DEEP_OCEAN = 0, WARM_REEF = 1, FROZEN_OCEAN = 2, TROPICAL = 3, MEADOW = 4, FOREST = 5, CHERRY = 6, TAIGA = 7,
  SNOWY_PEAKS = 8, DESERT = 9, BADLANDS = 10, JUNGLE = 11, SWAMP = 12, VOLCANIC = 13;
export const NBIOMES = 14;

/**
 * A biome, as data: how its ground is shaped (landform in gen.ts), what it is made of, its colours
 * and its haze, and what grows on it.
 */
export interface Biome {
  readonly id: number;
  readonly name: string;
  /** A sea biome (its ground is the sea floor) */
  readonly ocean: boolean;
  /** Land: how far the ground rises inland (blocks above the coast), how much it rolls, and how often (1/blocks) */
  readonly lift: number;
  readonly amp: number;
  readonly freq: number;
  /** Sea: how deep its floor goes below sea level, offshore */
  readonly depth: number;
  /**
   * Its blocks, top down: the surface block, `fill` for fillDepth blocks under it, then `under` for
   * underDepth more, then stone; `bed` is its ground under water (3 deep), `shore` its ground at the
   * water's edge (a beach, gravel, mud…, 4 deep)
   */
  readonly top: number;
  readonly fill: number;
  readonly fillDepth: number;
  readonly under: number;
  readonly underDepth: number;
  readonly bed: number;
  readonly shore: number;
  /** Patches of another surface block (podzol, mud, clay on the sea floor…) on this much of its ground (0–1) */
  readonly patch: number;
  readonly patchAmount: number;
  /** How much of its sea's surface is ice (0–1) */
  readonly freeze: number;
  /** The colours (0xRRGGBB) its grass, leaves and water have: their tiles are grey and take these (textures.ts) */
  readonly grass: number;
  readonly foliage: number;
  readonly water: number;
  /** The fog and sky lean toward this colour, this much, while you're in the biome */
  readonly haze: number;
  readonly hazeAmount: number;
  /** What grows on it (trees, plants): filled in by part 2 */
  readonly decorations: readonly string[];
}

/** What a biome has unless it says otherwise */
const BASE: Omit<Biome, 'id' | 'name'> = {
  ocean: false, lift: 6, amp: 6, freq: 1 / 30, depth: 10, top: GRASS, fill: DIRT, fillDepth: 3, under: STONE, underDepth: 0,
  bed: SAND, shore: SAND, patch: AIR, patchAmount: 0, freeze: 0, grass: 0x5aa835, foliage: 0x3f8a2a, water: 0x3b80c8,
  haze: 0, hazeAmount: 0, decorations: [],
};
const biome = (id: number, name: string, o: Partial<Biome>): Biome => ({ ...BASE, ...o, id, name });

export const BIOMES: readonly Biome[] = [
  biome(DEEP_OCEAN, 'Deep Ocean', {
    ocean: true, lift: 1, amp: 1, freq: 1 / 20, depth: 26, top: SAND, fill: SAND, bed: GRAVEL, patch: CLAY, patchAmount: 0.15,
    grass: 0x55a032, foliage: 0x3f8a2a, water: 0x2c5fa8 }),
  biome(WARM_REEF, 'Warm Reef Ocean', {
    ocean: true, lift: 1, amp: 1, freq: 1 / 20, depth: 9, top: SAND, fill: SAND, under: SANDSTONE, underDepth: 3, bed: SAND,
    grass: 0x8db84a, foliage: 0x5aa03a, water: 0x2fb5b0 }),
  biome(FROZEN_OCEAN, 'Frozen Ocean', {
    ocean: true, lift: 1, amp: 1, freq: 1 / 20, depth: 16, top: GRAVEL, fill: GRAVEL, bed: GRAVEL, shore: GRAVEL, patch: CLAY, patchAmount: 0.15,
    freeze: 0.55, grass: 0x8fb09a, foliage: 0x6a8a78, water: 0x6a8fb0, haze: 0xdfe8f0, hazeAmount: 0.25 }),
  biome(TROPICAL, 'Tropical Beach', {
    lift: 1.5, amp: 2, freq: 1 / 18, depth: 5, top: SAND, fill: SAND, fillDepth: 4, under: SANDSTONE, underDepth: 4,
    grass: 0x8db84a, foliage: 0x5aa03a, water: 0x35b8b8, decorations: ['oak-sparse'] }),
  biome(MEADOW, 'Meadow', {
    lift: 6, amp: 8, freq: 1 / 40, grass: 0x5aa835, foliage: 0x3f8a2a, water: 0x3b80c8, decorations: ['oak-sparse'] }),
  biome(FOREST, 'Forest', {
    lift: 5, amp: 5, freq: 1 / 24, grass: 0x4a8f30, foliage: 0x2f7524, water: 0x3a78b8, decorations: ['oak'] }),
  biome(CHERRY, 'Cherry Grove', {
    lift: 9, amp: 10, freq: 1 / 34, grass: 0x7cb85a, foliage: 0x5a9a3c, water: 0x4088c8, haze: 0xf4d6e4, hazeAmount: 0.12,
    decorations: ['oak-sparse'] }),
  biome(TAIGA, 'Taiga', {
    lift: 8, amp: 10, freq: 1 / 30, depth: 12, bed: GRAVEL, shore: GRAVEL, patch: PODZOL, patchAmount: 0.35,
    grass: 0x4f7f5c, foliage: 0x3a6650, water: 0x3a6a98, haze: 0xc8d8e8, hazeAmount: 0.15 }),
  biome(SNOWY_PEAKS, 'Snowy Peaks', {
    lift: 32, amp: 36, freq: 1 / 44, depth: 14, top: SNOW, fill: STONE, fillDepth: 1, bed: GRAVEL, shore: GRAVEL,
    grass: 0x8fb09a, foliage: 0x6a8a78, water: 0x5a80a8, haze: 0xe8f0f8, hazeAmount: 0.3 }),
  biome(DESERT, 'Desert Dunes', {
    lift: 4, amp: 6, freq: 1 / 20, depth: 8, top: SAND, fill: SAND, fillDepth: 4, under: SANDSTONE, underDepth: 6,
    grass: 0xb5a94e, foliage: 0x8a8a3a, water: 0x3aa0a8, haze: 0xf0dcb0, hazeAmount: 0.25 }),
  biome(BADLANDS, 'Badlands', {
    lift: 14, amp: 12, freq: 1 / 40, top: RED_SAND, fill: RED_SAND, fillDepth: 2, under: TERRACOTTA, underDepth: 14, bed: RED_SAND,
    shore: RED_SAND, grass: 0xa58a48, foliage: 0x8a7a3a, water: 0x7a7a60, haze: 0xf0c8a0, hazeAmount: 0.25 }),
  biome(JUNGLE, 'Jungle', {
    lift: 14, amp: 18, freq: 1 / 30, fillDepth: 4, patch: MOSS, patchAmount: 0.12,
    grass: 0x3aa028, foliage: 0x2a8a1e, water: 0x3a8a78, haze: 0xc8e0c0, hazeAmount: 0.2 }),
  biome(SWAMP, 'Swamp', {
    lift: 0.6, amp: 1.5, freq: 1 / 18, depth: 4, bed: CLAY, shore: MUD, patch: MUD, patchAmount: 0.3,
    grass: 0x6a7a3a, foliage: 0x4e6630, water: 0x4a6a3a, haze: 0xb8c4a0, hazeAmount: 0.3, decorations: ['oak-sparse'] }),
  biome(VOLCANIC, 'Volcanic Island', {
    lift: 20, amp: 4, freq: 1 / 16, depth: 18, top: BASALT, fill: BASALT, fillDepth: 4, bed: GRAVEL, shore: GRAVEL,
    patch: COARSE_DIRT, patchAmount: 0.2, grass: 0x5f6e44, foliage: 0x4e5a3a, water: 0x4a6070, haze: 0xa8a4a0, hazeAmount: 0.3 }),
];


/* ---------- the archipelago ---------- */
// Islands sit one to a cell of a jittered ISLES × ISLES grid inside a band of open sea along the
// world's edge; the middle cell's island is where the player starts. Each has a size, and its
// coastline is pushed in and out by warped noise. coast() says how far a column is from the nearest
// coast: positive inland, negative out at sea.
const K_ISLE = 0x45d9f3b7, K_IX = 0x1b873593, K_IZ = 0x5c6e1a2b, K_IR = 0x3a7c51d3, K_WX = 0x6c8e9cf5, K_WZ = 0x2f4a7b1d;
const K_SHORE = 0x7f4a7c15, K_TEMP = 0x9e3779b9, K_HUM = 0x85ebca6b, K_SEC = 0xc2b2ae35;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Open sea along the edge (blocks), and the island grid inside it */
const MARGIN = 40, ISLES = 5, ICELL = (W - 2 * MARGIN) / ISLES;

export interface Island {
  /** Grid cell, middle (blocks) and radius */
  gx: number; gz: number; x: number; z: number; r: number;
  /** Its shape: stretched along x and z, and skewed (an ellipse at an angle, without trig) */
  sx: number; sz: number; k: number;
  temp: number; hum: number;
  /** Its dominant biome, and the one it has in patches or by height (see biomeOf) */
  primary: number; secondary: number;
}

/** The island of grid cell (gx, gz), or null where the sea is open */
function islandIn(seed: number, gx: number, gz: number): Island | null {
  if (gx < 0 || gz < 0 || gx >= ISLES || gz >= ISLES) return null;
  const spawn = gx === ISLES >> 1 && gz === ISLES >> 1, h = hash2(seed ^ K_ISLE, gx, gz);
  if (!spawn && h < 0.12) return null;
  // big, middling, small or an islet; the start island is big and in the middle of its cell
  const size = hash2(seed ^ K_IR, gx, gz);
  const r = spawn ? 40 : size < 0.25 ? 33 + size * 36 : size < 0.7 ? 20 + (size - 0.25) * 24 : size < 0.92 ? 11 + (size - 0.7) * 30 : 6 + (size - 0.92) * 40;
  const j = spawn ? 0 : ICELL / 2 - r - 4;
  const x = MARGIN + (gx + 0.5) * ICELL + (spawn ? 0 : (hash2(seed ^ K_IX, gx, gz) - 0.5) * 2 * Math.max(0, j));
  const z = MARGIN + (gz + 0.5) * ICELL + (spawn ? 0 : (hash2(seed ^ K_IZ, gx, gz) - 0.5) * 2 * Math.max(0, j));
  const sx = spawn ? 1 : 0.75 + hash2(seed ^ K_IX, gx + 7, gz) * 0.5, sz = spawn ? 1 : 1.75 - sx;
  const k = spawn ? 0 : (hash2(seed ^ K_IZ, gx + 7, gz) - 0.5) * 0.8;
  return { gx, gz, x, z, r, sx, sz, k, temp: 0, hum: 0, primary: MEADOW, secondary: FOREST };
}

/** 0 frozen … 1 tropical: colder toward the north (−z), with slow wobbles */
export const temperature = (seed: number, x: number, z: number) =>
  clamp01(0.04 + 0.92 * ((z - MARGIN) / (D - 2 * MARGIN)) + (vnoise(seed ^ K_TEMP, x / 210, z / 210) - 0.5) * 0.3);
/** 0 dry … 1 wet */
export const humidity = (seed: number, x: number, z: number) =>
  clamp01(0.5 + (vnoise(seed ^ K_HUM, x / 150, z / 150) * 0.7 + vnoise(seed ^ K_HUM, x / 57 + 9.7, z / 57 - 3.1) * 0.3 - 0.5) * 1.7);

let islandSeed = NaN, islandList: Island[] = [], islandGrid: (Island | null)[] = [];
/**
 * The seed's islands, with their climate and biomes (worked out once per seed). Islands are ranked by
 * temperature into cold, mild and hot thirds, and within each by humidity and size, so every world
 * has every biome somewhere, neighbours' climates agree, and each island is its own place.
 */
export function islands(seed: number): { list: Island[]; grid: (Island | null)[] } {
  if (seed === islandSeed) return { list: islandList, grid: islandGrid };
  const grid: (Island | null)[] = [], list: Island[] = [];
  for (let gz = 0; gz < ISLES; gz++) for (let gx = 0; gx < ISLES; gx++) {
    const isl = islandIn(seed, gx, gz);
    grid.push(isl);
    if (isl) { isl.temp = temperature(seed, isl.x, isl.z); isl.hum = humidity(seed, isl.x, isl.z); list.push(isl); }
  }
  const spawn = grid[(ISLES >> 1) * (ISLES + 1)]!;
  spawn.primary = MEADOW; spawn.secondary = FOREST;
  const rest = list.filter((i) => i !== spawn).sort((a, b) => a.temp - b.temp);
  const n = rest.length, cold = rest.slice(0, Math.round(n * 0.3)), hot = rest.slice(Math.round(n * 0.62)), mild = rest.slice(cold.length, n - hot.length);
  const set = (i: Island, p: number, s: number) => { i.primary = p; i.secondary = s; };
  // cold: the biggest has the snowy peaks, the rest is taiga (with peaks on the big ones)
  cold.sort((a, b) => b.r - a.r).forEach((i, k) => (k === 0 ? set(i, SNOWY_PEAKS, TAIGA) : set(i, TAIGA, i.r > 26 ? SNOWY_PEAKS : TAIGA)));
  // mild: driest meadow, wettest swamp, cherry groves and forests between; a middling one a volcano
  mild.sort((a, b) => a.hum - b.hum).forEach((i, k) => {
    if (k === 0) set(i, MEADOW, CHERRY);
    else if (k === mild.length - 1) set(i, SWAMP, FOREST);
    else set(i, k % 2 ? FOREST : CHERRY, k % 2 ? MEADOW : FOREST);
  });
  const volcano = mild.length > 3 ? mild.filter((i) => i.r >= 12 && i.r <= 30).sort((a, b) => hash2(seed ^ K_ISLE, a.gx, a.gz + 9) - hash2(seed ^ K_ISLE, b.gx, b.gz + 9))[0] : undefined;
  if (volcano) set(volcano, VOLCANIC, VOLCANIC);
  // hot: driest desert, then badlands, wettest jungle (mangrove swamp on its coast); small ones tropical islets
  hot.sort((a, b) => a.hum - b.hum).forEach((i, k) => {
    if (i.r < 16 && k > 1) set(i, TROPICAL, TROPICAL);
    else if (k === 0) set(i, DESERT, BADLANDS);
    else if (k === 1) set(i, BADLANDS, DESERT);
    else if (k === hot.length - 1) set(i, JUNGLE, SWAMP);
    else set(i, k % 2 ? JUNGLE : TROPICAL, k % 2 ? TROPICAL : JUNGLE);
  });
  if (!hot.some((i) => i.primary === TROPICAL)) { const s = hot.slice().sort((a, b) => a.r - b.r)[0]; if (s && hot.length > 2) set(s, TROPICAL, TROPICAL); }
  islandSeed = seed; islandList = list; islandGrid = grid;
  return { list, grid };
}

/**
 * How far column (x, z) is from the nearest coast in blocks (positive inland, negative at sea), and
 * whose island that is (null far out at sea).
 */
export function coast(seed: number, x: number, z: number): { t: number; island: Island | null; u: number } {
  const { grid } = islands(seed);
  const wx = x + (vnoise(seed ^ K_WX, x / 41, z / 41) - 0.5) * 34, wz = z + (vnoise(seed ^ K_WZ, x / 41, z / 41) - 0.5) * 34;
  const gx = Math.floor((x - MARGIN) / ICELL), gz = Math.floor((z - MARGIN) / ICELL);
  let t = -1e9, best: Island | null = null;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const isl = gx + dx >= 0 && gz + dz >= 0 && gx + dx < ISLES && gz + dz < ISLES ? grid[gx + dx + (gz + dz) * ISLES] : null;
    if (!isl) continue;
    const ex = wx - isl.x, ez = wz - isl.z, ax = ex * isl.sx + ez * isl.k, az = ez * isl.sz + ex * isl.k;
    const v = isl.r - Math.sqrt(ax * ax + az * az);
    if (v > t) { t = v; best = isl; }
  }
  if (!best) return { t: -1e9, island: null, u: 0 };
  // bays and headlands, more on bigger islands
  t += (vnoise(seed ^ K_SHORE, x / 19, z / 19) - 0.5) * (4 + best.r * 0.22);
  return { t, island: best, u: t / best.r };
}

/* ---------- islands and the biome map ---------- */
/** Biomes are worked out per CELL × CELL blocks (the coarse grid: GN × GN cells) */
export const CELL = 4, GN = W / CELL;
/** Heights blend the biomes within this many blocks */
export const BLEND = 8;

/** The biome at column (x, z), before blending */
function biomeOf(seed: number, x: number, z: number): number {
  const { t, island, u } = coast(seed, x, z);
  if (t < 0 || !island) {
    const temp = temperature(seed, x, z);
    return temp < 0.26 ? FROZEN_OCEAN : temp > 0.6 && t > -22 ? WARM_REEF : DEEP_OCEAN;
  }
  const p = island.primary, s = island.secondary;
  if (p === s) return p;
  if (p === SNOWY_PEAKS) return u > 0.3 ? p : s;                       // peaks inland, taiga round them
  if (s === SNOWY_PEAKS) return u > 0.55 ? s : p;
  if (s === SWAMP) return t < 7 ? s : p;                                // mangroves on the jungle's coast
  return vnoise(seed ^ K_SEC, x / 34, z / 34) > 0.6 ? s : p;            // patches
}

interface BiomeMap { biome: Uint8Array }
const maps = new Map<number, BiomeMap>();
/** The seed's biome per coarse cell (worked out once per seed, then remembered) */
export function biomeMap(seed: number): BiomeMap {
  let m = maps.get(seed);
  if (m) return m;
  if (maps.size > 2) maps.clear();
  const biome = new Uint8Array(GN * GN);
  for (let gz = 0; gz < GN; gz++) for (let gx = 0; gx < GN; gx++) biome[gx + gz * GN] = biomeOf(seed, gx * CELL + CELL / 2, gz * CELL + CELL / 2);
  m = { biome };
  maps.set(seed, m);
  return m;
}

/** The biome of the cell holding column (x, z) (outside the world: the ocean's) */
export function biomeAt(seed: number, x: number, z: number): number {
  const m = biomeMap(seed), gx = Math.min(GN - 1, Math.max(0, Math.floor(x / CELL))), gz = Math.min(GN - 1, Math.max(0, Math.floor(z / CELL)));
  return m.biome[gx + gz * GN];
}

/**
 * How much each biome counts at column (x, z): the cells within BLEND blocks, nearer ones more,
 * summed per biome into `out` (NBIOMES, adding up to 1). Returns the biome that counts most.
 */
export function weights(seed: number, x: number, z: number, out: Float32Array): number {
  const m = biomeMap(seed), px = x + 0.5, pz = z + 0.5, r = BLEND;
  out.fill(0);
  let sum = 0;
  for (let gz = Math.floor((pz - r) / CELL); gz <= Math.floor((pz + r) / CELL); gz++) {
    for (let gx = Math.floor((px - r) / CELL); gx <= Math.floor((px + r) / CELL); gx++) {
      const dx = (gx + 0.5) * CELL - px, dz = (gz + 0.5) * CELL - pz, d2 = (dx * dx + dz * dz) / (r * r);
      if (d2 >= 1) continue;
      const w = (1 - d2) * (1 - d2), k = Math.min(GN - 1, Math.max(0, gx)) + Math.min(GN - 1, Math.max(0, gz)) * GN;
      out[m.biome[k]] += w;
      sum += w;
    }
  }
  let best = 0;
  for (let i = 0; i < NBIOMES; i++) { out[i] /= sum; if (out[i] > out[best]) best = i; }
  return best;
}

/**
 * The nearest place of biome `id` to (x, z): the middle of a cell well inside it (its neighbours the
 * same biome) if there is one, else any of its cells; null if the world has none.
 */
export function findBiome(seed: number, id: number, x: number, z: number): [number, number] | null {
  const m = biomeMap(seed), at = (gx: number, gz: number) => m.biome[Math.min(GN - 1, Math.max(0, gx)) + Math.min(GN - 1, Math.max(0, gz)) * GN];
  let best: [number, number] | null = null, bd = Infinity;
  for (const inner of [true, false]) {
    for (let k = 0; k < GN * GN; k++) {
      if (m.biome[k] !== id) continue;
      const gx = k % GN, gz = (k / GN) | 0;
      if (inner) {
        let all = true;
        for (let dz = -1; dz <= 1 && all; dz++) for (let dx = -1; dx <= 1; dx++) if (at(gx + dx, gz + dz) !== id) { all = false; break; }
        if (!all) continue;
      }
      const cx = gx * CELL + CELL / 2, cz = gz * CELL + CELL / 2, d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d < bd) { bd = d; best = [cx, cz]; }
    }
    if (best) return best;
  }
  return null;
}

/** Tint kinds: layers of the tint map */
export const TINT_GRASS = 0, TINT_FOLIAGE = 1, TINT_WATER = 2;
/**
 * The world's tints, GN × GN texels per kind (grass, foliage, water, one after another), RGBA: the
 * colour each shows there, every cell an average of the biomes around it, so colours blend smoothly.
 */
export function tintMap(seed: number): Uint8Array {
  const m = biomeMap(seed), out = new Uint8Array(GN * GN * 4 * 3), R = 2;
  for (let gz = 0; gz < GN; gz++) for (let gx = 0; gx < GN; gx++) {
    const acc = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    let sum = 0;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const d2 = (dx * dx + dz * dz) / ((R + 1) * (R + 1));
      if (d2 >= 1) continue;
      const w = (1 - d2) * (1 - d2), bm = BIOMES[m.biome[Math.min(GN - 1, Math.max(0, gx + dx)) + Math.min(GN - 1, Math.max(0, gz + dz)) * GN]];
      [bm.grass, bm.foliage, bm.water].forEach((c, k) => {
        acc[k * 3] += ((c >> 16) & 255) * w; acc[k * 3 + 1] += ((c >> 8) & 255) * w; acc[k * 3 + 2] += (c & 255) * w;
      });
      sum += w;
    }
    for (let k = 0; k < 3; k++) {
      const o = (k * GN * GN + gx + gz * GN) * 4;
      out[o] = Math.round(acc[k * 3] / sum); out[o + 1] = Math.round(acc[k * 3 + 1] / sum); out[o + 2] = Math.round(acc[k * 3 + 2] / sum); out[o + 3] = 255;
    }
  }
  return out;
}
