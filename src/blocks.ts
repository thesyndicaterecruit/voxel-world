/* ============================ BLOCK REGISTRY ============================ */
// Every block type and what it does: how it looks, collides, hides its neighbours' faces, lets light
// through and gets meshed. Ids are stored in chunk data and save files, so they never change; new
// blocks get new ids.

export const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5, PLANKS = 6, LEAVES = 7, BRICK = 8, BEDROCK = 9,
  WATER = 10, GLASS = 11, TORCH = 12;

// Texture tiles (painted procedurally in textures.ts — no image files).
// The order must match TILE_PAINTERS in textures.ts; new tiles go at the end.
export const T_GRASS_TOP = 0, T_GRASS_SIDE = 1, T_DIRT = 2, T_STONE = 3, T_SAND = 4, T_LOG_SIDE = 5, T_LOG_TOP = 6,
  T_PLANKS = 7, T_LEAVES = 8, T_BRICK = 9, T_BEDROCK = 10, T_WATER = 11, T_GLASS = 12, T_LEAVES_CUT = 13, T_TORCH = 14,
  NT = 15;

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
  /** Tile for the hotbar icon */
  icon: number;
  /** Tile for the bits that fly off when it breaks */
  particle: number;
  /** Tiles to use when the block is meshed as an opaque cube instead (leaves with Fancy leaves off) */
  fastTex?: [number, number, number];
}

export const B: BlockType[] = [];

const def = (id: number, name: string, top: number, side: number, bot: number, o: Partial<BlockType> = {}) =>
  (B[id] = {
    id, name, tex: [side, top, bot], solid: true, opaque: true, renderPass: 'opaque', lightEmission: 0, lightFilter: 15,
    model: 'cube', cullSame: false, jit: 0.06, icon: side, particle: side, ...o,
  });
def(AIR,     'Air',     0, 0, 0, { solid: false, opaque: false, lightFilter: 0, jit: 0 });
def(GRASS,   'Grass',   T_GRASS_TOP, T_GRASS_SIDE, T_DIRT);
def(DIRT,    'Dirt',    T_DIRT,      T_DIRT,       T_DIRT);
def(STONE,   'Stone',   T_STONE,     T_STONE,      T_STONE);
def(SAND,    'Sand',    T_SAND,      T_SAND,       T_SAND,     { jit: 0.04 });
def(LOG,     'Log',     T_LOG_TOP,   T_LOG_SIDE,   T_LOG_TOP,  { jit: 0.05 });
def(PLANKS,  'Planks',  T_PLANKS,    T_PLANKS,     T_PLANKS);
def(LEAVES,  'Leaves',  T_LEAVES_CUT, T_LEAVES_CUT, T_LEAVES_CUT, { opaque: false, renderPass: 'cutout', lightFilter: 1, jit: 0.12,
  fastTex: [T_LEAVES, T_LEAVES, T_LEAVES], icon: T_LEAVES, particle: T_LEAVES });
def(BRICK,   'Brick',   T_BRICK,     T_BRICK,      T_BRICK,    { jit: 0.05 });
def(BEDROCK, 'Bedrock', T_BEDROCK,   T_BEDROCK,    T_BEDROCK,  { jit: 0.1 });
// Water blocks: groundwork only — the world doesn't generate them yet (the sea is still one surface)
def(WATER,   'Water',   T_WATER,     T_WATER,      T_WATER,
  { solid: false, opaque: false, renderPass: 'translucent', lightFilter: 2, model: 'liquid', cullSame: true, jit: 0 });
def(GLASS,   'Glass',   T_GLASS,     T_GLASS,      T_GLASS,
  { opaque: false, renderPass: 'cutout', lightFilter: 0, cullSame: true, jit: 0 });
// Torch: a thin stick, not a cube; standing or on a wall (facing in its block state, see torch.ts)
def(TORCH,   'Torch',   T_TORCH,     T_TORCH,      T_TORCH,
  { solid: false, opaque: false, renderPass: 'cutout', lightEmission: 14, lightFilter: 0, model: 'torch', jit: 0, particle: T_PLANKS });

// New items go at the end, so hotbar slots saved by older versions keep pointing at the same block
export const HOTBAR = [GRASS, DIRT, STONE, SAND, LOG, PLANKS, LEAVES, BRICK, GLASS, TORCH];

// Tiles with no "up" direction get a random rotation per face, which hides tiling repetition
export const ROT = new Set([T_GRASS_TOP, T_DIRT, T_STONE, T_SAND, T_LEAVES, T_BEDROCK, T_LEAVES_CUT]);

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
/** How much light a block takes away (15: opaque, light stops there) — see light.ts */
export const FILTER = table((b) => b.lightFilter);
/** Light a block gives off, 0–15 */
export const EMIT = table((b) => b.lightEmission);
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
