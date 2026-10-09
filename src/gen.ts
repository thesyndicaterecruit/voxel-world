import { CS, CHUNK_VOL, CI, H, W, D, inWorld } from './config';
import { AIR, GRASS, DIRT, STONE, LOG, LEAVES, BEDROCK, WATER } from './blocks';
import { hash2, hash3, vnoise, fbm, sstep } from './noise';
import { BIOMES, NBIOMES, weights, coast, type Biome } from './biomes';
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
// border never makes a cliff of its own, and every shape meets the same coastline. The biome that
// counts most at a column (or, near a border, now and then the next one) lays its blocks on top.

/** Generator 2's sea level */
export const SEA_LEVEL = 48;
const S = SEA_LEVEL;
const K_RELIEF = 0x7a3b9c41, K_BED = 0x2e6f81d3, K_DITHER = 0x5d1f2a77, K_TREE = 0x68e31da4, K_TX = 0x1b56c4e9, K_TZ = 0x3c6ef372;
const K_TH = 0x5be0cd19, K_PRI = 0x6a09e667, K_LEAF = 0x1f83d9ab;
/** How far inland the ground takes to rise from the beach, and offshore the sea floor to sink (blocks) */
const RISE = 14, SHELF = 28;

/**
 * Biome `bm`'s ground at column (x, z), t blocks from the coast (positive inland): from the beach,
 * at sea level for every biome, it rises inland by `lift` plus rolling `amp`; offshore its floor sinks
 * to `depth` below the sea. Continuous in t, so blended biomes meet smoothly.
 */
function landform(seed: number, bm: Biome, x: number, z: number, t: number): number {
  if (t >= 0) {
    const r = sstep(Math.min(1, t / RISE));
    return S + r * (bm.lift + bm.amp * (fbm(seed ^ K_RELIEF, x * bm.freq, z * bm.freq) - 0.35));
  }
  const d = sstep(Math.min(1, -t / SHELF));
  return S - 1 - d * (bm.depth + (vnoise(seed ^ K_BED, x / 11, z / 11) - 0.5) * 3);
}

const W8 = new Float32Array(NBIOMES);
/** Column (x, z): its ground height (blocks y < h are filled) and the biome whose blocks are on top */
export function column2(seed: number, x: number, z: number): { h: number; biome: number } {
  const { t } = coast(seed, x, z);
  let best = weights(seed, x, z, W8), second = -1, h = 0;
  for (let i = 0; i < NBIOMES; i++) {
    if (W8[i] <= 0) continue;
    h += W8[i] * landform(seed, BIOMES[i], x, z, t);
    if (i !== best && (second < 0 || W8[i] > W8[second])) second = i;
  }
  // near a border the two biomes' blocks mingle
  if (second >= 0 && hash2(seed ^ K_DITHER, x, z) < W8[second] * 0.9) best = second;
  return { h: Math.max(2, Math.min(H - 8, Math.round(h))), biome: best };
}

/** Block at height y of a column h high (with the sea above it) whose top belongs to biome bm */
function layer2(bm: Biome, y: number, h: number): number {
  if (y === 0) return BEDROCK;
  if (h < S) return y >= h - 3 ? bm.bed : STONE;                      // under the sea
  if (h <= S + 1 && bm.shore !== bm.top) {                           // the shore: a beach, stones, mud…
    if (y === h - 1) return bm.shore;
    return y >= h - 4 ? (bm.shore === GRASS ? DIRT : bm.shore) : STONE;
  }
  if (y === h - 1) return bm.top;
  return y >= h - 1 - bm.fillDepth ? bm.fill : STONE;
}

/* ---------- trees (for now: the oaks every biome with "oak" in its decorations grows) ---------- */
const TC = 6;
interface Tree { x: number; z: number; h: number; th: number; pri: number }
const TREE_CHANCE: Record<string, number> = { 'oak': 0.5, 'oak-sparse': 0.12 };

function candidate(seed: number, gx: number, gz: number): Tree | null {
  const x = gx * TC + Math.floor(hash2(seed ^ K_TX, gx, gz) * TC), z = gz * TC + Math.floor(hash2(seed ^ K_TZ, gx, gz) * TC);
  if (!inWorld(x, z)) return null;
  const { h, biome } = column2(seed, x, z), bm = BIOMES[biome];
  const chance = bm.decorations.reduce((a, d) => a + (TREE_CHANCE[d] ?? 0), 0);
  if (!chance || hash2(seed ^ K_TREE, gx, gz) >= chance || h < S + 2 || bm.top !== GRASS) return null;
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

function generateChunk2(seed: number, cx: number, cz: number): Uint8Array {
  const data = new Uint8Array(CHUNK_VOL), x0 = cx * CS, z0 = cz * CS;
  for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
    const { h, biome } = column2(seed, x0 + lx, z0 + lz), bm = BIOMES[biome];
    for (let y = 0; y < h; y++) data[CI(lx, y, lz)] = layer2(bm, y, h);
    for (let y = h; y < S; y++) data[CI(lx, y, lz)] = WATER;           // still water: sources
  }
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
  1: { version: 1, seaLevel: g1.SEA_LEVEL_1, cloudY: 64, generateChunk: g1.generateChunk, findSpawn: g1.findSpawn, surfaceHeight: g1.columnHeight },
  2: {
    version: 2, seaLevel: SEA_LEVEL, cloudY: 108, generateChunk: generateChunk2, findSpawn: findSpawn2,
    surfaceHeight: (seed, x, z) => column2(seed, x, z).h,
  },
};

/** The generator with this version; throws for a version this build doesn't know. */
export function generator(version: number): Generator {
  const g = GENERATORS[version];
  if (!g) throw new Error(`unknown world generator ${version}`);
  return g;
}
