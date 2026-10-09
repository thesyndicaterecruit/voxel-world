import { describe, expect, it } from 'vitest';
import { CS, H } from '../src/config';
import { STONE, GLASS, LEAVES, WATER, TORCH, T_WATER_STILL, T_WATER_FLOW, FALLING } from '../src/blocks';
import { PAD_VOL, PI, FP, TEX, meshChunk, type PassMesh } from '../src/mesher';
import { TORCH_MODELS } from '../src/torch';

/**
 * Mesh a chunk holding just `blocks` ([lx, y, lz, id]; lx and lz may be −1 or CS for the neighbours'
 * border), with block states `states` ([lx, y, lz, state]), everything in full skylight unless
 * `light` says otherwise. The chunk is in the middle of the world unless `at` puts its origin elsewhere.
 */
function mesh(blocks: number[][], opaqueLeaves = false, states: number[][] = [], light?: (x: number, y: number, z: number) => number,
  at = [256, 256], seaLevel = 48) {
  const pad = new Uint8Array(PAD_VOL), lit = new Uint8Array(PAD_VOL).fill(0xf0);
  for (const [x, y, z, id] of blocks) pad[PI(x + 1, y, z + 1)] = id;
  if (light) for (let y = 0; y < H; y++) for (let z = -1; z <= CS; z++) for (let x = -1; x <= CS; x++) lit[PI(x + 1, y, z + 1)] = light(x, y, z);
  let state: Uint8Array | null = null;
  if (states.length) {
    state = new Uint8Array(PAD_VOL);
    for (const [x, y, z, s] of states) state[PI(x + 1, y, z + 1)] = s;
  }
  return meshChunk(pad, lit, state, at[0], at[1], 1, opaqueLeaves, seaLevel);
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

/** Every vertex of a pass as [x, y, z, u, v, layer] (blocks, texels) */
function verts(m: PassMesh): number[][] {
  const out: number[][] = [];
  for (let v = 0; v < m.pos.length / 3; v++) out.push([m.pos[v * 3] / FP, m.pos[v * 3 + 1] / FP, m.pos[v * 3 + 2] / FP, m.uv[v * 2], m.uv[v * 2 + 1], m.layer[v]]);
  return out;
}
const near = (a: number, b: number) => Math.abs(a - b) <= 1 / FP;

describe('water', () => {
  it('has a lowered surface whose corners dip toward open air, and full height under more water', () => {
    // a lone source: each top corner averages it (counting 10 times) with 3 open cells
    const lone = verts(mesh([[4, 5, 4, WATER]])[2]!).filter((v) => v[1] > 5);
    expect(lone.length).toBeGreaterThan(0);
    for (const v of lone) expect(near(v[1], 5 + (0.875 * 10) / 13)).toBe(true);
    // water on water: the lower block's sides reach the top, it has no top face
    const stack = verts(mesh([[4, 5, 4, WATER], [4, 6, 4, WATER]])[2]!);
    expect(stack.some((v) => near(v[1], 6) && v[5] === T_WATER_FLOW)).toBe(true);
    expect(quads([[4, 5, 4, WATER], [4, 6, 4, WATER]])).toEqual([0, 0, 10]);
  });

  it('slopes down along flowing water, sharing its corners with the next block, streaks turned downhill', () => {
    // a channel walled in by stone: a source, then levels 1 and 2 running toward +x
    const blocks: number[][] = [], states: number[][] = [];
    for (let x = 4; x <= 6; x++) {
      blocks.push([x, 5, 4, WATER], [x, 4, 4, STONE], [x, 5, 3, STONE], [x, 5, 5, STONE]);
      states.push([x, 5, 4, x - 4]);
    }
    for (const x of [3, 7]) blocks.push([x, 5, 3, STONE], [x, 5, 4, STONE], [x, 5, 5, STONE]);
    const top = verts(mesh(blocks, false, states)[2]!).filter((v) => v[1] > 5.01);
    const at = (x: number) => [...new Set(top.filter((v) => v[0] === x).map((v) => v[1]))];
    // one height per edge across the channel (shared by both blocks), dropping toward +x
    for (const x of [4, 5, 6, 7]) expect(at(x).length).toBe(1);
    expect(at(4)[0]).toBeGreaterThan(at(5)[0]);
    expect(at(5)[0]).toBeGreaterThan(at(6)[0]);
    expect(at(6)[0]).toBeGreaterThan(at(7)[0]);
    // the sloping tops use the flowing tile, turned so its streaks (toward −v) run toward +x: in each
    // face, v is TEX on its upstream edge and 0 downstream
    const all = verts(mesh(blocks, false, states)[2]!), faces = [];
    for (let i = 0; i < all.length; i += 4) faces.push(all.slice(i, i + 4));
    const slopes = faces.filter((f) => f.every((v) => v[1] > 5.01 && v[0] >= 5 && v[0] <= 7));
    expect(slopes.length).toBe(2);
    for (const f of slopes) {
      const x0 = Math.min(...f.map((v) => v[0]));
      expect(f.every((v) => v[5] === T_WATER_FLOW)).toBe(true);
      for (const v of f) expect(v[4]).toBe(v[0] === x0 ? TEX : 0);
    }
  });

  it('is full height where it falls', () => {
    const top = verts(mesh([[4, 5, 4, WATER]], false, [[4, 5, 4, FALLING]])[2]!).filter((v) => v[1] > 5);
    for (const v of top) expect(v[1]).toBeGreaterThan(5.5);
  });

  it('merges a flat, evenly lit sea surface into quads of up to 7 × 7 blocks, the texture repeating', () => {
    // a whole layer of still water (the neighbours' border too) over stone
    const blocks: number[][] = [];
    for (let z = -1; z <= CS; z++) for (let x = -1; x <= CS; x++) blocks.push([x, 5, z, WATER], [x, 4, z, STONE]);
    const m = mesh(blocks)[2]!;
    expect(m.index.length / 6).toBe(9);                 // 16 = 7 + 7 + 2 each way
    const vs = verts(m);
    expect(Math.max(...vs.map((v) => v[3]))).toBe(7 * TEX);
    for (const v of vs) {
      expect(near(v[1], 5.875)).toBe(true);
      expect(v[5]).toBe(T_WATER_STILL);
    }
  });

  it('draws no faces toward the world\'s edge below sea level: the sea goes on', () => {
    expect(quads([[4, 5, 4, WATER]])).toEqual([0, 0, 6]);
    const edge = mesh([[0, 5, 4, WATER]], false, [], undefined, [0, 256]);
    expect(edge.map((p) => (p ? p.index.length / 6 : 0))).toEqual([0, 0, 5]);
    // above sea level (water the player put there) it has its side
    const high = mesh([[0, 60, 4, WATER]], false, [], undefined, [0, 256]);
    expect(high.map((p) => (p ? p.index.length / 6 : 0))).toEqual([0, 0, 6]);
  });
});
