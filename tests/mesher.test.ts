import { describe, expect, it } from 'vitest';
import { CS, H, CHUNK_VOL, CI } from '../src/config';
import { STONE, GLASS, LEAVES, WATER, TORCH } from '../src/blocks';
import { PAD_VOL, PI, FP, meshChunk, type PassMesh } from '../src/mesher';
import { TORCH_MODELS } from '../src/torch';

/** Mesh a chunk holding just `blocks` ([lx, y, lz, id]), everything in full skylight. */
function mesh(blocks: number[][], opaqueLeaves = false, states: number[][] = [], light?: (x: number, y: number, z: number) => number) {
  const pad = new Uint8Array(PAD_VOL), lit = new Uint8Array(PAD_VOL).fill(0xf0);
  for (const [x, y, z, id] of blocks) pad[PI(x + 1, y, z + 1)] = id;
  if (light) for (let y = 0; y < H; y++) for (let z = -1; z <= CS; z++) for (let x = -1; x <= CS; x++) lit[PI(x + 1, y, z + 1)] = light(x, y, z);
  let state: Uint8Array | null = null;
  if (states.length) {
    state = new Uint8Array(CHUNK_VOL);
    for (const [x, y, z, s] of states) state[CI(x, y, z)] = s;
  }
  return meshChunk(pad, lit, state, 0, 0, 1, opaqueLeaves);
}
/** Quads per pass: opaque, cutout, translucent. */
const quads = (blocks: number[][], opaqueLeaves = false, states: number[][] = []) =>
  mesh(blocks, opaqueLeaves, states).map((p) => (p ? p.index.length / 6 : 0));
/** The [shade, skylight, block light] of every vertex of a pass whose position matches */
function vertices(m: PassMesh, at: (x: number, y: number, z: number) => boolean): number[][] {
  const out: number[][] = [];
  for (let v = 0; v < m.pos.length / 3; v++) {
    if (at(m.pos[v * 3] / FP, m.pos[v * 3 + 1] / FP, m.pos[v * 3 + 2] / FP)) out.push([m.col[v * 3], m.col[v * 3 + 1], m.col[v * 3 + 2]]);
  }
  return out;
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

describe('smooth light', () => {
  it('passes full skylight to faces under the open sky, and no block light', () => {
    for (const [, sky, blk] of vertices(mesh([[4, 5, 4, STONE]])[0]!, () => true)) expect([sky, blk]).toEqual([255, 0]);
  });

  it('averages the cells around each corner, leaving out solid ones', () => {
    // a stone floor; a torch-lit cell (block light 15) right above one corner of the middle block
    const floor: number[][] = [];
    for (let x = 3; x <= 5; x++) for (let z = 3; z <= 5; z++) floor.push([x, 5, z, STONE]);
    const m = mesh(floor, false, [], (x, y, z) => (x === 5 && y === 6 && z === 5 ? 15 : 0))[0]!;
    // the middle block's top face: corner (5, 6, 5) touches the lit cell and 3 dark ones
    const at = (cx: number, cz: number) => vertices(m, (x, y, z) => x === cx && y === 6 && z === cz).map((v) => v[2]);
    expect(at(5, 5)).toContain(Math.round((15 / 4) * 17));
    expect(at(4, 4)).toContain(0);
    // a top face against a wall: the corner by the wall averages the 3 open cells; in an inside
    // corner (both sides solid) the diagonal is hidden too, and only the face's own cell counts
    const lit = (x: number, y: number, z: number) => (x === 4 && y === 6 && z === 4 ? 12 : 0);
    const wall = mesh([[4, 5, 4, STONE], [5, 6, 4, STONE]], false, [], lit)[0]!;
    expect(vertices(wall, (x, y, z) => x === 5 && y === 6 && z === 4).map((v) => v[2])).toContain(Math.round((12 / 3) * 17));
    const nook = mesh([[4, 5, 4, STONE], [5, 6, 4, STONE], [4, 6, 5, STONE]], false, [], lit)[0]!;
    expect(vertices(nook, (x, y, z) => x === 5 && y === 6 && z === 5).map((v) => v[2])).toContain(12 * 17);
  });

  it('lights a torch by its own cell, with the flame at full', () => {
    const m = mesh([[4, 5, 4, TORCH]], false, [], () => 0x37)[1]!;   // sky 3, block 7
    const values = new Set(vertices(m, () => true).map((v) => `${v[1]},${v[2]}`));
    expect(values).toEqual(new Set([`${3 * 17},${7 * 17}`, `${3 * 17},255`]));
  });
});
