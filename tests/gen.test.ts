import { describe, expect, it } from 'vitest';
import { CS, H, W, D, CI, OLD_H, CHUNK_VOL } from '../src/config';
import { AIR, WATER, SOLID, BEDROCK, STONE } from '../src/blocks';
import { generateChunk, columnHeight, waterLevel, findSpawn, SEA_LEVEL_1 as SEA_LEVEL } from '../src/gen1';
import { generator, GENERATOR_VERSION } from '../src/gen';

/** FNV-1a hash of a chunk's bytes */
const fnv = (d: Uint8Array) => { let h = 0x811c9dc5; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };

describe('generator 1 (worlds made before generator versions)', () => {
  // What it made in the 64-high world, recorded before the world grew taller: it must never change,
  // or old worlds' unexplored ground would shift next to the chunks they saved
  const FINGERPRINTS = [
      '777:16,16:3179700230',
      '777:15,16:1867604635',
      '777:3,7:1677437369',
      '777:20,25:2441600433',
      '777:0,0:1424438651',
      '777:31,31:2377267802',
      '777:12,18:1470897512',
      '777:spawn:255,257',
      '777:heights:4242957911',
      '4242:16,16:1009929314',
      '4242:15,16:1930091570',
      '4242:3,7:2976627582',
      '4242:20,25:1944004306',
      '4242:0,0:117134323',
      '4242:31,31:1623153739',
      '4242:12,18:2377429503',
      '4242:spawn:256,256',
      '4242:heights:1962934086',
      '123:16,16:3535293164',
      '123:15,16:2552036174',
      '123:3,7:523542104',
      '123:20,25:2789958476',
      '123:0,0:1264164992',
      '123:31,31:2981496224',
      '123:12,18:2267116300',
      '123:spawn:256,256',
      '123:heights:1706839452',
      '1:16,16:1066713837',
      '1:15,16:1366047062',
      '1:3,7:3650520654',
      '1:20,25:2699418775',
      '1:0,0:2727228591',
      '1:31,31:1274290846',
      '1:12,18:1609101241',
      '1:spawn:250,262',
      '1:heights:3838257432'
  ];

  it('gives exactly the blocks it always did, with air above the old top of the world', () => {
    const got: string[] = [];
    for (const seed of [777, 4242, 123, 1]) {
      for (const [cx, cz] of [[16, 16], [15, 16], [3, 7], [20, 25], [0, 0], [31, 31], [12, 18]]) {
        const c = generateChunk(seed, cx, cz), old = CS * CS * OLD_H;
        expect(c.length).toBe(CHUNK_VOL);
        expect(c.subarray(old).every((b) => b === AIR)).toBe(true);
        got.push(`${seed}:${cx},${cz}:${fnv(c.subarray(0, old))}`);
      }
      got.push(`${seed}:spawn:${findSpawn(seed).join(',')}`);
      let s = 0;
      for (let x = 0; x < 512; x += 7) for (let z = 0; z < 512; z += 11) s = (s * 31 + columnHeight(seed, x, z)) >>> 0;
      got.push(`${seed}:heights:${s}`);
    }
    expect(got).toEqual(FINGERPRINTS);
  });

  it('is what old worlds get, with their sea level', () => {
    const g = generator(1);
    expect([g.version, g.seaLevel]).toEqual([1, 20]);
    expect(g.generateChunk(4242, 16, 16)).toEqual(generateChunk(4242, 16, 16));
  });
});

describe('generator 2 (new worlds)', () => {
  const g = generator(GENERATOR_VERSION);

  it('is the one new worlds get, with the sea at y = 48', () => {
    expect([g.version, g.seaLevel]).toEqual([2, 48]);
  });

  it('is a pure function of (seed, chunk), with bedrock at the bottom and the sea filled up to sea level', () => {
    const first = g.generateChunk(4242, 16, 16);
    for (const [cx, cz] of [[15, 16], [17, 16], [3, 29]]) g.generateChunk(4242, cx, cz);
    expect(g.generateChunk(4242, 16, 16)).toEqual(first);
    const sea = g.generateChunk(4242, 0, 0);                    // the open ocean in the world's corner
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      expect(sea[CI(lx, 0, lz)]).toBe(BEDROCK);
      expect(sea[CI(lx, 1, lz)]).toBe(STONE);
      expect(sea[CI(lx, g.seaLevel - 1, lz)]).toBe(WATER);
      expect(sea[CI(lx, g.seaLevel, lz)]).toBe(AIR);
      const h = g.surfaceHeight(4242, lx, lz);
      for (let y = 1; y < H; y++) expect(sea[CI(lx, y, lz)] === WATER).toBe(y >= h && y < g.seaLevel);
    }
  });

  it('puts the spawn on dry ground above the sea', () => {
    const [x, z] = g.findSpawn(4242);
    expect(g.surfaceHeight(4242, x, z)).toBeGreaterThanOrEqual(g.seaLevel);
  });
});

describe('world generation (generator 1)', () => {
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
