import { describe, expect, it } from 'vitest';
import { CS, H, W, D, SEA_LEVEL, CI } from '../src/config';
import { AIR, WATER, SOLID } from '../src/blocks';
import { generateChunk, columnHeight, waterLevel } from '../src/gen';

describe('world generation', () => {
  it('is a pure function of (seed, chunk): the same whichever order chunks are generated in', () => {
    const first = generateChunk(4242, 16, 16);
    for (const [cx, cz] of [[15, 16], [17, 16], [16, 15], [16, 17], [3, 29]]) generateChunk(4242, cx, cz);
    expect(generateChunk(4242, 16, 16)).toEqual(first);
    expect(generateChunk(4243, 16, 16)).not.toEqual(first);
  });

  it('fills the sea with still water from the seabed up to sea level', () => {
    const c = generateChunk(4242, 0, 0);                       // the open ocean in the world's corner
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const h = columnHeight(4242, lx, lz);
      expect(h).toBeLessThan(SEA_LEVEL);
      for (let y = 0; y < H; y++) expect(c[CI(lx, y, lz)]).toBe(y < h ? c[CI(lx, y, lz)] : y < SEA_LEVEL ? WATER : AIR);
      expect(SOLID[c[CI(lx, h - 1, lz)]]).toBe(1);
    }
  });

  it('digs lakes into inland ground, above sea level, and they hold their water', () => {
    // the first lake column in the world, then the 3×3 chunks around it
    let lake: number[] | null = null;
    for (let z = 0; z < D && !lake; z++) for (let x = 0; x < W; x++) {
      if (waterLevel(777, x, z) > SEA_LEVEL && columnHeight(777, x, z) < waterLevel(777, x, z)) { lake = [x, z]; break; }
    }
    expect(lake).not.toBeNull();
    const cx = lake![0] >> 4, cz = lake![1] >> 4, chunks = new Map<number, Uint8Array>();
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) chunks.set((cx + dx) * 64 + cz + dz, generateChunk(777, cx + dx, cz + dz));
    const get = (x: number, y: number, z: number) => chunks.get((x >> 4) * 64 + (z >> 4))![CI(x & 15, y, z & 15)];
    let water = 0;
    // in the middle chunk: every water block has water or solid ground beside and under it
    for (let z = cz * CS; z < cz * CS + CS; z++) for (let x = cx * CS; x < cx * CS + CS; x++) for (let y = SEA_LEVEL; y < H; y++) {
      if (get(x, y, z) !== WATER) continue;
      water++;
      for (const [nx, ny, nz] of [[x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1], [x, y - 1, z]]) {
        const b = get(nx, ny, nz);
        expect(b === WATER || SOLID[b] === 1, `water at ${x},${y},${z} next to ${b} at ${nx},${ny},${nz}`).toBe(true);
      }
    }
    expect(water).toBeGreaterThan(0);
  });
});
