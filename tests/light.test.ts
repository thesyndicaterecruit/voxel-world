import { describe, expect, it } from 'vitest';
import { CS, H, CHUNK_VOL, CI } from '../src/config';
import { AIR, STONE, GLASS, LEAVES, WATER, TORCH, PLANKS } from '../src/blocks';
import { computeLight, lightChunk, relight, relightMany, skyOf, blockOf, cellKey, keyX, type LightWorld } from '../src/light';

/** The test worlds are low: everything happens below y = LOW (above, light is open sky), unless a test says otherwise */
const LOW = 48;

/** A small world of chunks: SX × SZ full-height columns (multiples of CS), nothing around it; compared below `TOP` */
function testWorld(SX: number, SZ: number, TOP = LOW) {
  const NX = SX / CS, NZ = SZ / CS;
  const chunks = Array.from({ length: NX * NZ }, () => ({ data: new Uint8Array(CHUNK_VOL), light: new Uint8Array(CHUNK_VOL) as Uint8Array | null }));
  const w: LightWorld = { chunk: (cx, cz) => (cx >= 0 && cx < NX && cz >= 0 && cz < NZ ? chunks[cx + cz * NX] : undefined) };
  const chunk = (x: number, z: number) => chunks[(x >> 4) + (z >> 4) * NX];
  const ci = (x: number, y: number, z: number) => CI(x & (CS - 1), y, z & (CS - 1));
  /** All blocks below TOP as one box (x + SX·(z + SZ·y)), the way computeLight takes them */
  const flat = () => {
    const out = new Uint8Array(SX * SZ * TOP);
    for (let y = 0; y < TOP; y++) for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) out[x + SX * (z + SZ * y)] = chunk(x, z).data[ci(x, y, z)];
    return out;
  };
  /** All light below TOP as one box */
  const light = () => {
    const out = new Uint8Array(SX * SZ * TOP);
    for (let y = 0; y < TOP; y++) for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) out[x + SX * (z + SZ * y)] = chunk(x, z).light![ci(x, y, z)];
    return out;
  };
  const lv = (x: number, y: number, z: number) => chunk(x, z).light![ci(x, y, z)];
  return {
    w, flat, light,
    block: (x: number, y: number, z: number) => chunk(x, z).data[ci(x, y, z)],
    /** Place without updating light (building the scene) */
    put(x: number, y: number, z: number, id: number) { chunk(x, z).data[ci(x, y, z)] = id; },
    fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number) {
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) chunk(x, z).data[ci(x, y, z)] = id;
    },
    /** Light everything from scratch */
    lightAll() {
      const L = computeLight(flat(), SX, SZ);
      for (let y = 0; y < H; y++) for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) chunk(x, z).light![ci(x, y, z)] = L[x + SX * (z + SZ * y)];
    },
    /** Change a block the way the game does, then relight incrementally; returns the changed cells */
    edit(x: number, y: number, z: number, id: number) {
      const c = chunk(x, z), old = c.data[ci(x, y, z)];
      c.data[ci(x, y, z)] = id;
      return relight(w, x, y, z, old, id);
    },
    /** Change several blocks ([x, y, z, id] each), then relight them in one go; returns the changed cells */
    editMany(list: number[][]) {
      const edits: number[] = [];
      for (const [x, y, z, id] of list) {
        const c = chunk(x, z), i = ci(x, y, z);
        edits.push(x, y, z, c.data[i], id);
        c.data[i] = id;
      }
      // a block changed twice counts from what it was first to what it is now
      for (let e = 0; e < edits.length; e += 5) edits[e + 4] = chunk(edits[e], edits[e + 2]).data[ci(edits[e], edits[e + 1], edits[e + 2])];
      return relightMany(w, edits);
    },
    sky: (x: number, y: number, z: number) => skyOf(lv(x, y, z)),
    blk: (x: number, y: number, z: number) => blockOf(lv(x, y, z)),
    /** The light below TOP as a fresh computation would have it (same layout as light()) */
    fresh: () => computeLight(flat(), SX, SZ).subarray(0, SX * SZ * TOP),
  };
}

/** Stone up to y = 9 (the ground at y = 10), open sky above */
function ground(SX = 32, SZ = 32) {
  const t = testWorld(SX, SZ);
  t.fill(0, 0, 0, SX - 1, 9, SZ - 1, STONE);
  return t;
}
/** A closed stone room (inside x 4–12, y 10–14, z 4–12) on the ground */
function room() {
  const t = ground();
  t.fill(3, 10, 3, 13, 15, 13, STONE);
  t.fill(4, 10, 4, 12, 14, 12, AIR);
  t.lightAll();
  return t;
}

describe('skylight', () => {
  it('is 15 from the sky down to the ground, and 0 inside solid blocks', () => {
    const t = ground();
    t.lightAll();
    for (const y of [H - 1, 30, 10]) expect(t.sky(5, y, 5)).toBe(15);
    expect(t.sky(5, 9, 5)).toBe(0);
    expect(t.blk(5, 20, 5)).toBe(0);
  });

  it('loses each block’s filter going down: leaves 1, water 2, glass nothing', () => {
    const t = ground();
    t.put(5, 20, 5, LEAVES); t.put(5, 19, 5, LEAVES);
    t.put(8, 20, 8, GLASS);
    for (let y = 10; y <= 14; y++) t.put(12, y, 12, WATER);
    // walls of stone around each column, so only straight-down light reaches below
    for (const [cx, cz, top] of [[5, 5, 20], [8, 8, 20], [12, 12, 14]]) {
      for (let y = 10; y <= top; y++) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) t.put(cx + dx, y, cz + dz, STONE);
    }
    t.lightAll();
    expect([t.sky(5, 20, 5), t.sky(5, 19, 5), t.sky(5, 18, 5), t.sky(5, 10, 5)]).toEqual([14, 13, 13, 13]);
    expect([t.sky(8, 20, 8), t.sky(8, 10, 8)]).toEqual([15, 15]);
    expect([14, 13, 12, 11, 10].map((y) => t.sky(12, y, 12))).toEqual([13, 11, 9, 7, 5]);
  });

  it('spreads sideways under a roof, one level per block', () => {
    const t = ground();
    t.fill(0, 14, 0, 11, 14, 23, STONE);            // a roof over x 0–11; open sky from x = 12
    t.lightAll();
    expect([12, 11, 10, 9, 5].map((x) => t.sky(x, 12, 6))).toEqual([15, 14, 13, 12, 8]);
  });

  it('pours in when a roof is opened, and goes again when it is closed', () => {
    const t = room();
    expect(t.sky(8, 12, 8)).toBe(0);
    const changed = t.edit(8, 15, 8, AIR);
    expect(t.light()).toEqual(t.fresh());
    expect([14, 12, 10].map((y) => t.sky(8, y, 8))).toEqual([15, 15, 15]);
    expect(t.sky(9, 12, 8)).toBe(14);
    expect(t.sky(4, 10, 4)).toBe(15 - 8);              // 4 + 4 steps from the shaft
    expect(changed.length).toBeGreaterThan(50);
    t.edit(8, 15, 8, STONE);
    expect(t.light()).toEqual(t.fresh());
    expect(t.sky(8, 12, 8)).toBe(0);
  });
});

describe('block light', () => {
  it('comes from a torch: 14 there, one less per block, stopped by stone', () => {
    const t = room();
    t.edit(8, 10, 8, TORCH);
    expect(t.light()).toEqual(t.fresh());
    expect([t.blk(8, 10, 8), t.blk(9, 10, 8), t.blk(9, 11, 9), t.blk(12, 14, 12)]).toEqual([14, 13, 11, 14 - 12]);
    expect(t.blk(8, 9, 8)).toBe(0);                     // in the floor
    expect(t.blk(2, 12, 8)).toBe(0);                    // outside the wall
  });

  it('goes back to darkness when the torch is removed', () => {
    const t = room();
    t.edit(8, 10, 8, TORCH);
    const changed = t.edit(8, 10, 8, AIR);
    expect(t.light()).toEqual(t.fresh());
    for (let y = 10; y <= 14; y++) for (let z = 4; z <= 12; z++) for (let x = 4; x <= 12; x++) expect(t.blk(x, y, z)).toBe(0);
    expect(changed.length).toBeGreaterThan(300);
  });

  it('is cut off by a block placed next to the torch, and comes back around it', () => {
    const t = room();
    t.edit(5, 10, 8, TORCH);
    t.fill(6, 10, 4, 6, 14, 12, STONE);               // a wall beside the torch...
    t.lightAll();
    expect(t.blk(7, 10, 8)).toBe(0);
    t.edit(6, 14, 8, AIR);                             // ...with a hole at the top
    expect(t.light()).toEqual(t.fresh());
    expect(t.blk(7, 14, 8)).toBe(14 - 6);
    t.edit(6, 14, 8, PLANKS);
    expect(t.light()).toEqual(t.fresh());
    expect(t.blk(7, 14, 8)).toBe(0);
  });

  it('is filtered like skylight: −1 into air, glass and leaves, −2 into water', () => {
    const t = room();
    t.put(9, 10, 8, GLASS); t.put(10, 10, 8, LEAVES); t.put(11, 10, 8, WATER);
    t.fill(8, 11, 4, 12, 14, 12, STONE);               // keep it to one row
    t.fill(8, 10, 4, 12, 10, 7, STONE); t.fill(8, 10, 9, 12, 10, 12, STONE);
    t.lightAll();
    t.edit(8, 10, 8, TORCH);
    expect(t.light()).toEqual(t.fresh());
    expect([8, 9, 10, 11, 12].map((x) => t.blk(x, 10, 8))).toEqual([14, 13, 12, 10, 9]);
  });
});

describe('light across chunk borders', () => {
  it('lights a chunk from a torch in its neighbour, worked out from the 3×3 chunks around it', () => {
    // 3×3 chunks of stone with a tunnel running along x through the middle row, and a torch in it
    // near the east edge of the west chunk
    const S = CS * 3, t = testWorld(S, S);
    t.fill(0, 0, 0, S - 1, 30, S - 1, STONE);
    t.fill(0, 10, CS + 4, S - 1, 12, CS + 8, AIR);
    t.put(CS - 2, 10, CS + 6, TORCH);                   // 2 blocks before the centre chunk
    t.lightAll();
    // the same 9 chunks as a worker gets them (CI layout, chunk k at dx = k % 3 − 1, dz = ⌊k/3⌋ − 1)
    const blocks9 = new Uint8Array(9 * CHUNK_VOL);
    for (let k = 0; k < 9; k++) for (let y = 0; y < H; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      blocks9[k * CHUNK_VOL + CI(x, y, z)] = t.block((k % 3) * CS + x, y, ((k / 3) | 0) * CS + z);
    }
    const centre = lightChunk(blocks9, 0b111111111), all = t.light();
    for (let y = 0; y < H; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      expect(centre[CI(x, y, z)]).toBe(y < LOW ? all[CS + x + S * (CS + z + S * y)] : 0xf0);
    }
    expect(blockOf(centre[CI(0, 10, 6)])).toBe(12);     // 2 blocks past the border
    expect(blockOf(centre[CI(11, 10, 6)])).toBe(1);
    expect(blockOf(centre[CI(12, 10, 6)])).toBe(0);
  });

  it('keeps updating across the border when a block changes', () => {
    const S = CS * 3, t = testWorld(S, S);
    t.fill(0, 0, 0, S - 1, 30, S - 1, STONE);
    t.fill(0, 10, 10, S - 1, 12, 14, AIR);
    t.lightAll();
    const changed = t.edit(CS - 1, 11, 12, TORCH);      // right at the border
    expect(t.light()).toEqual(t.fresh());
    expect(t.blk(CS + 5, 11, 12)).toBe(14 - 6);
    expect(new Set(changed.map((k) => keyX(k) >> 4))).toEqual(new Set([0, 1]));
    t.edit(CS - 1, 11, 12, AIR);
    expect(t.light()).toEqual(t.fresh());
    expect(t.blk(CS + 5, 11, 12)).toBe(0);
  });

  it('treats missing chunks (beyond the world edge) as walls', () => {
    // all stone; a tunnel in the centre chunk continues into the west chunk, up a shaft to the sky
    const blocks9 = new Uint8Array(9 * CHUNK_VOL).fill(STONE), at = (k: number, x: number, y: number, z: number) => k * CHUNK_VOL + CI(x, y, z);
    for (let x = 0; x < CS; x++) blocks9[at(4, x, 10, 8)] = AIR;
    for (let x = 12; x < CS; x++) blocks9[at(3, x, 10, 8)] = AIR;
    for (let y = 11; y < H; y++) blocks9[at(3, 12, y, 8)] = AIR;
    const lit = lightChunk(blocks9, 0b111111111), cut = lightChunk(blocks9, 0b111111111 & ~(1 << 3));
    expect(skyOf(lit[CI(0, 10, 8)])).toBe(15 - 4);     // down the shaft at 15, then 4 blocks along
    expect(skyOf(cut[CI(0, 10, 8)])).toBe(0);
  });
});

describe('incremental updates match a fresh computation', () => {
  it('high up in the taller world: a tower, a torch on top, a shaft down it', () => {
    const t = testWorld(32, 32, H);
    t.fill(0, 0, 0, 31, 9, 31, STONE);
    t.fill(12, 10, 12, 18, 95, 18, STONE);
    t.lightAll();
    const check = (what: string) => {
      const fresh = t.fresh(), now = t.light();
      if (!fresh.every((v, i) => v === now[i])) {
        const i = fresh.findIndex((v, j) => v !== now[j]);
        throw new Error(`${what}: cell ${i % 32},${Math.floor(i / 1024)},${Math.floor(i / 32) % 32} is ${now[i].toString(16)}, should be ${fresh[i].toString(16)}`);
      }
    };
    t.edit(15, 96, 15, TORCH); check('torch on top');
    expect(t.blk(15, 109, 15)).toBe(1);
    t.edit(15, 100, 15, STONE); check('a block over it');
    for (let y = 95; y >= 40; y--) { t.edit(15, y, 16, AIR); }
    check('a shaft dug down the tower');
    expect(t.sky(15, 40, 16)).toBe(15);                         // the sky straight down it
    t.edit(15, 112, 16, GLASS); t.edit(15, 112, 16, STONE); check('a roof far above it');
    expect(t.sky(15, 40, 16)).toBe(14);                         // in beside the roof, then straight down
  });

  it('after every one of many random edits', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ids = [AIR, AIR, AIR, STONE, STONE, TORCH, GLASS, LEAVES, WATER, PLANKS];
    const t = ground(32, 32);
    // some rooms and overhangs to make it interesting
    for (let k = 0; k < 40; k++) {
      const x = Math.floor(rand() * 30), z = Math.floor(rand() * 30), y = 10 + Math.floor(rand() * 8);
      t.fill(x, y, z, x + 2, y, z + 2, STONE);
    }
    t.lightAll();
    for (let k = 0; k < 400; k++) {
      const x = Math.floor(rand() * 32), z = Math.floor(rand() * 32), y = 6 + Math.floor(rand() * 16);
      const before = t.light().slice(), changed = t.edit(x, y, z, ids[Math.floor(rand() * ids.length)]);
      const fresh = t.fresh(), now = t.light();
      if (!fresh.every((v, i) => v === now[i])) {
        const i = fresh.findIndex((v, j) => v !== now[j]);
        throw new Error(`edit ${k} at ${x},${y},${z}: cell ${i % 32},${Math.floor(i / 1024)},${Math.floor(i / 32) % 32} is ${now[i].toString(16)}, should be ${fresh[i].toString(16)}`);
      }
      // it reports exactly the cells whose light changed
      const diff: number[] = [];
      now.forEach((v, i) => { if (v !== before[i]) diff.push(cellKey(i % 32, Math.floor(i / 1024), Math.floor(i / 32) % 32)); });
      expect(changed.slice().sort((a, b) => a - b)).toEqual(diff.sort((a, b) => a - b));
    }
  });

  it('after every batch of many random edits relit together (water spreading, a wall going up)', () => {
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ids = [AIR, AIR, STONE, TORCH, GLASS, LEAVES, WATER, WATER, PLANKS];
    const t = ground(48, 32);
    for (let k = 0; k < 40; k++) {
      const x = Math.floor(rand() * 46), z = Math.floor(rand() * 30), y = 10 + Math.floor(rand() * 8);
      t.fill(x, y, z, x + 2, y, z + 2, STONE);
    }
    t.lightAll();
    for (let k = 0; k < 120; k++) {
      // up to 30 edits, either clustered (like flowing water) or anywhere, some cells twice
      const n = 1 + Math.floor(rand() * 30), cx = Math.floor(rand() * 48), cz = Math.floor(rand() * 32), near = rand() < 0.6, list: number[][] = [];
      for (let j = 0; j < n; j++) {
        const x = near ? Math.min(47, Math.max(0, cx + Math.floor(rand() * 9) - 4)) : Math.floor(rand() * 48);
        const z = near ? Math.min(31, Math.max(0, cz + Math.floor(rand() * 9) - 4)) : Math.floor(rand() * 32);
        list.push([x, 6 + Math.floor(rand() * 16), z, ids[Math.floor(rand() * ids.length)]]);
      }
      const before = t.light().slice(), changed = t.editMany(list);
      const fresh = t.fresh(), now = t.light();
      if (!fresh.every((v, i) => v === now[i])) {
        const i = fresh.findIndex((v, j) => v !== now[j]);
        throw new Error(`batch ${k}: cell ${i % 48},${Math.floor(i / (48 * 32))},${Math.floor(i / 48) % 32} is ${now[i].toString(16)}, should be ${fresh[i].toString(16)}`);
      }
      const diff: number[] = [];
      now.forEach((v, i) => { if (v !== before[i]) diff.push(cellKey(i % 48, Math.floor(i / (48 * 32)), Math.floor(i / 48) % 32)); });
      expect(changed.slice().sort((a, b) => a - b)).toEqual(diff.sort((a, b) => a - b));
    }
  });
});
