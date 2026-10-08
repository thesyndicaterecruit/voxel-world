/* ============================ BLOCK REGISTRY ============================ */
// Every block type and what it does: how it looks, collides, hides its neighbours' faces, lets light
// through and gets meshed. Ids are stored in chunk data and save files, so they never change; new
// blocks get new ids.

export const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5, PLANKS = 6, LEAVES = 7, BRICK = 8, BEDROCK = 9,
  WATER = 10;

// Texture tiles (painted procedurally in textures.ts — no image files).
// The order must match TILE_PAINTERS in textures.ts; new tiles go at the end.
export const T_GRASS_TOP = 0, T_GRASS_SIDE = 1, T_DIRT = 2, T_STONE = 3, T_SAND = 4, T_LOG_SIDE = 5, T_LOG_TOP = 6,
  T_PLANKS = 7, T_LEAVES = 8, T_BRICK = 9, T_BEDROCK = 10, T_WATER = 11, NT = 12;

/** Which mesh of a chunk a block's faces go into (see streaming.ts / textures.ts). */
export type RenderPass = 'opaque' | 'cutout' | 'translucent';
/** How a block is meshed: a full cube, the torch stick, or a liquid (lowered top, see mesher.ts). */
export type Model = 'cube' | 'torch' | 'liquid';

export interface BlockType {
  id: number;
  name: string;
  /** Tile per face kind: [side, top, bottom] */
  tex: [number, number, number];
  /** Collides with the player and particles */
  solid: boolean;
  /** Blocks light and hides the faces of neighbouring blocks */
  opaque: boolean;
  renderPass: RenderPass;
  /** Light it gives off, 0–15 */
  lightEmission: number;
  /** How much skylight it removes: 0 for air/glass, 1 leaves, 2 water, 15 opaque */
  lightFilter: number;
  model: Model;
  /** Two blocks of this type hide their shared face (glass, water). Leaves don't: bushy look. */
  cullSame: boolean;
  /** Subtle per-block brightness variation */
  jit: number;
}

export const B: BlockType[] = [];

const def = (id: number, name: string, top: number, side: number, bot: number, o: Partial<BlockType> = {}) =>
  (B[id] = {
    id, name, tex: [side, top, bot], solid: true, opaque: true, renderPass: 'opaque', lightEmission: 0, lightFilter: 15,
    model: 'cube', cullSame: false, jit: 0.06, ...o,
  });
def(AIR,     'Air',     0, 0, 0, { solid: false, opaque: false, lightFilter: 0, jit: 0 });
def(GRASS,   'Grass',   T_GRASS_TOP, T_GRASS_SIDE, T_DIRT);
def(DIRT,    'Dirt',    T_DIRT,      T_DIRT,       T_DIRT);
def(STONE,   'Stone',   T_STONE,     T_STONE,      T_STONE);
def(SAND,    'Sand',    T_SAND,      T_SAND,       T_SAND,     { jit: 0.04 });
def(LOG,     'Log',     T_LOG_TOP,   T_LOG_SIDE,   T_LOG_TOP,  { jit: 0.05 });
def(PLANKS,  'Planks',  T_PLANKS,    T_PLANKS,     T_PLANKS);
def(LEAVES,  'Leaves',  T_LEAVES,    T_LEAVES,     T_LEAVES,   { opaque: false, renderPass: 'cutout', lightFilter: 1, jit: 0.12 });
def(BRICK,   'Brick',   T_BRICK,     T_BRICK,      T_BRICK,    { jit: 0.05 });
def(BEDROCK, 'Bedrock', T_BEDROCK,   T_BEDROCK,    T_BEDROCK,  { jit: 0.1 });
// Water blocks: groundwork only — the world doesn't generate them yet (the sea is still one surface)
def(WATER,   'Water',   T_WATER,     T_WATER,      T_WATER,
  { solid: false, opaque: false, renderPass: 'translucent', lightFilter: 2, model: 'liquid', cullSame: true, jit: 0 });

export const HOTBAR = [GRASS, DIRT, STONE, SAND, LOG, PLANKS, LEAVES, BRICK];

// Tiles with no "up" direction get a random rotation per face, which hides tiling repetition
export const ROT = new Set([T_GRASS_TOP, T_DIRT, T_STONE, T_SAND, T_LEAVES, T_BEDROCK]);

/* ---------- lookup tables for hot loops (meshing, collision), indexed by block id ---------- */
const table = (f: (b: BlockType) => boolean | number) => {
  const t = new Uint8Array(256);
  for (const b of B) if (b) t[b.id] = +f(b);
  return t;
};
export const SOLID = table((b) => b.solid);
/** Render pass index: 0 opaque, 1 cutout, 2 translucent */
export const PASS = table((b) => ['opaque', 'cutout', 'translucent'].indexOf(b.renderPass));
/** Model index: 0 cube, 1 torch, 2 liquid */
export const MODEL = table((b) => ['cube', 'torch', 'liquid'].indexOf(b.model));
export const OPAQUE = table((b) => b.opaque);
export const CULL_SAME = table((b) => b.cullSame);
/** Darkens the corners next to it (ambient occlusion): cubes that dim light — opaque blocks and leaves */
export const OCCLUDES = table((b) => b.id !== AIR && b.model === 'cube' && b.lightFilter > 0);
/** Can be aimed at (to break or build against): everything but air and liquids */
export const TARGETABLE = table((b) => b.id !== AIR && b.model !== 'liquid');
/** A placed block may go here (replacing it): air and liquids */
export const REPLACEABLE = table((b) => b.id === AIR || b.model === 'liquid');

/**
 * Face culling: is the face of block `self` that touches block `nb` hidden? An opaque neighbour
 * hides it; so does a neighbour of the same type when that type culls itself (glass, water).
 * Leaves next to leaves still render, for the bushy look — unless `opaqueLeaves` (the "Fancy
 * leaves" setting is off), when leaves count as opaque cubes.
 */
export function faceHidden(self: number, nb: number, opaqueLeaves = false): boolean {
  if (nb === AIR) return false;
  if (OPAQUE[nb] || (opaqueLeaves && nb === LEAVES)) return true;
  return nb === self && CULL_SAME[self] === 1;
}
