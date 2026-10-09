import { describe, expect, it } from 'vitest';
import { CHUNK_VOL, CI, SEA_LEVEL } from '../src/config';
import { AIR, STONE, PLANKS, TORCH, WATER, GLASS } from '../src/blocks';
import { generateChunk } from '../src/gen';
import { rleEncode, rleDecode } from '../src/rle';
import { SAVE_VERSION, NEW_WORLD_TIME, migrateWorld, migrateChunk, encodeChunk, decodeChunk, type StoredWorld, type ChunkRecord } from '../src/saves';

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
      expect(decodeChunk(rec)).toEqual({ data, state: null });
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
    expect({ ...w, saveVersion: 1, time: undefined }).toEqual({ ...v1World, time: undefined });
  });

  it('decodes a version 1 chunk: the same blocks, no block state', () => {
    const { data, state } = decodeChunk(v1Chunk);
    expect(state).toBeNull();
    expect(data.subarray(0, CI(0, 4, 0)).every((v) => v === STONE)).toBe(true);
    expect(data[CI(0, 4, 0)]).toBe(PLANKS);
    expect(data.subarray(CI(0, 4, 0) + 1).every((v) => v === 0)).toBe(true);
    // the block stream itself is unchanged, so re-saving it only adds the version
    expect(encodeChunk(data, state)).toEqual({ v: SAVE_VERSION, rle: v1Chunk.rle });
    expect(migrateChunk(v1Chunk)).toEqual({ v: SAVE_VERSION, rle: v1Chunk.rle });
  });

  it('leaves up-to-date records alone', () => {
    const w = { ...v1World, saveVersion: SAVE_VERSION, time: 3.6 }, c = encodeChunk(new Uint8Array(CHUNK_VOL), null);
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
  const data = new Uint8Array(CHUNK_VOL), state = new Uint8Array(CHUNK_VOL);
  data[CI(3, 30, 4)] = PLANKS; data[CI(4, 30, 4)] = TORCH; state[CI(4, 30, 4)] = 1;
  const v2Chunk: ChunkRecord = { v: 2, rle: rleEncode(data), srle: rleEncode(state) };

  it('gives the world a clock, starting in the morning, and keeps the rest', () => {
    const w = migrateWorld(structuredClone(v2World));
    expect([w.saveVersion, w.time]).toEqual([SAVE_VERSION, NEW_WORLD_TIME]);
    expect({ ...w, saveVersion: 2, time: undefined }).toEqual({ ...v2World, time: undefined });
  });

  it('reads its chunks with their block state', () => {
    const back = decodeChunk(v2Chunk);
    expect(back.data).toEqual(data);
    expect(back.state).toEqual(state);
    expect(migrateChunk(v2Chunk)).toEqual({ v: SAVE_VERSION, rle: v2Chunk.rle, srle: v2Chunk.srle });
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
  const old = sea.map((b) => (b === WATER ? AIR : b));
  for (let y = 4; y <= 8; y++) for (let z = 4; z <= 8; z++) for (let x = 4; x <= 8; x++) {
    old[CI(x, y, z)] = x === 4 || x === 8 || y === 4 || y === 8 || z === 4 || z === 8 ? GLASS : AIR;
  }
  const v3Chunk: ChunkRecord = { v: 3, rle: rleEncode(old) };

  it('keeps the world record as it was, clock and all', () => {
    const w = migrateWorld(structuredClone(v3World));
    expect(w.saveVersion).toBe(SAVE_VERSION);
    expect({ ...w, saveVersion: 3 }).toEqual(v3World);
  });

  it('fills the sea back in when its chunks are read, but not the shut-off room', () => {
    const { data } = decodeChunk(v3Chunk, at);
    for (let i = 0; i < CHUNK_VOL; i++) {
      const x = i & 15, z = (i >> 4) & 15, y = i >> 8, room = x >= 4 && x <= 8 && y >= 4 && y <= 8 && z >= 4 && z <= 8;
      if (!room) expect(data[i]).toBe(sea[i]);
    }
    expect(data[CI(6, 6, 6)]).toBe(AIR);
    expect(data[CI(6, SEA_LEVEL - 1, 6)]).toBe(WATER);
    expect(data[CI(6, SEA_LEVEL, 6)]).toBe(AIR);
    // a record migrated with its place has the sea in it; without it, nothing is added
    expect(rleDecode(migrateChunk(v3Chunk, at).rle)).toEqual(data);
    expect(migrateChunk(v3Chunk).rle).toEqual(v3Chunk.rle);
  });
});
