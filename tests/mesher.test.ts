import { describe, expect, it } from 'vitest';
import { CI } from '../src/config';
import { STONE, GLASS, LEAVES, WATER, TORCH } from '../src/blocks';
import { PAD_VOL, PI, meshChunk } from '../src/mesher';
import { TORCH_MODELS } from '../src/torch';

/** Mesh a chunk holding just `blocks` ([lx, y, lz, id]); quads per pass: opaque, cutout, translucent. */
function quads(blocks: number[][], opaqueLeaves = false, states: number[][] = []): number[] {
  const pad = new Uint8Array(PAD_VOL);
  for (const [x, y, z, id] of blocks) pad[PI(x + 1, y, z + 1)] = id;
  let state: Uint8Array | null = null;
  if (states.length) {
    state = new Uint8Array(pad.length);
    for (const [x, y, z, s] of states) state[CI(x, y, z)] = s;
  }
  return meshChunk(pad, state, 0, 0, 1, opaqueLeaves).map((p) => (p ? p.index.length / 6 : 0));
}
const pair = (id: number) => [[4, 5, 4, id], [5, 5, 4, id]];

describe('chunk mesher', () => {
  it('draws the 6 faces of a lone block in its pass', () => {
    expect(quads([[4, 5, 4, STONE]])).toEqual([6, 0, 0]);
    expect(quads([[4, 5, 4, GLASS]])).toEqual([0, 6, 0]);
    expect(quads([[4, 5, 4, WATER]])).toEqual([0, 0, 6]);
  });

  it('skips the shared face of two glass blocks, and of two water blocks', () => {
    expect(quads(pair(GLASS))).toEqual([0, 10, 0]);
    expect(quads(pair(WATER))).toEqual([0, 0, 10]);
  });

  it('keeps the shared faces of two leaves blocks, unless leaves are meshed as opaque cubes', () => {
    expect(quads(pair(LEAVES))).toEqual([0, 12, 0]);
    expect(quads(pair(LEAVES), true)).toEqual([10, 0, 0]);
  });

  it('hides the face of glass against stone, but not the face of stone behind glass', () => {
    expect(quads([[4, 5, 4, STONE], [5, 5, 4, GLASS]])).toEqual([6, 5, 0]);
  });

  it('meshes a torch as its model in the cutout pass, whatever its facing', () => {
    const n = TORCH_MODELS[0].length;
    expect(quads([[4, 5, 4, STONE], [4, 6, 4, TORCH]])).toEqual([6, n, 0]);
    for (let s = 1; s <= 4; s++) expect(quads([[4, 5, 4, TORCH]], false, [[4, 5, 4, s]])).toEqual([0, n, 0]);
  });
});
