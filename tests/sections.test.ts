import { describe, expect, it } from 'vitest';
import { CS, H, SH, NSEC, CHUNK_VOL, CI } from '../src/config';
import { AIR, STONE, WATER, TORCH, GLASS, LEAVES, FALLING } from '../src/blocks';
import { PAD_VOL, PI, meshChunk, meshSection, mergeMeshes, spliceSections, noSections, type PassMesh } from '../src/mesher';
import { lightChunk, computeLight } from '../src/light';
import { World, sectionCounts, sectionTop } from '../src/world';
import { createWater } from '../src/water';

/** A padded chunk (PI layout) holding `blocks` ([lx, y, lz, id]), all in full skylight */
function padded(blocks: number[][]) {
  const pad = new Uint8Array(PAD_VOL), light = new Uint8Array(PAD_VOL).fill(0xf0);
  for (const [x, y, z, id] of blocks) pad[PI(x + 1, y, z + 1)] = id;
  return { pad, light };
}
const quads = (m: (PassMesh | null)[]) => m.map((p) => (p ? p.index.length / 6 : 0));

describe('sections', () => {
  it('are meshed separately, and a column through their borders has no faces inside it', () => {
    // a stone pillar from y = 10 to 40, through the borders at 16 and 32
    const col: number[][] = [];
    for (let y = 10; y <= 40; y++) col.push([5, y, 5, STONE]);
    const { pad, light } = padded(col);
    expect(quads(meshChunk(pad, light, null, 256, 256, 1))).toEqual([31 * 4 + 2, 0, 0]);
    // sections 0, 1, 2 have parts of it; the rest have nothing
    const per = Array.from({ length: NSEC }, (_, sy) => quads(meshSection(pad, light, null, 256, 256, sy, 1))[0]);
    expect(per).toEqual([6 * 4 + 1, 16 * 4, 9 * 4 + 1, 0, 0, 0, 0, 0]);
  });

  it('put together are the whole chunk, and one can be swapped for its new mesh', () => {
    const blocks: number[][] = [[3, 5, 3, STONE], [3, 15, 3, GLASS], [3, 16, 3, STONE], [8, 30, 8, LEAVES], [9, 47, 2, STONE], [9, 48, 2, WATER]];
    const { pad, light } = padded(blocks);
    const secs = Array.from({ length: NSEC }, (_, sy) => meshSection(pad, light, null, 256, 256, sy, 1));
    let opaque = spliceSections(noSections(), secs.map((m) => m[0]));
    expect(opaque.mesh).toEqual(mergeMeshes(secs.map((m) => m[0])));
    expect(opaque.mesh).toEqual(meshChunk(pad, light, null, 256, 256, 1)[0]);
    // a block added in section 1 (next to the one there): re-mesh that section only and swap it in
    pad[PI(5, 20, 4)] = STONE;
    const parts: (PassMesh | null | undefined)[] = [];
    parts[1] = meshSection(pad, light, null, 256, 256, 1, 1)[0];
    opaque = spliceSections(opaque, parts);
    expect(opaque.mesh).toEqual(meshChunk(pad, light, null, 256, 256, 1)[0]);
    // and taken out again: back to what it was
    pad[PI(5, 20, 4)] = AIR;
    parts[1] = meshSection(pad, light, null, 256, 256, 1, 1)[0];
    expect(spliceSections(opaque, parts).mesh).toEqual(mergeMeshes(secs.map((m) => m[0])));
    // a section with nothing left in it: no mesh at all for it
    expect(spliceSections(noSections(), [null, null]).mesh).toBeNull();
  });

  it('are counted as blocks come and go, and the empty ones above the ground cost nothing to find', () => {
    const w = new World(), data = new Uint8Array(CHUNK_VOL);
    for (let i = 0; i < CS * CS * 20; i++) data[i] = STONE;
    const c = w.setChunk(0, 0, data);
    expect(Array.from(c.count)).toEqual([256 * 16, 256 * 4, 0, 0, 0, 0, 0, 0]);
    expect(sectionTop(c.count)).toBe(2 * SH);
    w.setBlock(3, 100, 3, STONE);
    w.setBlock(3, 5, 3, AIR);
    w.setBlock(3, 5, 3, AIR);                                   // again: no change
    expect(Array.from(c.count)).toEqual([256 * 16 - 1, 256 * 4, 0, 0, 0, 0, 1, 0]);
    expect(Array.from(sectionCounts(c.data))).toEqual(Array.from(c.count));
    expect(w.topY(3, 3)).toBe(100);
    expect(w.topY(4, 3)).toBe(19);
    expect(w.count()).toBe(256 * 20);
  });
});

describe('light in the taller world', () => {
  it('is worked out only up to 16 blocks above the highest block, and comes out the same as all the way up', () => {
    // 3×3 chunks: hills of different heights, a tall tower with a torch on top, a cave with a torch
    const blocks9 = new Uint8Array(9 * CHUNK_VOL);
    for (let k = 0; k < 9; k++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const h = 20 + ((k * 7 + x * 3 + z * 5) % 11);
      for (let y = 0; y < h; y++) blocks9[k * CHUNK_VOL + CI(x, y, z)] = STONE;
    }
    for (let y = 30; y < 90; y++) blocks9[4 * CHUNK_VOL + CI(8, y, 8)] = STONE;
    blocks9[4 * CHUNK_VOL + CI(8, 90, 8)] = TORCH;
    for (let x = 2; x < 14; x++) blocks9[1 * CHUNK_VOL + CI(x, 12, 6)] = AIR;
    blocks9[1 * CHUNK_VOL + CI(7, 12, 6)] = TORCH;
    const full = lightChunk(blocks9, 0b111111111);
    // the same blocks, sent only up to the highest block + 16 (y < 107) as the streamer does
    const height = 91 + 16, n = height * CS * CS, low = new Uint8Array(9 * n);
    for (let k = 0; k < 9; k++) low.set(blocks9.subarray(k * CHUNK_VOL, k * CHUNK_VOL + n), k * n);
    expect(lightChunk(low, 0b111111111, height)).toEqual(full);
    expect(full[CI(8, 105, 8)]).toBe(0xf0);                     // open sky, out of the torch's reach
    expect(full[CI(8, 91, 8)] & 15).toBe(13);                   // the torch's light, a block above it
    // and the same as lighting the whole box
    const box = new Uint8Array(CS * 3 * CS * 3 * H);
    for (let k = 0; k < 9; k++) for (let y = 0; y < H; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      box[(k % 3) * CS + x + CS * 3 * (((k / 3) | 0) * CS + z + CS * 3 * y)] = blocks9[k * CHUNK_VOL + CI(x, y, z)];
    }
    const all = computeLight(box, CS * 3, CS * 3);
    for (let y = 0; y < H; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      if (full[CI(x, y, z)] !== all[CS + x + CS * 3 * (CS + z + CS * 3 * y)]) throw new Error(`differs at ${x},${y},${z}`);
    }
  });
});

describe('water across section borders', () => {
  it('falls from high up through several sections and spreads where it lands', () => {
    const w = new World();
    for (let cz = 15; cz <= 17; cz++) for (let cx = 15; cx <= 17; cx++) {
      const d = new Uint8Array(CHUNK_VOL);
      for (let i = 0; i < CI(0, 10, 0); i++) d[i] = STONE;           // the ground at y = 10
      w.setChunk(cx, cz, d);
    }
    const water = createWater(w);
    w.onChange = (x, y, z, old) => water.blockChanged(x, y, z, old);
    w.setBlock(264, 70, 264, WATER);                                  // a source in section 4
    for (let i = 0; i < 80; i++) water.tick();
    for (let y = 10; y < 70; y++) {
      expect(w.getBlock(264, y, 264)).toBe(WATER);
      expect(w.getState(264, y, 264) & FALLING).toBe(FALLING);
    }
    expect([w.getState(265, 10, 264), w.getState(264, 10, 261)]).toEqual([1, 3]);
    expect(w.getBlock(265, 11, 264)).toBe(AIR);
  });
});
