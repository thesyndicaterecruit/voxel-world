import { describe, expect, it } from 'vitest';
import { CS, H, W, D } from '../src/config';
import { STONE, GLASS, LEAVES, WATER, ICE, TALL_GRASS, SEAGRASS, CACTUS, LILY_PAD, VINES, TORCH, PAW_PRINTS, STAR } from '../src/blocks';
import { BIOMES, NBIOMES, FROZEN_OCEAN, TAIGA, SNOWY_PEAKS, MEADOW, DESERT, findBiome, weights } from '../src/biomes';
import { SNOW_SETTINGS, snowAmount, ceiling, columnCeiling, createCover, COVER, NO_SNOW, flakeLayout, SNOW_BOX, winterHaze,
  WINTER_HAZE, WINTER_AMOUNT, type Columns } from '../src/snow';

/** A made-up column ceiling for (x, z), the same every time */
const made = (x: number, z: number) => ((x * 7 + z * 13) & 127) ^ ((x >> 3) & 15);

/** Every column in the 64 × 64 window round (x, z): does the grid hold `column`'s ceiling there? */
function wrong(cover: ReturnType<typeof createCover>, column: (x: number, z: number) => number, x: number, z: number): number {
  const x0 = Math.floor(x) - COVER / 2, z0 = Math.floor(z) - COVER / 2;
  let bad = 0;
  for (let cz = z0; cz < z0 + COVER; cz++) for (let cx = x0; cx < x0 + COVER; cx++) if (cover.at(cx, cz) !== column(cx, cz)) bad++;
  return bad;
}

describe('snow', () => {
  it('is set Off, Auto or On: Auto snows as hard as the biomes around say', () => {
    expect(SNOW_SETTINGS).toEqual(['off', 'auto', 'on']);
    for (const here of [0, 0.4, 1]) {
      expect(snowAmount('on', here)).toBe(1);
      expect(snowAmount('off', here)).toBe(0);
      expect(snowAmount('auto', here)).toBe(here);
    }
    expect(snowAmount('auto', 1.0000001)).toBe(1);
    expect(snowAmount('auto', -0.1)).toBe(0);
  });

  it('falls only in the snowy biomes when Auto: Snowy Peaks, Taiga and Frozen Ocean', () => {
    expect(BIOMES.filter((b) => b.snowfall > 0).map((b) => b.id).sort()).toEqual([FROZEN_OCEAN, TAIGA, SNOWY_PEAKS].sort());
    for (const b of BIOMES) expect(b.snowfall >= 0 && b.snowfall <= 1, b.name).toBe(true);
    expect(BIOMES[SNOWY_PEAKS].snowfall).toBe(1);
    // as hard as the biomes around say, by weight: all of it well inside the peaks, none in the desert
    const w = new Float32Array(NBIOMES), here = (x: number, z: number) => {
      weights(4242, x, z, w);
      return BIOMES.reduce((s, b) => s + w[b.id] * b.snowfall, 0);
    };
    const peaks = findBiome(4242, SNOWY_PEAKS, 256, 256)!, desert = findBiome(4242, DESERT, 256, 256)!, meadow = findBiome(4242, MEADOW, 256, 256)!;
    expect(here(peaks[0], peaks[1])).toBeGreaterThan(0.99);
    expect(here(desert[0], desert[1])).toBe(0);
    expect(here(meadow[0], meadow[1])).toBe(0);
  });

  it('stops on top of the highest block of a column, or at the foot of a plant or torch', () => {
    // cubes, glass, leaves, water and ice: on top of them
    for (const id of [STONE, GLASS, LEAVES, WATER, ICE, CACTUS]) expect(ceiling(id, 60)).toBe(61);
    // grass, seagrass, lily pads, vines, torches, paw prints, a star: through them, to their foot
    for (const id of [TALL_GRASS, SEAGRASS, LILY_PAD, VINES, TORCH, PAW_PRINTS, STAR]) expect(ceiling(id, 60)).toBe(60);
    expect(ceiling(STONE, H - 1)).toBe(H);
    expect(ceiling(0, -1)).toBe(0);                  // an empty column: all the way down
  });

  it('reads a column\'s ceiling from the world: none where it isn\'t loaded, the sea past its edge', () => {
    const world: Columns = {
      isLoaded: (x) => x < 100,
      topY: (x, z) => (x === 5 && z === 5 ? -1 : 50 + (x & 3)),
      getBlock: (_x, y) => (y === 50 ? WATER : y === 51 ? TALL_GRASS : STONE),
    };
    expect(columnCeiling(world, 48, 8, 9)).toBe(51);      // water at 50
    expect(columnCeiling(world, 48, 9, 9)).toBe(51);      // grass at 51: its foot
    expect(columnCeiling(world, 48, 10, 9)).toBe(53);     // stone at 52
    expect(columnCeiling(world, 48, 5, 5)).toBe(0);       // empty
    expect(columnCeiling(world, 48, 200, 9)).toBe(NO_SNOW);
    for (const [x, z] of [[-1, 9], [9, -1], [W, 9], [9, D], [-40, -40]]) expect(columnCeiling(world, 48, x, z)).toBe(48);
  });

  it('keeps the ceilings round the camera: after any moves, the same as a grid made where it ends up', () => {
    let calls = 0;
    const column = (x: number, z: number) => { calls++; return made(x, z); };
    const cover = createCover(column);
    cover.recenter(200.5, 300.5);
    expect(calls).toBe(COVER * COVER);
    expect(wrong(cover, made, 200.5, 300.5)).toBe(0);
    // standing still works nothing out; a step to the next column works out one row of columns
    calls = 0;
    cover.recenter(200.9, 300.1);
    expect(calls).toBe(0);
    cover.recenter(201.2, 300.1);
    expect(calls).toBe(COVER);
    cover.recenter(202.2, 301.1);
    expect(calls).toBe(COVER * 3 - 1);
    // walks, runs, jumps and teleports, every way
    let x = 202.2, z = 301.1, s = 7;
    const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 300; i++) {
      const far = rand() < 0.05 ? 90 : rand() < 0.3 ? 20 : 2.5;
      x += (rand() - 0.5) * 2 * far; z += (rand() - 0.5) * 2 * far;
      cover.recenter(x, z);
      const fresh = createCover(made);
      fresh.recenter(x, z);
      expect(cover.data).toEqual(fresh.data);
    }
    expect(wrong(cover, made, x, z)).toBe(0);
  });

  it('updates the columns an edit or a chunk that loads changes, and only those in the window', () => {
    const top = new Map<string, number>(), at = (x: number, z: number) => top.get(`${x},${z}`) ?? made(x, z);
    let calls = 0;
    const cover = createCover((x, z) => { calls++; return at(x, z); });
    cover.recenter(100, 100);                      // the window: 68 … 131
    cover.dirty = false;
    calls = 0;
    top.set('100,101', 90);
    cover.refresh(100, 101);
    expect(cover.at(100, 101)).toBe(90);
    expect(cover.dirty).toBe(true);
    cover.refresh(20, 101);                        // outside the window: nothing
    cover.refresh(132, 100);
    expect(calls).toBe(1);
    // a chunk inside the window: its 256 columns; one on its edge: those inside; one outside: none
    calls = 0;
    for (let z = 96; z < 112; z++) for (let x = 96; x < 112; x++) top.set(`${x},${z}`, 3);
    cover.refreshChunk(6, 6);
    expect(calls).toBe(CS * CS);
    expect(cover.at(96, 96)).toBe(3);
    calls = 0;
    cover.refreshChunk(4, 6);                      // x 64 … 79: 68 … 79 are in
    expect(calls).toBe(12 * CS);
    calls = 0;
    cover.refreshChunk(9, 6);
    cover.refreshChunk(6, 1);
    expect(calls).toBe(0);
    expect(wrong(cover, at, 100, 100)).toBe(0);
  });

  it('wraps round: a column\'s cell is its x and z modulo the grid\'s size, past the world\'s edge too', () => {
    const cover = createCover(made);
    cover.recenter(3, 10);                         // the window reaches past the world's edge
    expect(cover.at(-1, -2)).toBe(made(-1, -2));
    expect(cover.data[(COVER - 1) + (COVER - 2) * COVER]).toBe(made(-1, -2));
    expect(cover.data[5 + 7 * COVER]).toBe(made(5, 7));
    expect(wrong(cover, made, 3, 10)).toBe(0);
    // a fresh grid has no snow anywhere until it is centred
    expect([...createCover(made).data].every((v) => v === NO_SNOW)).toBe(true);
  });

  it('lays the flakes out the same for a seed: in the box, each falling and swaying its own way', () => {
    const a = flakeLayout(500, 4242), b = flakeLayout(500, 4242), c = flakeLayout(500, 777);
    expect(a.pos).toEqual(b.pos);
    expect(a.flake).toEqual(b.flake);
    expect(a.pos).not.toEqual(c.pos);
    for (let i = 0; i < 500; i++) {
      for (let k = 0; k < 3; k++) expect(a.pos[i * 3 + k] >= 0 && a.pos[i * 3 + k] < SNOW_BOX[k]).toBe(true);
      const [fall, phase, sway, size] = a.flake.slice(i * 4, i * 4 + 4);
      expect(fall >= 0.9 && fall <= 1.7).toBe(true);
      expect(phase >= 0 && phase < Math.PI * 2).toBe(true);
      expect(sway >= 0.2 && sway <= 0.7).toBe(true);
      expect(size >= 0.65 && size <= 1.35).toBe(true);
    }
    // spread through the box: each eighth of it has its share
    const oct = new Array(8).fill(0);
    for (let i = 0; i < 500; i++) oct[[0, 1, 2].reduce((o, k) => o | (+(a.pos[i * 3 + k] >= SNOW_BOX[k] / 2) << k), 0)]++;
    for (const n of oct) expect(n).toBeGreaterThan(40);
  });

  it('leans the haze toward a pale, cold colour where it snows', () => {
    const winter = [(WINTER_HAZE >> 16) / 255, ((WINTER_HAZE >> 8) & 255) / 255, (WINTER_HAZE & 255) / 255];
    expect(winter[2]).toBeGreaterThan(winter[0]);  // cold: bluer than it is red
    // no snow: the haze as it was
    const desert = [0.94, 0.86, 0.69];
    expect(winterHaze(desert, 0.25, 0)).toBe(0.25);
    expect(desert).toEqual([0.94, 0.86, 0.69]);
    expect(winterHaze([0, 0, 0], 0, 0)).toBe(0);
    // snow and no haze of its own (a meadow with Snow on): winter's
    const meadow = [0, 0, 0];
    expect(winterHaze(meadow, 0, 1)).toBeCloseTo(WINTER_AMOUNT, 6);
    meadow.forEach((v, k) => expect(v).toBeCloseTo(winter[k], 6));
    // both: in between, by how much of each, and more of it
    const peaks = [0.91, 0.94, 0.97], amount = winterHaze(peaks, 0.3, 1);
    expect(amount).toBeCloseTo(0.3 + WINTER_AMOUNT, 6);
    peaks.forEach((v, k) => expect(v).toBeCloseTo((([0.91, 0.94, 0.97][k] * 0.3 + winter[k] * WINTER_AMOUNT) / amount), 6));
    expect(winterHaze([1, 1, 1], 0.95, 1)).toBe(1);
  });
});
