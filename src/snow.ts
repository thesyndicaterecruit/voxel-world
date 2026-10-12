import { MODEL, M_CROSS, M_FLAT, M_TORCH } from './blocks';
import { CS, inWorld } from './config';
import { mulberry } from './noise';

/* ============================ SNOW ============================ */
// Falling snow, the pure part (weather.ts draws it). The flakes live in a box round the camera and
// the GPU moves them; this works out where snow reaches. Each column has a ceiling, the height its
// flakes stop at: on top of its highest block, whatever that is (a roof, glass, leaves, water, the
// ground over a cave), so nothing snows under cover. The ceilings of the COVER × COVER columns round
// the camera are kept in a grid that wraps round (a column's cell is its x and z modulo COVER, as
// the texture the shader reads repeats), so when the camera moves on only the columns that came
// into the window are worked out, and an edit or a chunk loading updates just its own columns.

export type SnowSetting = 'off' | 'auto' | 'on';
/** The menu's Snow setting, in the stepper's order */
export const SNOW_SETTINGS: readonly SnowSetting[] = ['off', 'auto', 'on'];

/**
 * How hard it snows (0–1): On always, Off never, Auto as hard as the biomes around say (`here`:
 * their snowfall by weight; the story world will have it snow everywhere).
 */
export const snowAmount = (setting: SnowSetting, here: number) =>
  setting === 'on' ? 1 : setting === 'off' ? 0 : Math.min(1, Math.max(0, here));

/** A column with no snow at all (its chunk isn't loaded yet) */
export const NO_SNOW = 255;
/**
 * Where flakes stop in a column whose highest block is `id` at height `y` (−1: an empty column): on
 * top of it, or at the foot of a plant, torch or flat block, so a tuft of grass doesn't stop the
 * snow a block up in the air.
 */
export function ceiling(id: number, y: number): number {
  if (y < 0) return 0;
  const m = MODEL[id];
  return m === M_CROSS || m === M_FLAT || m === M_TORCH ? y : y + 1;
}

/** What a column's ceiling is worked out from (the world) */
export interface Columns {
  isLoaded(x: number, z: number): boolean;
  topY(x: number, z: number): number;
  getBlock(x: number, y: number, z: number): number;
}
/** The ceiling of column (x, z): past the world's edge the sea's surface, none where it isn't loaded */
export function columnCeiling(w: Columns, seaLevel: number, x: number, z: number): number {
  if (!inWorld(x, z)) return seaLevel;
  if (!w.isLoaded(x, z)) return NO_SNOW;
  const y = w.topY(x, z);
  return ceiling(y < 0 ? 0 : w.getBlock(x, y, z), y);
}

/** The cover grid is COVER × COVER columns round the camera */
export const COVER = 64;
export interface Cover {
  /** The ceilings: column (x, z) at (x & (COVER − 1)) + (z & (COVER − 1)) · COVER */
  readonly data: Uint8Array<ArrayBuffer>;
  /** Something in `data` changed (whoever uploads it clears this) */
  dirty: boolean;
  /** Centre the window on point (x, z), working out the columns that came into it */
  recenter(x: number, z: number): void;
  /** Work column (x, z) out again (a block changed there), if it is in the window */
  refresh(x: number, z: number): void;
  /** Work out again the columns of chunk (cx, cz) in the window (it was just loaded) */
  refreshChunk(cx: number, cz: number): void;
  /** The ceiling of column (x, z), which must be in the window */
  at(x: number, z: number): number;
}

/** A cover grid whose columns' ceilings come from `column` */
export function createCover(column: (x: number, z: number) => number): Cover {
  const G = COVER, M = G - 1, data = new Uint8Array(G * G).fill(NO_SNOW);
  let ox = NaN, oz = NaN;                            // the window: columns [ox, ox + G) × [oz, oz + G)
  const fill = (x0: number, x1: number, z0: number, z1: number) => {
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) data[(x & M) + (z & M) * G] = column(x, z);
    if (x1 > x0 && z1 > z0) cover.dirty = true;
  };
  const cover: Cover = {
    data, dirty: false,
    recenter(x, z) {
      const nx = Math.floor(x) - G / 2, nz = Math.floor(z) - G / 2;
      if (nx === ox && nz === oz) return;
      if (!(Math.abs(nx - ox) < G && Math.abs(nz - oz) < G)) fill(nx, nx + G, nz, nz + G);   // all new (or the first time)
      else {
        // the columns that came in along x (the window's whole depth), then along z (over the rest)
        if (nx > ox) fill(ox + G, nx + G, nz, nz + G); else if (nx < ox) fill(nx, ox, nz, nz + G);
        const ax = Math.max(nx, ox), bx = Math.min(nx, ox) + G;
        if (nz > oz) fill(ax, bx, oz + G, nz + G); else if (nz < oz) fill(ax, bx, nz, oz);
      }
      ox = nx; oz = nz;
    },
    refresh(x, z) {
      if (x >= ox && x < ox + G && z >= oz && z < oz + G) fill(x, x + 1, z, z + 1);
    },
    refreshChunk(cx, cz) {
      fill(Math.max(cx * CS, ox), Math.min(cx * CS + CS, ox + G), Math.max(cz * CS, oz), Math.min(cz * CS + CS, oz + G));
    },
    at: (x, z) => data[(x & M) + (z & M) * G],
  };
  return cover;
}

/* ---------- the flakes ---------- */
/** The box of snow round the camera (blocks: x, y, z), its bottom this far below the eye */
export const SNOW_BOX = [36, 28, 36], SNOW_BELOW = 10;
/** The wind: blocks a second along x and z */
export const SNOW_WIND = [0.32, 0.14];

/**
 * `n` flakes from `seed`: where each starts in the box (pos, 3 a flake) and how it falls (flake, 4 a
 * flake): its speed (blocks a second), the phase and size (blocks) of its sway, and its size (× the
 * base size).
 */
export function flakeLayout(n: number, seed: number): { pos: Float32Array; flake: Float32Array } {
  const r = mulberry(seed ^ 0x2f6b9a13), pos = new Float32Array(n * 3), flake = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) pos[i * 3 + k] = r() * SNOW_BOX[k];
    flake[i * 4] = 0.9 + r() * 0.8;
    flake[i * 4 + 1] = r() * Math.PI * 2;
    flake[i * 4 + 2] = 0.2 + r() * 0.5;
    flake[i * 4 + 3] = 0.65 + r() * 0.7;
  }
  return { pos, flake };
}

/* ---------- the winter haze ---------- */
/** Where it snows, the fog and sky lean toward this pale, cold colour, this much at full snow */
export const WINTER_HAZE = 0xd6e0ec, WINTER_AMOUNT = 0.18;
/**
 * The haze with winter's mixed in for snow amount `snow` (0–1): `rgb` (0–1 a channel) is the haze
 * colour, changed in place, and `amount` how much of it there is; returns the new amount.
 */
export function winterHaze(rgb: number[], amount: number, snow: number): number {
  const w = WINTER_AMOUNT * snow, total = amount + w;
  if (total <= 0) return 0;
  for (let k = 0; k < 3; k++) rgb[k] = (rgb[k] * amount + (((WINTER_HAZE >> (16 - 8 * k)) & 255) / 255) * w) / total;
  return Math.min(1, total);
}
