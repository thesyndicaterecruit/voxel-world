import { describe, expect, it } from 'vitest';
import { CHUNK_VOL, CI, CS, OLD_H } from '../src/config';
import { AIR, STONE, PLANKS, TORCH, WATER, GLASS, SNOW, ICE, HOTBAR } from '../src/blocks';
import { generateChunk, SEA_LEVEL_1 } from '../src/gen1';
import { GENERATOR_VERSION } from '../src/gen';
import { rleEncode, rleDecode } from '../src/rle';
import { SAVE_VERSION, NEW_WORLD_TIME, migrateWorld, migrateChunk, encodeChunk, decodeChunk, createWorld, type StoredWorld,
  type ChunkRecord } from '../src/saves';

/** Blocks in a chunk saved before version 6, when the world was OLD_H high */
const OLD_VOL = CS * CS * OLD_H;
/** An old (OLD_H high) chunk's data in today's taller chunk: air above */
const raised = (old: Uint8Array) => { const d = new Uint8Array(CHUNK_VOL); d.set(old); return d; };
/** What migrating appends to an old chunk's RLE streams: one run of air up to the top of the world */
const TOP_AIR = rleEncode(new Uint8Array(CHUNK_VOL - OLD_VOL));
const plusTop = (rle: Uint8Array) => Uint8Array.from([...rle, ...TOP_AIR]);

/** Deterministic pseudo-random bytes */
function rand(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}
/** A chunk-shaped volume: stone below y = 20, air above, with some random blocks mixed in */
function terrain(seed: number): Uint8Array {
  const r = rand(seed), d = new Uint8Array(CHUNK_VOL);
  for (let i = 0; i < CHUNK_VOL; i++) d[i] = i < CI(0, 20, 0) ? STONE : 0;
  for (let k = 0; k < 300; k++) d[Math.floor(r() * CHUNK_VOL)] = Math.floor(r() * 13);
  return d;
}

describe('run-length encoding', () => {
  it('round-trips chunk data, including runs long enough for multi-byte lengths', () => {
    for (const d of [new Uint8Array(CHUNK_VOL), terrain(1), terrain(2).map((v, i) => (i % 2 ? v : 255))]) {
      expect(rleDecode(rleEncode(d))).toEqual(d);
    }
  });

  it('rejects data that is not exactly one chunk', () => {
    expect(() => rleDecode(Uint8Array.from([5, 1]))).toThrow();
    expect(() => rleDecode(rleEncode(new Uint8Array(CHUNK_VOL)).subarray(0, 2))).toThrow();
  });
});

describe('chunk save format', () => {
  it('round-trips block ids and per-block state', () => {
    const data = terrain(3), state = new Uint8Array(CHUNK_VOL), r = rand(4);
    for (let k = 0; k < 50; k++) state[Math.floor(r() * CHUNK_VOL)] = 1 + Math.floor(r() * 255);
    const rec = encodeChunk(data, state);
    expect(rec.v).toBe(SAVE_VERSION);
    expect(rec.srle).toBeDefined();
    const back = decodeChunk(rec);
    expect(back.data).toEqual(data);
    expect(back.state).toEqual(state);
  });

  it('round-trips the blocks with pending water updates, and has no list when there are none', () => {
    const data = terrain(8), flow = Uint16Array.from([CI(1, 20, 2), CI(1, 19, 2), CI(15, 3, 0)]);
    const rec = encodeChunk(data, null, flow);
    expect(Array.from(rec.flow!)).toEqual(Array.from(flow));
    expect(Array.from(decodeChunk(structuredClone(rec)).flow!)).toEqual(Array.from(flow));
    expect(encodeChunk(data, null, new Uint16Array(0)).flow).toBeUndefined();
    expect(decodeChunk(encodeChunk(data, null)).flow).toBeNull();
  });

  it('round-trips a wall torch with its facing', () => {
    const data = new Uint8Array(CHUNK_VOL), state = new Uint8Array(CHUNK_VOL);
    data[CI(3, 30, 4)] = PLANKS;
    data[CI(4, 30, 4)] = TORCH; state[CI(4, 30, 4)] = 1;
    const back = decodeChunk(encodeChunk(data, state));
    expect([back.data[CI(4, 30, 4)], back.state![CI(4, 30, 4)]]).toEqual([TORCH, 1]);
  });

  it('stores no state stream while every state byte is 0, and reads that back as no state', () => {
    const data = terrain(5);
    for (const state of [null, new Uint8Array(CHUNK_VOL)]) {
      const rec = encodeChunk(data, state);
      expect(rec.srle).toBeUndefined();
      expect(decodeChunk(rec)).toEqual({ data, state: null, flow: null });
    }
  });

  it('survives structured cloning (what IndexedDB stores)', () => {
    const data = terrain(6), state = new Uint8Array(CHUNK_VOL);
    state[CI(1, 2, 3)] = 7;
    const back = decodeChunk(structuredClone(encodeChunk(data, state)));
    expect(back.data).toEqual(data);
    expect(back.state).toEqual(state);
  });
});

describe('migration from save version 1', () => {
  // A world record as version 1 wrote it
  const v1World: StoredWorld = {
    id: 'mf3k2q8x1', name: 'Seed 777', seed: 777, createdAt: 1757000000000, lastPlayed: 1757000500000,
    saveVersion: 1, player: { x: 256.5, y: 31, z: 250.2, yaw: 1.2, pitch: -0.3 }, slot: 7, mode: 'place',
  };
  // A chunk as version 1 stored it: { v: 1, rle } — stone for y < 4, one planks block, air above
  const v1Chunk: ChunkRecord = { v: 1, rle: Uint8Array.from([0x80, 0x08, 3, 1, 6, 0xff, 0x77, 0]) };

  it('brings a world record up to date and keeps everything in it; the clock starts in the morning', () => {
    const w = migrateWorld(structuredClone(v1World));
    expect(w.saveVersion).toBe(SAVE_VERSION);
    expect(w.time).toBe(NEW_WORLD_TIME);
    expect(w.generatorVersion).toBe(1);
    expect(w.hotbar).toEqual(HOTBAR);
    expect({ ...w, saveVersion: 1, time: undefined, generatorVersion: undefined, hotbar: undefined }).toEqual({ ...v1World, time: undefined });
  });

  it('decodes a version 1 chunk: the same blocks, no block state', () => {
    const { data, state } = decodeChunk(v1Chunk);
    expect(state).toBeNull();
    expect(data.length).toBe(CHUNK_VOL);
    expect(data.subarray(0, CI(0, 4, 0)).every((v) => v === STONE)).toBe(true);
    expect(data[CI(0, 4, 0)]).toBe(PLANKS);
    expect(data.subarray(CI(0, 4, 0) + 1).every((v) => v === 0)).toBe(true);
    // the block stream itself is kept, with air on top
    expect(migrateChunk(v1Chunk)).toEqual({ v: SAVE_VERSION, rle: plusTop(v1Chunk.rle) });
    expect(rleDecode(encodeChunk(data, state).rle)).toEqual(data);
  });

  it('leaves up-to-date records alone', () => {
    const w = { ...v1World, saveVersion: SAVE_VERSION, time: 3.6, generatorVersion: 1, hotbar: HOTBAR.slice() }, c = encodeChunk(new Uint8Array(CHUNK_VOL), null);
    expect(migrateWorld(w)).toBe(w);
    expect(migrateChunk(c)).toBe(c);
  });

  it('refuses records from a newer version instead of misreading them', () => {
    expect(() => migrateWorld({ ...v1World, saveVersion: SAVE_VERSION + 1 })).toThrow();
    expect(() => decodeChunk({ ...v1Chunk, v: SAVE_VERSION + 1 })).toThrow();
  });
});

describe('migration from save version 2', () => {
  // version 2: no clock in the world record; chunks with a block-state stream
  const v2World: StoredWorld = {
    id: 'mg2a91k3p', name: 'Island 2', seed: 4242, createdAt: 1759000000000, lastPlayed: 1759900000000,
    saveVersion: 2, player: { x: 271.5, y: 33, z: 248.5, yaw: -0.6, pitch: 0.1 }, slot: 9, mode: 'place',
  };
  const data = new Uint8Array(OLD_VOL), state = new Uint8Array(OLD_VOL);
  data[CI(3, 30, 4)] = PLANKS; data[CI(4, 30, 4)] = TORCH; state[CI(4, 30, 4)] = 1;
  const v2Chunk: ChunkRecord = { v: 2, rle: rleEncode(data), srle: rleEncode(state) };

  it('gives the world a clock, starting in the morning, and keeps the rest', () => {
    const w = migrateWorld(structuredClone(v2World));
    expect([w.saveVersion, w.time, w.generatorVersion]).toEqual([SAVE_VERSION, NEW_WORLD_TIME, 1]);
    expect(w.hotbar).toEqual(HOTBAR);
    expect({ ...w, saveVersion: 2, time: undefined, generatorVersion: undefined, hotbar: undefined }).toEqual({ ...v2World, time: undefined });
  });

  it('reads its chunks with their block state', () => {
    const back = decodeChunk(v2Chunk);
    expect(back.data).toEqual(raised(data));
    expect(back.state).toEqual(raised(state));
    expect(migrateChunk(v2Chunk)).toEqual({ v: SAVE_VERSION, rle: plusTop(v2Chunk.rle), srle: plusTop(v2Chunk.srle!) });
  });
});

describe('migration from save version 3', () => {
  const v3World: StoredWorld = {
    id: 'mh7q2b0zc', name: 'Island 3', seed: 4242, createdAt: 1760000000000, lastPlayed: 1760000900000,
    saveVersion: 3, player: { x: 256.5, y: 30, z: 256.5, yaw: 0.3, pitch: -0.2 }, slot: 2, mode: 'break', time: 3.6,
  };
  /**
   * An ocean chunk as version 3 kept it: air where the sea is (the sea was a surface drawn over the
   * world), with a glass room shut off on the seabed
   */
  const at = { seed: 4242, cx: 0, cz: 0 }, sea = generateChunk(4242, 0, 0);
  const old = sea.slice(0, OLD_VOL).map((b) => (b === WATER ? AIR : b));
  for (let y = 4; y <= 8; y++) for (let z = 4; z <= 8; z++) for (let x = 4; x <= 8; x++) {
    old[CI(x, y, z)] = x === 4 || x === 8 || y === 4 || y === 8 || z === 4 || z === 8 ? GLASS : AIR;
  }
  const v3Chunk: ChunkRecord = { v: 3, rle: rleEncode(old) };

  it('keeps the world record as it was, clock and all', () => {
    const w = migrateWorld(structuredClone(v3World));
    expect([w.saveVersion, w.generatorVersion]).toEqual([SAVE_VERSION, 1]);
    expect({ ...w, saveVersion: 3, generatorVersion: undefined, hotbar: undefined }).toEqual({ ...v3World, generatorVersion: undefined });
  });

  it('fills the sea back in when its chunks are read, but not the shut-off room', () => {
    const { data } = decodeChunk(v3Chunk, at);
    for (let i = 0; i < CHUNK_VOL; i++) {
      const x = i & 15, z = (i >> 4) & 15, y = i >> 8, room = x >= 4 && x <= 8 && y >= 4 && y <= 8 && z >= 4 && z <= 8;
      if (!room) expect(data[i]).toBe(sea[i]);
    }
    expect(data[CI(6, 6, 6)]).toBe(AIR);
    expect(data[CI(6, SEA_LEVEL_1 - 1, 6)]).toBe(WATER);
    expect(data[CI(6, SEA_LEVEL_1, 6)]).toBe(AIR);
    // a record migrated with its place has the sea in it; without it, nothing is added (but the air on top)
    expect(rleDecode(migrateChunk(v3Chunk, at).rle)).toEqual(data);
    expect(migrateChunk(v3Chunk).rle).toEqual(plusTop(v3Chunk.rle));
  });
});

describe('migration from save version 4', () => {
  // version 4: chunks with no pending water updates; world records like version 3's
  const data = new Uint8Array(OLD_VOL), state = new Uint8Array(OLD_VOL);
  data[CI(5, 19, 5)] = WATER; state[CI(5, 19, 5)] = 3;
  const v4Chunk: ChunkRecord = { v: 4, rle: rleEncode(data), srle: rleEncode(state) };

  it('reads its chunks as they were, with nothing left to flow', () => {
    const back = decodeChunk(v4Chunk, { seed: 4242, cx: 0, cz: 0 });
    expect(back.data).toEqual(raised(data));
    expect(back.state).toEqual(raised(state));
    expect(back.flow).toBeNull();
    expect(migrateChunk(v4Chunk)).toEqual({ v: SAVE_VERSION, rle: plusTop(v4Chunk.rle), srle: plusTop(v4Chunk.srle!) });
  });
});

describe('migration from save version 5', () => {
  // version 5: a world 64 blocks high, every world made by the first generator (no generatorVersion yet)
  const v5World: StoredWorld = {
    id: 'mi1c8d2qa', name: 'Island 4', seed: 4242, createdAt: 1760100000000, lastPlayed: 1760190000000,
    saveVersion: 5, player: { x: 250.5, y: 21, z: 260.5, yaw: 1.1, pitch: -0.4 }, slot: 10, mode: 'place', time: 5.25,
  };
  // a chunk with a stone pillar up to the old top of the world, water flowing off it, a torch on it
  const data = new Uint8Array(OLD_VOL), state = new Uint8Array(OLD_VOL);
  for (let y = 0; y < OLD_H; y++) data[CI(8, y, 8)] = STONE;
  data[CI(9, 63, 8)] = WATER; state[CI(9, 63, 8)] = 1;
  data[CI(8, 40, 9)] = TORCH; state[CI(8, 40, 9)] = 4;
  const flow = Uint16Array.from([CI(9, 63, 8), CI(10, 63, 8)]);
  const v5Chunk: ChunkRecord = { v: 5, rle: rleEncode(data), srle: rleEncode(state), flow };

  it('gives the world the first generator, so its unexplored ground is what it always was', () => {
    const w = migrateWorld(structuredClone(v5World));
    expect([w.saveVersion, w.generatorVersion]).toEqual([SAVE_VERSION, 1]);
    expect({ ...w, saveVersion: 5, generatorVersion: undefined, hotbar: undefined }).toEqual({ ...v5World, generatorVersion: undefined });
  });

  it('reads its chunks in the taller world: the same blocks, state and pending water, air above', () => {
    const back = decodeChunk(structuredClone(v5Chunk));
    expect(back.data.length).toBe(CHUNK_VOL);
    expect(back.data).toEqual(raised(data));
    expect(back.state).toEqual(raised(state));
    expect(back.data[CI(8, OLD_H - 1, 8)]).toBe(STONE);
    expect(back.data.subarray(OLD_VOL).every((b) => b === AIR)).toBe(true);
    expect(Array.from(back.flow!)).toEqual(Array.from(flow));      // the same blocks: CI indices don't change
    const m = migrateChunk(v5Chunk);
    expect(m).toEqual({ v: SAVE_VERSION, rle: plusTop(v5Chunk.rle), srle: plusTop(v5Chunk.srle!), flow });
    // and once saved again, it reads back the same
    expect(decodeChunk(encodeChunk(back.data, back.state, back.flow))).toEqual(back);
  });

  it('gives new worlds the newest generator', async () => {
    expect((await createWorld('Island 5', 99)).generatorVersion).toBe(GENERATOR_VERSION);
  });
});

describe('migration from save version 6', () => {
  // version 6: a world with a generator, and the fixed hotbar every world had (no `hotbar` in the record)
  const v6World: StoredWorld = {
    id: 'mj4d0e7rb', name: 'Island 6', seed: 777, createdAt: 1760200000000, lastPlayed: 1760290000000,
    saveVersion: 6, player: { x: 240.5, y: 52, z: 251.5, yaw: 0.2, pitch: -0.1 }, slot: 9, mode: 'place', time: 2.4, generatorVersion: 2,
  };
  const data = new Uint8Array(CHUNK_VOL), state = new Uint8Array(CHUNK_VOL);
  for (let y = 0; y < 100; y++) data[CI(3, y, 3)] = STONE;
  data[CI(3, 100, 3)] = TORCH;
  data[CI(4, 99, 3)] = WATER; state[CI(4, 99, 3)] = 2;
  const v6Chunk: ChunkRecord = { v: 6, rle: rleEncode(data), srle: rleEncode(state), flow: Uint16Array.from([CI(4, 99, 3)]) };

  it('gives the world the hotbar it always had, so its selected slot still holds the same block (a torch)', () => {
    const w = migrateWorld(structuredClone(v6World));
    expect([w.saveVersion, w.generatorVersion, w.time]).toEqual([SAVE_VERSION, 2, 2.4]);
    expect(w.hotbar).toEqual(HOTBAR);
    expect(w.hotbar[w.slot]).toBe(TORCH);
    expect({ ...w, saveVersion: 6, hotbar: undefined }).toEqual({ ...v6World, hotbar: undefined });
  });

  it('reads its chunks as they are: full height already', () => {
    const back = decodeChunk(structuredClone(v6Chunk));
    expect(back.data).toEqual(data);
    expect(back.state).toEqual(state);
    expect(Array.from(back.flow!)).toEqual([CI(4, 99, 3)]);
    expect(migrateChunk(v6Chunk)).toEqual({ ...v6Chunk, v: SAVE_VERSION });
  });
});

describe('save version 7', () => {
  it('keeps each world\'s own hotbar: new worlds start with the usual one, and a changed one is saved as it is', async () => {
    const w = await createWorld('Island 7', 5);
    expect(w.hotbar).toEqual(HOTBAR);
    const picked = { ...w, hotbar: [SNOW, ICE, ...HOTBAR.slice(2)] };
    expect(migrateWorld(structuredClone(picked))).toEqual(picked);
  });
});
