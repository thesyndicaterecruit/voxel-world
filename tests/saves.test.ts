import { describe, expect, it } from 'vitest';
import { CHUNK_VOL, CI } from '../src/config';
import { STONE, PLANKS, TORCH } from '../src/blocks';
import { rleEncode, rleDecode } from '../src/rle';
import { SAVE_VERSION, migrateWorld, migrateChunk, encodeChunk, decodeChunk, type WorldRecord, type ChunkRecord } from '../src/saves';

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
  const v1World: WorldRecord = {
    id: 'mf3k2q8x1', name: 'Seed 777', seed: 777, createdAt: 1757000000000, lastPlayed: 1757000500000,
    saveVersion: 1, player: { x: 256.5, y: 31, z: 250.2, yaw: 1.2, pitch: -0.3 }, slot: 7, mode: 'place',
  };
  // A chunk as version 1 stored it: { v: 1, rle } — stone for y < 4, one planks block, air above
  const v1Chunk: ChunkRecord = { v: 1, rle: Uint8Array.from([0x80, 0x08, 3, 1, 6, 0xff, 0x77, 0]) };

  it('brings a world record up to date and keeps everything in it', () => {
    const w = migrateWorld(structuredClone(v1World));
    expect(w.saveVersion).toBe(SAVE_VERSION);
    expect({ ...w, saveVersion: 1 }).toEqual(v1World);
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
    const w = { ...v1World, saveVersion: SAVE_VERSION }, c = encodeChunk(new Uint8Array(CHUNK_VOL), null);
    expect(migrateWorld(w)).toBe(w);
    expect(migrateChunk(c)).toBe(c);
  });

  it('refuses records from a newer version instead of misreading them', () => {
    expect(() => migrateWorld({ ...v1World, saveVersion: SAVE_VERSION + 1 })).toThrow();
    expect(() => decodeChunk({ ...v1Chunk, v: SAVE_VERSION + 1 })).toThrow();
  });
});
