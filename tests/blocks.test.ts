import { describe, expect, it } from 'vitest';
import {
  AIR, GRASS, DIRT, STONE, SAND, LOG, PLANKS, LEAVES, BRICK, BEDROCK, WATER, GLASS, TORCH, B, HOTBAR, NT,
  SOLID, OPAQUE, PASS, MODEL, OCCLUDES, TARGETABLE, REPLACEABLE, SLIPPERY, faceHidden, PICKER, TERRACOTTAS,
  SNOW, ICE, PACKED_ICE, SANDSTONE, RED_SAND, TERRACOTTA, GRAVEL, CLAY, PODZOL, COARSE_DIRT, MUD, MOSS, BASALT, OBSIDIAN,
  COAL_ORE, COPPER_ORE, IRON_ORE, GOLD_ORE, GLOW_CRYSTAL, T_SNOW, TALL_GRASS, SEAGRASS, CACTUS, LILY_PAD, VINES, BUILD_ON, LOGGABLE,
  SUPPORT, STACKS, OFFSET, S_NONE, S_FLOOR, S_WATER, S_WALL, S_TORCH, WATERLOGGED, waterState,
  PRESENT, PRESENTS, CANDY_CANE, PINK_CANDY_CANE, GINGERBREAD, ICING, ICED_GINGERBREAD, SNOW_BRICKS, FROSTED_GLASS, PUZZLE_ICE, T_PRESENT,
} from '../src/blocks';
import { TILE_PAINTERS } from '../src/textures';

/** Plain opaque cubes */
const CUBES = [GRASS, DIRT, STONE, SAND, LOG, PLANKS, BRICK, BEDROCK];
const SEE_THROUGH = [GLASS, LEAVES, WATER, TORCH];
/** The Christmas blocks (Milestone 1a: the cubes) */
const CHRISTMAS = [...PRESENTS.map((_, i) => PRESENT + i), CANDY_CANE, PINK_CANDY_CANE, GINGERBREAD, ICING, ICED_GINGERBREAD, SNOW_BRICKS,
  FROSTED_GLASS, PUZZLE_ICE];

describe('block registry', () => {
  it('keeps every id: chunks and saves store them', () => {
    expect([AIR, GRASS, DIRT, STONE, SAND, LOG, PLANKS, LEAVES, BRICK, BEDROCK, WATER, GLASS, TORCH])
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('keeps the ids of the islands\' blocks too', () => {
    expect([SNOW, ICE, PACKED_ICE, SANDSTONE, RED_SAND, TERRACOTTA, GRAVEL, CLAY, PODZOL, COARSE_DIRT, MUD, MOSS, BASALT, OBSIDIAN,
      COAL_ORE, COPPER_ORE, IRON_ORE, GOLD_ORE, GLOW_CRYSTAL]).toEqual([13, 14, 15, 16, 17, 18, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(TERRACOTTAS.map((_, i) => B[TERRACOTTA + i].name)).toEqual(TERRACOTTAS);
    expect(TERRACOTTAS.length).toBe(6);
  });

  it('keeps the ids of the plants', () => {
    expect([TALL_GRASS, SEAGRASS, CACTUS, LILY_PAD, VINES]).toEqual([37, 38, 39, 40, 41]);
  });

  it('keeps the ids of the Christmas blocks', () => {
    expect(CHRISTMAS).toEqual([42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53]);
    expect(PRESENTS.map((_, i) => B[PRESENT + i].name)).toEqual(['Red Present', 'Green Present', 'Gold Present', 'Pink Present']);
    expect(B.length).toBe(54);
  });

  it('has a painter for every tile', () => {
    expect(TILE_PAINTERS.length).toBe(NT);
  });

  it('has every block at its own id, with valid flags and tiles', () => {
    B.forEach((b, id) => {
      expect(b.id).toBe(id);
      expect(['opaque', 'cutout', 'translucent']).toContain(b.renderPass);
      expect(['cube', 'torch', 'liquid', 'cross', 'inset', 'flat']).toContain(b.model);
      expect(b.lightEmission).toBeGreaterThanOrEqual(0);
      expect(b.lightEmission).toBeLessThanOrEqual(15);
      expect([0, 1, 2, 15]).toContain(b.lightFilter);
      for (const t of [...b.tex, b.icon, b.particle, ...(b.fastTex ?? [])]) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThan(NT);
      }
      // an opaque block is a plain cube in the opaque pass that stops all light
      if (b.opaque) expect([b.renderPass, b.model, b.lightFilter]).toEqual(['opaque', 'cube', 15]);
    });
  });

  it('describes the see-through blocks', () => {
    expect(B[GLASS]).toMatchObject({ solid: true, opaque: false, renderPass: 'cutout', lightFilter: 0, model: 'cube', cullSame: true });
    expect(B[LEAVES]).toMatchObject({ solid: true, opaque: false, renderPass: 'cutout', lightFilter: 1, model: 'cube', cullSame: false });
    expect(B[LEAVES].fastTex).toBeDefined();
    expect(B[WATER]).toMatchObject({ solid: false, opaque: false, renderPass: 'translucent', lightFilter: 2, model: 'liquid', cullSame: true });
    expect(B[TORCH]).toMatchObject({ solid: false, opaque: false, renderPass: 'cutout', lightFilter: 0, model: 'torch' });
    expect(B[TORCH].lightEmission).toBeGreaterThan(0);
  });

  it('describes the islands\' blocks: ice see-through and slippery, a glowing crystal, faces of their own', () => {
    expect(B[ICE]).toMatchObject({ solid: true, opaque: false, renderPass: 'translucent', lightFilter: 2, model: 'cube', cullSame: true, slippery: true });
    expect(B[PACKED_ICE]).toMatchObject({ solid: true, opaque: true, slippery: true });
    expect(B[GLOW_CRYSTAL]).toMatchObject({ solid: true, opaque: true, lightEmission: 10 });
    expect([STONE, SNOW, ICE, PACKED_ICE, GRASS].map((id) => SLIPPERY[id])).toEqual([0, 0, 1, 1, 0]);
    expect(new Set(B[SANDSTONE].tex).size).toBe(3);                   // top, sides and bottom
    for (const id of [BASALT, PODZOL]) expect(B[id].tex[0]).not.toBe(B[id].tex[1]);
    // each has tiles of its own (ores, terracotta colours…), and every new tile is used
    const tiles = B.filter((b) => b.id > TORCH && b.id < PRESENT).flatMap((b) => [...new Set(b.tex)]);
    expect(new Set(tiles).size).toBe(tiles.length);
    const used = new Set(B.filter((b) => b.id > TORCH).flatMap((b) => [...b.tex, b.icon]));
    expect([...used].filter((t) => t >= T_SNOW).length).toBe(NT - T_SNOW);
  });

  it('describes the Christmas blocks: cubes, frosted glass like glass, puzzle ice slippery like packed ice', () => {
    for (const id of CHRISTMAS) {
      expect(B[id].model).toBe('cube');
      expect([B[id].solid, B[id].lightEmission, B[id].support, B[id].replaceable]).toEqual([true, 0, 'none', false]);
      expect([TARGETABLE[id], BUILD_ON[id], REPLACEABLE[id]]).toEqual([1, 1, 0]);
      if (id !== FROSTED_GLASS) expect([B[id].opaque, B[id].renderPass, OCCLUDES[id]]).toEqual([true, 'opaque', 1]);
    }
    // frosted glass is glass in everything but its look
    const behaviour = (id: number) => ({ ...B[id], id: 0, name: '', tex: [0, 0, 0], icon: 0, particle: 0 });
    expect(behaviour(FROSTED_GLASS)).toEqual(behaviour(GLASS));
    expect(B[PUZZLE_ICE].slippery).toBe(true);
    expect(CHRISTMAS.filter((id) => SLIPPERY[id])).toEqual([PUZZLE_ICE]);
    // presents: a top with the bow (also the icon) and sides with the ribbon, a pair of tiles per colour
    PRESENTS.forEach((_, i) => expect([B[PRESENT + i].tex, B[PRESENT + i].icon]).toEqual([[T_PRESENT + 2 * i + 1, T_PRESENT + 2 * i, T_PRESENT + 2 * i + 1], T_PRESENT + 2 * i]));
    // gingerbread with icing: icing on top, gingerbread underneath, and sides of its own (drips)
    expect(B[ICED_GINGERBREAD].tex[1]).toBe(B[ICING].tex[1]);
    expect(B[ICED_GINGERBREAD].tex[2]).toBe(B[GINGERBREAD].tex[2]);
    expect(B.filter((b) => b.tex.includes(B[ICED_GINGERBREAD].tex[0])).map((b) => b.id)).toEqual([ICED_GINGERBREAD]);
    // the rest have one tile of their own
    for (const id of [CANDY_CANE, PINK_CANDY_CANE, GINGERBREAD, ICING, SNOW_BRICKS, FROSTED_GLASS, PUZZLE_ICE]) expect(new Set(B[id].tex).size).toBe(1);
    expect(new Set([CANDY_CANE, PINK_CANDY_CANE, GINGERBREAD, ICING, SNOW_BRICKS, FROSTED_GLASS, PUZZLE_ICE].map((id) => B[id].tex[0])).size).toBe(7);
  });

  it('puts every block but air on exactly one tab of the block picker', () => {
    expect(PICKER.map((t) => t.name)).toEqual(['Natural', 'Stone', 'Wood', 'Plants', 'Light', 'Liquids', 'Christmas']);
    const all = PICKER.flatMap((t) => [...t.blocks]);
    expect(all.slice().sort((a, b) => a - b)).toEqual(B.filter((b) => b.id !== AIR).map((b) => b.id));
  });

  it('has every Christmas block on the Christmas tab, and nothing else', () => {
    expect(PICKER.find((t) => t.name === 'Christmas')!.blocks).toEqual(CHRISTMAS);
  });

  it('keeps the first 8 hotbar slots, so slot numbers in old saves still mean the same block', () => {
    expect(HOTBAR.slice(0, 8)).toEqual([GRASS, DIRT, STONE, SAND, LOG, PLANKS, LEAVES, BRICK]);
    expect(HOTBAR.slice(8)).toEqual([GLASS, TORCH, WATER]);
  });

  it('has lookup tables that match the registry', () => {
    for (const b of B) {
      expect(SOLID[b.id]).toBe(+b.solid);
      expect(OPAQUE[b.id]).toBe(+b.opaque);
      expect(PASS[b.id]).toBe(['opaque', 'cutout', 'translucent'].indexOf(b.renderPass));
      expect(MODEL[b.id]).toBe(['cube', 'torch', 'liquid', 'cross', 'inset', 'flat'].indexOf(b.model));
      expect(SUPPORT[b.id]).toBe(['none', 'floor', 'water', 'wall', 'torch'].indexOf(b.support));
      expect([STACKS[b.id], LOGGABLE[b.id], OFFSET[b.id]]).toEqual([+b.stacks, +(b.waterlog !== 'no'), +b.offset]);
    }
    // aim at anything but air and liquids; build into air and liquids only
    expect([AIR, WATER, TORCH, GLASS, STONE].map((id) => TARGETABLE[id])).toEqual([0, 0, 1, 1, 1]);
    expect([AIR, WATER, TORCH, GLASS, STONE].map((id) => REPLACEABLE[id])).toEqual([1, 1, 0, 0, 0]);
    // ambient occlusion: opaque cubes and leaves darken corners; glass, water, ice and torches don't
    expect([STONE, LEAVES, GLASS, WATER, ICE, TORCH, AIR].map((id) => OCCLUDES[id])).toEqual([1, 1, 0, 0, 0, 0, 0]);
    expect([GLOW_CRYSTAL, ICE, OBSIDIAN].map((id) => [TARGETABLE[id], REPLACEABLE[id]])).toEqual([[1, 0], [1, 0], [1, 0]]);
  });
});

describe('plants', () => {
  const PLANTS = [TALL_GRASS, SEAGRASS, CACTUS, LILY_PAD, VINES];

  it('are models of their own, in the cutout pass (the cactus: a solid, inset column in the opaque one)', () => {
    expect(PLANTS.map((id) => B[id].model)).toEqual(['cross', 'cross', 'inset', 'flat', 'flat']);
    for (const id of PLANTS) {
      expect(B[id]).toMatchObject({ opaque: false, solid: id === CACTUS, renderPass: id === CACTUS ? 'opaque' : 'cutout' });
      expect(TARGETABLE[id]).toBe(1);                // they can be broken
      expect(OCCLUDES[id]).toBe(0);                  // no ambient occlusion round them
    }
    // seagrass filters light like the water it grows in; the others let it through
    expect(PLANTS.map((id) => B[id].lightFilter)).toEqual([0, 2, 0, 0, 0]);
    expect(B[CACTUS].hurts).toBe(true);
  });

  it('need holding up: by the ground (the cactus by more cactus too), the water under a lily pad, a wall behind vines', () => {
    expect(PLANTS.map((id) => SUPPORT[id])).toEqual([S_FLOOR, S_FLOOR, S_FLOOR, S_WATER, S_WALL]);
    expect(PLANTS.map((id) => STACKS[id])).toEqual([0, 0, 1, 0, 0]);
    expect([AIR, STONE, WATER, GLASS, LEAVES].map((id) => SUPPORT[id])).toEqual([S_NONE, S_NONE, S_NONE, S_NONE, S_NONE]);
    expect(SUPPORT[TORCH]).toBe(S_TORCH);
  });

  it('make way for building (grass, seagrass, vines), and nothing is built against them', () => {
    expect(PLANTS.map((id) => REPLACEABLE[id])).toEqual([1, 1, 0, 0, 1]);
    expect(PLANTS.map((id) => BUILD_ON[id])).toEqual([0, 0, 1, 0, 0]);
    expect([AIR, WATER, TORCH, STONE, GLASS, LEAVES].map((id) => BUILD_ON[id])).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('grow in water where they can: a waterlogged plant is a water source as well', () => {
    expect(PLANTS.map((id) => B[id].waterlog)).toEqual(['no', 'only', 'no', 'no', 'no']);
    expect(waterState(WATER, 0)).toBe(0);
    expect(waterState(WATER, 3)).toBe(3);
    expect(waterState(SEAGRASS, WATERLOGGED)).toBe(0);
    expect(waterState(SEAGRASS, 0)).toBe(-1);                  // not waterlogged
    expect(waterState(TALL_GRASS, WATERLOGGED)).toBe(-1);      // can't be
    expect(waterState(STONE, WATERLOGGED)).toBe(-1);
    expect(waterState(AIR, 0)).toBe(-1);
  });
});

describe('face culling', () => {
  it('hides any face against an opaque neighbour', () => {
    for (const self of [...CUBES, ...SEE_THROUGH]) for (const nb of CUBES) expect(faceHidden(self, nb)).toBe(true);
  });

  it('never hides a face against air', () => {
    for (const self of [...CUBES, ...SEE_THROUGH]) {
      expect(faceHidden(self, AIR)).toBe(false);
      expect(faceHidden(self, AIR, true)).toBe(false);
    }
  });

  it('hides glass–glass faces, but not glass against other see-through blocks', () => {
    expect(faceHidden(GLASS, GLASS)).toBe(true);
    for (const nb of [LEAVES, WATER, TORCH]) expect(faceHidden(GLASS, nb)).toBe(false);
    // whatever is behind glass still shows
    for (const self of [...CUBES, LEAVES, WATER]) expect(faceHidden(self, GLASS)).toBe(false);
  });

  it('keeps leaves next to leaves (fancy leaves)', () => {
    expect(faceHidden(LEAVES, LEAVES)).toBe(false);
    for (const self of [...CUBES, GLASS, WATER]) expect(faceHidden(self, LEAVES)).toBe(false);
  });

  it('treats leaves as opaque cubes with Fancy leaves off', () => {
    for (const self of [...CUBES, LEAVES, GLASS, WATER]) expect(faceHidden(self, LEAVES, true)).toBe(true);
    expect(faceHidden(LEAVES, GLASS, true)).toBe(false);
    expect(faceHidden(GLASS, GLASS, true)).toBe(true);
  });

  it('hides water–water faces, but not water against glass or leaves', () => {
    expect(faceHidden(WATER, WATER)).toBe(true);
    for (const nb of [GLASS, LEAVES, TORCH]) expect(faceHidden(WATER, nb)).toBe(false);
    expect(faceHidden(GLASS, WATER)).toBe(false);
  });

  it('hides frosted glass against frosted glass, not against glass, and never what is behind it', () => {
    expect(faceHidden(FROSTED_GLASS, FROSTED_GLASS)).toBe(true);
    expect(faceHidden(FROSTED_GLASS, GLASS)).toBe(false);
    expect(faceHidden(GLASS, FROSTED_GLASS)).toBe(false);
    for (const self of [...CUBES, LEAVES, WATER, PUZZLE_ICE]) expect(faceHidden(self, FROSTED_GLASS)).toBe(false);
    // the other Christmas blocks are opaque: they hide whatever touches them
    for (const nb of CHRISTMAS.filter((id) => id !== FROSTED_GLASS)) for (const self of [STONE, GLASS, FROSTED_GLASS, WATER]) expect(faceHidden(self, nb)).toBe(true);
  });

  it('never hides a face behind a torch', () => {
    for (const self of [...CUBES, GLASS, LEAVES, WATER]) expect(faceHidden(self, TORCH)).toBe(false);
  });
});
