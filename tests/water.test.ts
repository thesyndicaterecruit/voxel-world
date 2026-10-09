import { describe, expect, it } from 'vitest';
import { CHUNK_VOL, CI } from '../src/config';
import { AIR, STONE, WATER, TORCH, LEVEL, FALLING } from '../src/blocks';
import { World } from '../src/world';
import { createWater, MAX_UPDATES } from '../src/water';

/** 3×3 chunks around chunk (16, 16) — x and z 240–287 — stone up to y = 9, the ground at y = 10 */
function testWorld(from?: World) {
  const w = new World();
  for (let cz = 15; cz <= 17; cz++) for (let cx = 15; cx <= 17; cx++) {
    const c = from?.chunk(cx, cz);
    const d = c ? c.data.slice() : new Uint8Array(CHUNK_VOL);
    if (!c) for (let i = 0; i < CI(0, 10, 0); i++) d[i] = STONE;
    w.setChunk(cx, cz, d, c?.state ? c.state.slice() : null);
  }
  const water = createWater(w, { onWash: (x, y, z, id) => washed.push([x, y, z, id]) });
  const washed: number[][] = [];
  w.onChange = (x, y, z, old) => water.blockChanged(x, y, z, old);
  const run = (n: number) => { for (let i = 0; i < n; i++) water.tick(); };
  /** 'S' a source, 'F' falling, 1–7 a level, '.' no water */
  const at = (x: number, y: number, z: number) => {
    if (w.getBlock(x, y, z) !== WATER) return '.';
    const s = w.getState(x, y, z);
    return s & FALLING ? 'F' : (s & LEVEL) === 0 ? 'S' : s & LEVEL;
  };
  return { w, water, run, at, washed };
}
const Y = 10, X = 264, Z = 264;

describe('flowing water', () => {
  it('spreads over flat ground one level weaker per block, 7 blocks from its source', () => {
    const t = testWorld();
    t.w.setBlock(X, Y, Z, WATER);
    t.run(12);
    for (let dz = -9; dz <= 9; dz++) for (let dx = -9; dx <= 9; dx++) {
      const d = Math.abs(dx) + Math.abs(dz);
      expect(t.at(X + dx, Y, Z + dz), `${dx},${dz}`).toBe(d === 0 ? 'S' : d <= 7 ? d : '.');
    }
    expect(t.at(X, Y + 1, Z)).toBe('.');
  });

  it('falls first, as full-height falling water, and spreads out where it lands', () => {
    const t = testWorld();
    t.w.setBlock(X, Y + 4, Z, WATER);                     // a source up in the air
    t.run(12);
    for (let y = Y; y < Y + 4; y++) expect(t.at(X, y, Z)).toBe('F');
    expect(t.at(X + 1, Y + 4, Z)).toBe('.');            // a source in the air only falls
    expect([t.at(X + 1, Y, Z), t.at(X, Y, Z - 1), t.at(X + 3, Y, Z)]).toEqual([1, 1, 3]);
    expect(t.at(X + 1, Y + 1, Z)).toBe('.');
  });

  it('drains back when its source is taken away', () => {
    const t = testWorld();
    t.w.setBlock(X, Y + 2, Z, WATER);
    t.run(12);
    expect(t.at(X + 2, Y, Z)).toBe(2);
    t.w.setBlock(X, Y + 2, Z, AIR);
    t.run(14);
    for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) for (let y = Y; y <= Y + 2; y++) expect(t.at(X + dx, y, Z + dz)).toBe('.');
  });

  it('makes a new source between two sources on solid ground (infinite water)', () => {
    const t = testWorld();
    t.w.setBlock(X, Y, Z, WATER);
    t.w.setBlock(X + 2, Y, Z, WATER);
    t.run(4);
    expect(t.at(X + 1, Y, Z)).toBe('S');
    expect([t.at(X + 1, Y, Z + 1), t.at(X - 1, Y, Z)]).toEqual([1, 1]);   // one source next door is not enough
  });

  it('heads for a drop within 4 blocks instead of spreading every way', () => {
    const t = testWorld();
    t.w.setBlock(X + 3, Y - 1, Z, AIR);                  // a hole 3 blocks east
    t.w.setBlock(X, Y, Z, WATER);
    t.run(6);
    expect([t.at(X + 1, Y, Z), t.at(X + 2, Y, Z), t.at(X + 3, Y, Z)]).toEqual([1, 2, 3]);
    expect(t.at(X + 3, Y - 1, Z)).toBe('F');
    expect([t.at(X - 1, Y, Z), t.at(X, Y, Z + 1), t.at(X, Y, Z - 1)]).toEqual(['.', '.', '.']);
  });

  it('finds another way when a block is put in its path, and the cut-off part drains', () => {
    const t = testWorld();
    // a channel one block wide running east from the source, with a hole 3 blocks along it
    for (let x = X + 1; x <= X + 5; x++) { t.w.setBlock(x, Y, Z - 1, STONE); t.w.setBlock(x, Y, Z + 1, STONE); }
    t.w.setBlock(X + 3, Y - 1, Z, AIR);
    t.w.setBlock(X, Y, Z, WATER);
    t.run(6);
    expect([t.at(X + 3, Y, Z), t.at(X + 3, Y - 1, Z), t.at(X - 1, Y, Z)]).toEqual([3, 'F', '.']);
    t.w.setBlock(X + 1, Y, Z, STONE);                    // dam the channel
    t.run(12);
    expect([t.at(X + 2, Y, Z), t.at(X + 3, Y, Z), t.at(X + 3, Y - 1, Z)]).toEqual(['.', '.', '.']);
    expect([t.at(X - 1, Y, Z), t.at(X, Y, Z + 1), t.at(X, Y, Z - 1)]).toEqual([1, 1, 1]);
  });

  it('flows across a chunk border', () => {
    const t = testWorld();
    t.w.setBlock(271, Y, Z, WATER);                      // the last column of chunk 16
    t.run(10);
    expect([t.at(272, Y, Z), t.at(275, Y, Z), t.at(278, Y, Z), t.at(279, Y, Z)]).toEqual([1, 4, 7, '.']);
  });

  it('washes torches away', () => {
    const t = testWorld();
    t.w.setBlock(X + 2, Y, Z, TORCH);
    t.w.setBlock(X, Y, Z, WATER);
    t.run(4);
    expect(t.at(X + 2, Y, Z)).toBe(2);
    expect(t.washed).toEqual([[X + 2, Y, Z, TORCH]]);
  });

  it('leaves water nobody disturbed alone, and updates at most MAX_UPDATES blocks a tick', () => {
    const t = testWorld();
    // a walled pool of 20 × 10 sources: placing them schedules each, and they have nowhere to go
    for (let z = Z - 1; z <= Z + 10; z++) for (let x = X - 11; x <= X + 10; x++) t.w.setBlock(x, Y, z, STONE);
    for (let z = Z; z < Z + 10; z++) for (let x = X - 10; x < X + 10; x++) t.w.setBlock(x, Y, z, WATER);
    expect(t.water.stats().pending).toBe(200);
    expect(t.water.tick()).toBe(0);
    expect(t.water.stats().pending).toBe(200 - MAX_UPDATES);
    t.run(1);
    expect(t.water.stats().pending).toBe(0);
    t.run(3);
    expect(t.water.stats().pending).toBe(0);
  });

  it('keeps flowing after a save and reload: pending updates go with their chunk', () => {
    const a = testWorld();
    a.w.setBlock(X, Y + 3, Z, WATER);
    a.run(3);                                            // half way down
    const flow = a.water.pendingIn(16, 16)!;
    expect(flow.length).toBeGreaterThan(0);
    // the same blocks in a new world, with the saved updates
    const b = testWorld(a.w);
    b.water.restore(16, 16, flow);
    a.run(12); b.run(12);
    for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) for (let y = Y; y <= Y + 3; y++) {
      expect(b.at(X + dx, y, Z + dz)).toBe(a.at(X + dx, y, Z + dz));
    }
    expect(b.at(X + 4, Y, Z)).toBe(4);
  });
});
