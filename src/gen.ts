import { CS, CHUNK_VOL } from './config';
import { BEDROCK, STONE } from './blocks';
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

/* ---------- generator 2 ---------- */
/** Generator 2's sea level */
export const SEA_LEVEL = 48;
// For now generator 1's islands, raised to the taller world's sea level on more stone.
const LIFT = SEA_LEVEL - g1.SEA_LEVEL_1, LAYER = CS * CS;

function generateChunk2(seed: number, cx: number, cz: number): Uint8Array {
  const src = g1.generateChunk(seed, cx, cz), out = new Uint8Array(CHUNK_VOL), at = LIFT * LAYER;
  out.fill(BEDROCK, 0, LAYER);
  out.fill(STONE, LAYER, at);
  out.set(src.subarray(0, CHUNK_VOL - at), at);
  for (let i = at; i < at + LAYER; i++) if (out[i] === BEDROCK) out[i] = STONE;   // generator 1's bedrock, now underground
  return out;
}

const GENERATORS: Record<number, Generator> = {
  1: { version: 1, seaLevel: g1.SEA_LEVEL_1, cloudY: 64, generateChunk: g1.generateChunk, findSpawn: g1.findSpawn, surfaceHeight: g1.columnHeight },
  2: {
    version: 2, seaLevel: SEA_LEVEL, cloudY: 108, generateChunk: generateChunk2, findSpawn: g1.findSpawn,
    surfaceHeight: (seed, x, z) => g1.columnHeight(seed, x, z) + LIFT,
  },
};

/** The generator with this version; throws for a version this build doesn't know. */
export function generator(version: number): Generator {
  const g = GENERATORS[version];
  if (!g) throw new Error(`unknown world generator ${version}`);
  return g;
}
