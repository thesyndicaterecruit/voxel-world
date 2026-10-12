/* ============================ BLOCK REGISTRY ============================ */
// Every block type and what it does: how it looks, collides, hides its neighbours' faces, lets light
// through and gets meshed. Ids are stored in chunk data and save files, so they never change; new
// blocks get new ids.

export const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5, PLANKS = 6, LEAVES = 7, BRICK = 8, BEDROCK = 9,
  WATER = 10, GLASS = 11, TORCH = 12, SNOW = 13, ICE = 14, PACKED_ICE = 15, SANDSTONE = 16, RED_SAND = 17,
  /** Terracotta in 6 colours: TERRACOTTA + 0 … 5, plain, white, orange, yellow, red, brown (the Badlands' bands) */
  TERRACOTTA = 18, GRAVEL = 24, CLAY = 25, PODZOL = 26, COARSE_DIRT = 27, MUD = 28, MOSS = 29, BASALT = 30, OBSIDIAN = 31,
  COAL_ORE = 32, COPPER_ORE = 33, IRON_ORE = 34, GOLD_ORE = 35, GLOW_CRYSTAL = 36,
  // plants and other blocks that aren't cubes (models: cross, inset, flat)
  TALL_GRASS = 37, SEAGRASS = 38, CACTUS = 39, LILY_PAD = 40, VINES = 41,
  // Christmas: the cubes
  /** Presents in 4 colours: PRESENT + 0 … 3, red, green, gold, pink */
  PRESENT = 42, CANDY_CANE = 46, PINK_CANDY_CANE = 47, GINGERBREAD = 48, ICING = 49, ICED_GINGERBREAD = 50, SNOW_BRICKS = 51,
  FROSTED_GLASS = 52, PUZZLE_ICE = 53,
  // Christmas: the decorations (models flat and cross)
  /** Baubles in 3 colours: BAUBLE + 0 … 2, pink, red, gold */
  PAW_PRINTS = 54, BAUBLE = 55, FAIRY_LIGHTS = 58, WREATH = 59, STOCKING = 60, STAR = 61;
/** The terracotta colours' names, in id order from TERRACOTTA */
export const TERRACOTTAS = ['Terracotta', 'White Terracotta', 'Orange Terracotta', 'Yellow Terracotta', 'Red Terracotta', 'Brown Terracotta'];
/** The presents' names, in id order from PRESENT */
export const PRESENTS = ['Red Present', 'Green Present', 'Gold Present', 'Pink Present'];
/** The baubles' names, in id order from BAUBLE */
export const BAUBLES = ['Pink Bauble', 'Red Bauble', 'Gold Bauble'];

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
  T_COPPER_ORE = 71, T_IRON_ORE = 72, T_GOLD_ORE = 73, T_GLOW_CRYSTAL = 74, T_TALL_GRASS = 75, T_SEAGRASS = 76, T_CACTUS_TOP = 77,
  T_CACTUS = 78, T_CACTUS_BOTTOM = 79, T_LILY_PAD = 80, T_VINES = 81,
  /** The presents' tiles, two per colour (in PRESENTS order): T_PRESENT + 2i the top (ribbon and bow), + 2i + 1 the sides */
  T_PRESENT = 82 /* … 89 */, T_CANDY_CANE = 90, T_PINK_CANDY_CANE = 91, T_GINGERBREAD = 92, T_ICING = 93, T_ICED_GINGERBREAD = 94,
  T_SNOW_BRICKS = 95, T_FROSTED_GLASS = 96, T_PUZZLE_ICE = 97,
  /** Paw prints: the prints alone (clear round them, so they sink into snow) and its icon (the prints in a square of snow) */
  T_PAW_PRINTS = 98, T_PAW_ICON = 99, T_BAUBLE = 100 /* … 102, in BAUBLES order */, T_FAIRY_LIGHTS = 103, T_WREATH = 104,
  T_STOCKING = 105, T_STAR = 106;
export const NT = 107;

/** Which mesh of a chunk a block's faces go into (see streaming.ts / textures.ts). */
export type RenderPass = 'opaque' | 'cutout' | 'translucent';
/**
 * How a block is meshed (mesher.ts): a full cube, the torch stick, a liquid (lowered top), two crossed
 * quads (plants), a cube a little smaller than its block (the cactus), or one thin quad on the floor,
 * on the water or against a wall (lily pads, vines)
 */
export type Model = 'cube' | 'torch' | 'liquid' | 'cross' | 'inset' | 'flat';
/** Model indices (MODEL): the order of Model */
export const M_CUBE = 0, M_TORCH = 1, M_LIQUID = 2, M_CROSS = 3, M_INSET = 4, M_FLAT = 5;
const MODELS: Model[] = ['cube', 'torch', 'liquid', 'cross', 'inset', 'flat'];
/**
 * What holds a block up (plants.ts): nothing; the block below (a solid cube, or more of itself if it
 * stacks); water below; a wall — the block its state faces (vines: or more vines above, facing the
 * same way); for a torch, the block its state faces (see torch.ts); or, for something that hangs
 * (baubles), a solid cube right above. Without it, it pops off.
 */
export type Support = 'none' | 'floor' | 'water' | 'wall' | 'torch' | 'hang';
const SUPPORTS: Support[] = ['none', 'floor', 'water', 'wall', 'torch', 'hang'];
export const S_NONE = 0, S_FLOOR = 1, S_WATER = 2, S_WALL = 3, S_TORCH = 4, S_HANG = 5;

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
  /** What holds it up: without it, it pops off */
  support: Support;
  /** It can stand on more of itself (the cactus) */
  stacks: boolean;
  /**
   * Water: 'no', water washes it away; 'can', it can sit inside water (WATERLOGGED: the block is
   * water too); 'only', it grows in water and nowhere else (seagrass)
   */
  waterlog: 'no' | 'can' | 'only';
  /** Building there replaces it (grass, seagrass, vines) */
  replaceable: boolean;
  /** Drawn a little off the middle of its block, differently each time (grass): see plants.ts */
  offset: boolean;
  /** Moving through it is slower: × speed (1: not at all) */
  slow: number;
  /** It would hurt to touch (the cactus): the player tells playerEvents.touch, a hook for damage */
  hurts: boolean;
  /** Placed facing the way the player looks (paw prints): a flat block on the floor whose state keeps the turn (plants.ts) */
  turns: boolean;
}

export const B: BlockType[] = [];

const def = (id: number, name: string, top: number, side: number, bot: number, o: Partial<BlockType> = {}) =>
  (B[id] = {
    id, name, tex: [side, top, bot], solid: true, opaque: true, renderPass: 'opaque', lightEmission: 0, lightFilter: 15,
    model: 'cube', cullSame: false, jit: 0.06, icon: side, particle: side, slippery: false, support: 'none', stacks: false, waterlog: 'no',
    replaceable: false, offset: false, slow: 1, hurts: false, turns: false, ...o,
  });
/** A plant: not solid, lets light through, crossed quads in the cutout pass, held up by the block below */
const plant = (id: number, name: string, tile: number, o: Partial<BlockType> = {}) =>
  def(id, name, tile, tile, tile, { solid: false, opaque: false, renderPass: 'cutout', lightFilter: 0, model: 'cross', jit: 0.1,
    support: 'floor', ...o });
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
  { solid: false, opaque: false, renderPass: 'cutout', lightEmission: 14, lightFilter: 0, model: 'torch', jit: 0, particle: T_PLANKS,
    support: 'torch' });
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
// Plants (plants.ts): crossed quads unless they say otherwise. Seagrass only grows in water (it is
// waterlogged: the water is still there); it filters light like the water round it.
plant(TALL_GRASS, 'Tall Grass', T_TALL_GRASS, { replaceable: true, offset: true });
plant(SEAGRASS, 'Seagrass', T_SEAGRASS, { waterlog: 'only', replaceable: true, lightFilter: 2 });
// the cactus: a solid column a little thinner than a block, on the ground or on more cactus; it would hurt to touch
def(CACTUS,  'Cactus',  T_CACTUS_TOP, T_CACTUS,     T_CACTUS_BOTTOM, { opaque: false, lightFilter: 0, model: 'inset', support: 'floor',
  stacks: true, hurts: true, jit: 0.04 });
// a lily pad lies on the water's surface (it floats in the block above the water); vines hang on a wall (their state faces it)
plant(LILY_PAD, 'Lily Pad', T_LILY_PAD, { model: 'flat', support: 'water', jit: 0.08 });
plant(VINES, 'Vines', T_VINES, { model: 'flat', support: 'wall', replaceable: true });
// Christmas cubes. A present's icon is its top, the bow; gingerbread with icing has icing's top, gingerbread's bottom
// and drips of icing painted down its sides.
PRESENTS.forEach((name, i) => def(PRESENT + i, name, T_PRESENT + 2 * i, T_PRESENT + 2 * i + 1, T_PRESENT + 2 * i + 1,
  { jit: 0.04, icon: T_PRESENT + 2 * i }));
def(CANDY_CANE, 'Candy Cane Block', T_CANDY_CANE, T_CANDY_CANE, T_CANDY_CANE, { jit: 0.03 });
def(PINK_CANDY_CANE, 'Pink Candy Cane Block', T_PINK_CANDY_CANE, T_PINK_CANDY_CANE, T_PINK_CANDY_CANE, { jit: 0.03 });
def(GINGERBREAD, 'Gingerbread', T_GINGERBREAD, T_GINGERBREAD, T_GINGERBREAD, { jit: 0.05 });
def(ICING,   'Icing',   T_ICING,     T_ICING,      T_ICING,    { jit: 0.02 });
def(ICED_GINGERBREAD, 'Gingerbread with Icing', T_ICING, T_ICED_GINGERBREAD, T_GINGERBREAD, { jit: 0.04 });
def(SNOW_BRICKS, 'Snow Bricks', T_SNOW_BRICKS, T_SNOW_BRICKS, T_SNOW_BRICKS, { jit: 0.03 });
// frosted glass: glass with frost grown over it (solid texels), clearer in the middle
def(FROSTED_GLASS, 'Frosted Glass', T_FROSTED_GLASS, T_FROSTED_GLASS, T_FROSTED_GLASS,
  { opaque: false, renderPass: 'cutout', lightFilter: 0, cullSame: true, jit: 0 });
// puzzle ice: the slide puzzle's floor, a square to a block; slippery like packed ice (the slide comes with the puzzle)
def(PUZZLE_ICE, 'Puzzle Ice', T_PUZZLE_ICE, T_PUZZLE_ICE, T_PUZZLE_ICE, { jit: 0.02, slippery: true });
// Christmas decorations: plants in how they're drawn and held up. Their tiles are mostly clear, so the bits that
// fly off when they break take a solid tile of their colour. The star and the fairy lights glow: drawn at full
// brightness (textures.ts), never darker in places (no jitter).
plant(PAW_PRINTS, 'Paw Prints', T_PAW_PRINTS, { model: 'flat', replaceable: true, turns: true, jit: 0.04, icon: T_PAW_ICON, particle: T_SNOW });
BAUBLES.forEach((name, i) => plant(BAUBLE + i, name, T_BAUBLE + i, { support: 'hang', jit: 0.04, particle: T_PRESENT + [7, 1, 5][i] }));
plant(FAIRY_LIGHTS, 'Fairy Lights', T_FAIRY_LIGHTS, { model: 'flat', support: 'wall', lightEmission: 8, jit: 0, particle: T_LEAVES });
plant(WREATH, 'Wreath', T_WREATH, { model: 'flat', support: 'wall', jit: 0.05, particle: T_LEAVES });
plant(STOCKING, 'Stocking', T_STOCKING, { model: 'flat', support: 'wall', jit: 0.05, particle: T_PRESENT + 1 });
plant(STAR, 'Star', T_STAR, { lightEmission: 15, jit: 0, particle: T_PRESENT + 5 });

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
  { name: 'Plants', blocks: [LEAVES, MOSS, TALL_GRASS, CACTUS, VINES, LILY_PAD, SEAGRASS] },
  { name: 'Light', blocks: [TORCH, GLOW_CRYSTAL] },
  { name: 'Liquids', blocks: [WATER] },
  { name: 'Christmas', blocks: [...PRESENTS.map((_, i) => PRESENT + i), CANDY_CANE, PINK_CANDY_CANE, GINGERBREAD, ICING, ICED_GINGERBREAD,
    SNOW_BRICKS, FROSTED_GLASS, PUZZLE_ICE, STAR, ...BAUBLES.map((_, i) => BAUBLE + i), FAIRY_LIGHTS, WREATH, STOCKING, PAW_PRINTS] },
];

// Tiles with no "up" direction get a random rotation per face, which hides tiling repetition
export const ROT = new Set([T_GRASS_TOP, T_DIRT, T_STONE, T_SAND, T_LEAVES, T_BEDROCK, T_LEAVES_CUT, T_SNOW, T_ICE, T_PACKED_ICE,
  T_SANDSTONE_TOP, T_SANDSTONE_BOTTOM, T_RED_SAND, T_GRAVEL, T_CLAY, T_PODZOL_TOP, T_COARSE_DIRT, T_MUD, T_MOSS, T_BASALT_TOP, T_OBSIDIAN,
  T_COAL_ORE, T_COPPER_ORE, T_IRON_ORE, T_GOLD_ORE, ...TERRACOTTAS.map((_, i) => T_TERRACOTTA + i), T_GINGERBREAD, T_ICING]);

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
/**
 * Block state bit: a plant sitting inside water (seagrass, kelp, coral fans). The block is water as
 * well — a source: it is drawn with the water round it, and water flows from it (waterState).
 */
export const WATERLOGGED = 0x80;

/* ---------- lookup tables for hot loops (meshing, collision), indexed by block id ---------- */
const table = (f: (b: BlockType) => boolean | number) => {
  const t = new Uint8Array(256);
  for (const b of B) if (b) t[b.id] = +f(b);
  return t;
};
export const SOLID = table((b) => b.solid);
/** Render pass index: 0 opaque, 1 cutout, 2 translucent */
export const PASS = table((b) => ['opaque', 'cutout', 'translucent'].indexOf(b.renderPass));
/** Model index (M_CUBE, M_TORCH, …) */
export const MODEL = table((b) => MODELS.indexOf(b.model));
/** What holds it up (S_NONE, S_FLOOR, …) */
export const SUPPORT = table((b) => SUPPORTS.indexOf(b.support));
/** Stands on more of itself */
export const STACKS = table((b) => b.stacks);
/** Placed facing the way the player looks (its state keeps the turn) */
export const TURNS = table((b) => b.turns);
/** Can sit inside water (WATERLOGGED) */
export const LOGGABLE = table((b) => b.waterlog !== 'no');
/** Drawn off the middle of its block (plants.ts plantOffset) */
export const OFFSET = table((b) => b.offset);
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
/** A placed block may go here (replacing it): air, liquids and the plants that make way (grass, seagrass, vines) */
export const REPLACEABLE = table((b) => b.id === AIR || b.model === 'liquid' || b.replaceable);
/** Blocks can be built against it: cubes and the cactus; not torches, plants or liquids */
export const BUILD_ON = table((b) => b.id !== AIR && (b.model === 'cube' || b.model === 'inset'));

/**
 * The water in a block: its water state (level bits, see LEVEL and FALLING) for a water block, 0 (a
 * source) for a waterlogged plant, −1 where there is no water.
 */
export const waterState = (id: number, state: number) => (id === WATER ? state : state & WATERLOGGED && LOGGABLE[id] ? 0 : -1);

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
