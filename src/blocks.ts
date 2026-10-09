/* ============================ BLOCK REGISTRY ============================ */
// Every block type and what it does: how it looks, collides, hides its neighbours' faces, lets light
// through and gets meshed. Ids are stored in chunk data and save files, so they never change; new
// blocks get new ids.

export const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5, PLANKS = 6, LEAVES = 7, BRICK = 8, BEDROCK = 9,
  WATER = 10, GLASS = 11, TORCH = 12, SNOW = 13, ICE = 14, PACKED_ICE = 15, SANDSTONE = 16, RED_SAND = 17,
  /** Terracotta in 6 colours: TERRACOTTA + 0 … 5, plain, white, orange, yellow, red, brown (the Badlands' bands) */
  TERRACOTTA = 18, GRAVEL = 24, CLAY = 25, PODZOL = 26, COARSE_DIRT = 27, MUD = 28, MOSS = 29, BASALT = 30, OBSIDIAN = 31,
  COAL_ORE = 32, COPPER_ORE = 33, IRON_ORE = 34, GOLD_ORE = 35, GLOW_CRYSTAL = 36;
/** The terracotta colours' names, in id order from TERRACOTTA */
export const TERRACOTTAS = ['Terracotta', 'White Terracotta', 'Orange Terracotta', 'Yellow Terracotta', 'Red Terracotta', 'Brown Terracotta'];

// Texture tiles (painted procedurally in textures.ts — no image files).
// The order must match TILE_PAINTERS in textures.ts; new tiles go at the end.
export const T_GRASS_TOP = 0, T_GRASS_SIDE = 1, T_DIRT = 2, T_STONE = 3, T_SAND = 4, T_LOG_SIDE = 5, T_LOG_TOP = 6,
  T_PLANKS = 7, T_LEAVES = 8, T_BRICK = 9, T_BEDROCK = 10, T_WATER = 11, T_GLASS = 12, T_LEAVES_CUT = 13, T_TORCH = 14;
/**
 * Animated water: WATER_FRAMES tiles in a row each, played in the chunk shader (textures.ts): still
 * water's ripples, and flowing water's streaks running toward −v (down a side face).
 */
export const WATER_FRAMES = 16, T_WATER_STILL = 15, T_WATER_FLOW = T_WATER_STILL + WATER_FRAMES;
// the tiles after the water's frames (T_WATER_FLOW + WATER_FRAMES = 47)
export const T_SNOW = 47, T_ICE = 48, T_PACKED_ICE = 49, T_SANDSTONE_TOP = 50, T_SANDSTONE = 51, T_SANDSTONE_BOTTOM = 52,
  T_RED_SAND = 53, T_TERRACOTTA = 54 /* … 59, one per colour */, T_GRAVEL = 60, T_CLAY = 61, T_PODZOL_TOP = 62, T_PODZOL_SIDE = 63,
  T_COARSE_DIRT = 64, T_MUD = 65, T_MOSS = 66, T_BASALT_TOP = 67, T_BASALT = 68, T_OBSIDIAN = 69, T_COAL_ORE = 70,
  T_COPPER_ORE = 71, T_IRON_ORE = 72, T_GOLD_ORE = 73, T_GLOW_CRYSTAL = 74;
export const NT = 75;

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
  /** Walking on it slides: the player's feet barely grip (ice) */
  slippery: boolean;
}

export const B: BlockType[] = [];

const def = (id: number, name: string, top: number, side: number, bot: number, o: Partial<BlockType> = {}) =>
  (B[id] = {
    id, name, tex: [side, top, bot], solid: true, opaque: true, renderPass: 'opaque', lightEmission: 0, lightFilter: 15,
    model: 'cube', cullSame: false, jit: 0.06, icon: side, particle: side, slippery: false, ...o,
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
// Water: the sea, lakes, and what flows from them; still ripples on top, streaks running down its sides
def(WATER,   'Water',   T_WATER_STILL, T_WATER_FLOW, T_WATER_STILL,
  { solid: false, opaque: false, renderPass: 'translucent', lightFilter: 2, model: 'liquid', cullSame: true, jit: 0,
    icon: T_WATER, particle: T_WATER });
def(GLASS,   'Glass',   T_GLASS,     T_GLASS,      T_GLASS,
  { opaque: false, renderPass: 'cutout', lightFilter: 0, cullSame: true, jit: 0 });
// Torch: a thin stick, not a cube; standing or on a wall (facing in its block state, see torch.ts)
def(TORCH,   'Torch',   T_TORCH,     T_TORCH,      T_TORCH,
  { solid: false, opaque: false, renderPass: 'cutout', lightEmission: 14, lightFilter: 0, model: 'torch', jit: 0, particle: T_PLANKS });
def(SNOW,    'Snow',    T_SNOW,      T_SNOW,       T_SNOW,     { jit: 0.03 });
// Ice: see-through like water (and shiny on top: no jitter, so the water shader reflects the sky), slippery
def(ICE,     'Ice',     T_ICE,       T_ICE,        T_ICE,
  { opaque: false, renderPass: 'translucent', lightFilter: 2, cullSame: true, jit: 0, slippery: true });
def(PACKED_ICE, 'Packed Ice', T_PACKED_ICE, T_PACKED_ICE, T_PACKED_ICE, { jit: 0.04, slippery: true });
def(SANDSTONE, 'Sandstone', T_SANDSTONE_TOP, T_SANDSTONE, T_SANDSTONE_BOTTOM, { jit: 0.04 });
def(RED_SAND, 'Red Sand', T_RED_SAND,  T_RED_SAND,   T_RED_SAND, { jit: 0.04 });
TERRACOTTAS.forEach((name, i) => def(TERRACOTTA + i, name, T_TERRACOTTA + i, T_TERRACOTTA + i, T_TERRACOTTA + i, { jit: 0.04 }));
def(GRAVEL,  'Gravel',  T_GRAVEL,    T_GRAVEL,     T_GRAVEL,   { jit: 0.05 });
def(CLAY,    'Clay',    T_CLAY,      T_CLAY,       T_CLAY,     { jit: 0.04 });
def(PODZOL,  'Podzol',  T_PODZOL_TOP, T_PODZOL_SIDE, T_DIRT);
def(COARSE_DIRT, 'Coarse Dirt', T_COARSE_DIRT, T_COARSE_DIRT, T_COARSE_DIRT);
def(MUD,     'Mud',     T_MUD,       T_MUD,        T_MUD,      { jit: 0.04 });
def(MOSS,    'Moss',    T_MOSS,      T_MOSS,       T_MOSS,     { jit: 0.08 });
def(BASALT,  'Basalt',  T_BASALT_TOP, T_BASALT,    T_BASALT_TOP, { jit: 0.05 });
def(OBSIDIAN, 'Obsidian', T_OBSIDIAN, T_OBSIDIAN,  T_OBSIDIAN, { jit: 0.03 });
def(COAL_ORE, 'Coal Ore', T_COAL_ORE, T_COAL_ORE,  T_COAL_ORE);
def(COPPER_ORE, 'Copper Ore', T_COPPER_ORE, T_COPPER_ORE, T_COPPER_ORE);
def(IRON_ORE, 'Iron Ore', T_IRON_ORE, T_IRON_ORE,  T_IRON_ORE);
def(GOLD_ORE, 'Gold Ore', T_GOLD_ORE, T_GOLD_ORE,  T_GOLD_ORE);
// Glow Crystal: lights its surroundings, and its tile is drawn at full brightness (textures.ts)
def(GLOW_CRYSTAL, 'Glow Crystal', T_GLOW_CRYSTAL, T_GLOW_CRYSTAL, T_GLOW_CRYSTAL, { lightEmission: 10, jit: 0 });

// The hotbar a new world starts with (and every world saved before save version 7 had: their slot
// numbers point at these). The block picker puts other blocks in its slots; each world keeps its own.
// Water places a source block (creative-style, until buckets come with an inventory).
export const HOTBAR = [GRASS, DIRT, STONE, SAND, LOG, PLANKS, LEAVES, BRICK, GLASS, TORCH, WATER];

/** The block picker's tabs and the blocks on each, in order: every block but air is on one */
export const PICKER: readonly { name: string; blocks: readonly number[] }[] = [
  { name: 'Natural', blocks: [GRASS, DIRT, COARSE_DIRT, PODZOL, MUD, CLAY, GRAVEL, SAND, RED_SAND, SNOW, ICE, PACKED_ICE] },
  { name: 'Stone', blocks: [STONE, SANDSTONE, BASALT, OBSIDIAN, ...TERRACOTTAS.map((_, i) => TERRACOTTA + i), COAL_ORE, COPPER_ORE,
    IRON_ORE, GOLD_ORE, BRICK, GLASS, BEDROCK] },
  { name: 'Wood', blocks: [LOG, PLANKS] },
  { name: 'Plants', blocks: [LEAVES, MOSS] },
  { name: 'Light', blocks: [TORCH, GLOW_CRYSTAL] },
  { name: 'Liquids', blocks: [WATER] },
];

// Tiles with no "up" direction get a random rotation per face, which hides tiling repetition
export const ROT = new Set([T_GRASS_TOP, T_DIRT, T_STONE, T_SAND, T_LEAVES, T_BEDROCK, T_LEAVES_CUT, T_SNOW, T_ICE, T_PACKED_ICE,
  T_SANDSTONE_TOP, T_SANDSTONE_BOTTOM, T_RED_SAND, T_GRAVEL, T_CLAY, T_PODZOL_TOP, T_COARSE_DIRT, T_MUD, T_MOSS, T_BASALT_TOP, T_OBSIDIAN,
  T_COAL_ORE, T_COPPER_ORE, T_IRON_ORE, T_GOLD_ORE, ...TERRACOTTAS.map((_, i) => T_TERRACOTTA + i)]);

/* ---------- water's block state ---------- */
/** The low 3 bits: 0 a source (full), 1–7 flowing, one step lower for each block from where it came */
export const LEVEL = 7;
/** Water falling down: full height, and it spreads like a source where it lands */
export const FALLING = 8;
/**
 * Height of a liquid block's surface above its floor, in blocks: full when it is falling or has more
 * liquid on top (`above`), else 7/8 for a source down to 7/32 at level 7.
 */
export const liquidHeight = (state: number, above = false) => (above || state & FALLING ? 1 : (28 - 3 * (state & LEVEL)) / 32);

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
/** Darkens the corners next to it (ambient occlusion): cubes that dim light — opaque blocks and leaves, not ice */
export const OCCLUDES = table((b) => b.id !== AIR && b.model === 'cube' && b.lightFilter > 0 && b.renderPass !== 'translucent');
/** Slides underfoot (see player.ts) */
export const SLIPPERY = table((b) => b.slippery);
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
