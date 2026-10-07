export const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5, PLANKS = 6, LEAVES = 7, BRICK = 8, BEDROCK = 9;

// Texture tiles (painted procedurally in textures.ts — no image files).
// The order must match TILE_PAINTERS in textures.ts.
export const T_GRASS_TOP = 0, T_GRASS_SIDE = 1, T_DIRT = 2, T_STONE = 3, T_SAND = 4, T_LOG_SIDE = 5, T_LOG_TOP = 6,
  T_PLANKS = 7, T_LEAVES = 8, T_BRICK = 9, T_BEDROCK = 10, NT = 11;

export interface BlockDef {
  name: string;
  /** Tile per face kind: [side, top, bottom] */
  t: [number, number, number];
  /** Subtle per-block brightness variation */
  jit: number;
}

export const B: BlockDef[] = [];
const def = (id: number, name: string, top: number, side: number, bot: number, jit: number) =>
  (B[id] = { name, t: [side, top, bot], jit });
def(GRASS,   'Grass',   T_GRASS_TOP, T_GRASS_SIDE, T_DIRT,     0.06);
def(DIRT,    'Dirt',    T_DIRT,      T_DIRT,       T_DIRT,     0.06);
def(STONE,   'Stone',   T_STONE,     T_STONE,      T_STONE,    0.06);
def(SAND,    'Sand',    T_SAND,      T_SAND,       T_SAND,     0.04);
def(LOG,     'Log',     T_LOG_TOP,   T_LOG_SIDE,   T_LOG_TOP,  0.05);
def(PLANKS,  'Planks',  T_PLANKS,    T_PLANKS,     T_PLANKS,   0.06);
def(LEAVES,  'Leaves',  T_LEAVES,    T_LEAVES,     T_LEAVES,   0.12);
def(BRICK,   'Brick',   T_BRICK,     T_BRICK,      T_BRICK,    0.05);
def(BEDROCK, 'Bedrock', T_BEDROCK,   T_BEDROCK,    T_BEDROCK,  0.1);

export const HOTBAR = [GRASS, DIRT, STONE, SAND, LOG, PLANKS, LEAVES, BRICK];

// Tiles with no "up" direction get a random rotation per face, which hides tiling repetition
export const ROT = new Set([T_GRASS_TOP, T_DIRT, T_STONE, T_SAND, T_LEAVES, T_BEDROCK]);
