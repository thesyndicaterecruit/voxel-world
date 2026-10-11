import { describe, expect, it } from 'vitest';
import { CS, CI, H, W, D } from '../src/config';
import { B, LOG, LEAVES } from '../src/blocks';
import { BIOMES, NBIOMES, GN, CELL, DEEP_OCEAN, WARM_REEF, FROZEN_OCEAN, TROPICAL, TAIGA, SNOWY_PEAKS, DESERT, BADLANDS, JUNGLE,
  biomeMap, biomeAt, islands, coast, findBiome, tintMap, weights } from '../src/biomes';
import { generator, column2, newCol } from '../src/gen';

const SEEDS = [4242, 777, 123, 1, 99];

describe('biomes', () => {
  it('are data: every one has a name, its shape, blocks that exist, colours and haze', () => {
    expect(BIOMES.length).toBe(NBIOMES);
    expect(new Set(BIOMES.map((b) => b.name)).size).toBe(NBIOMES);
    BIOMES.forEach((b, i) => {
      expect(b.id).toBe(i);
      for (const id of [b.top, b.fill, b.under, b.bed, b.shore, b.cliff, b.patch]) expect(B[id], `${b.name}: block ${id}`).toBeDefined();
      expect(['rolling', 'hills', 'peaks', 'dunes', 'mesa', 'marsh', 'volcano']).toContain(b.shape);
      expect(['plain', 'trench', 'bars']).toContain(b.seaShape);
      for (const v of [b.cliffChance, b.patchAmount, b.freeze]) expect(v >= 0 && v <= 1).toBe(true);
      expect(b.snowLine === 0 || (b.snowLine > 48 && b.snowLine < H)).toBe(true);
      for (const c of [b.grass, b.foliage, b.water]) expect(c >= 0 && c <= 0xffffff).toBe(true);
      expect(b.hazeAmount >= 0 && b.hazeAmount <= 1).toBe(true);
      expect(Array.isArray(b.decorations)).toBe(true);
    });
    expect(BIOMES.filter((b) => b.ocean).map((b) => b.id)).toEqual([DEEP_OCEAN, WARM_REEF, FROZEN_OCEAN]);
  });

  it('are all in a world: every biome somewhere in at least 3 of 5 seeds\' worlds', () => {
    const worlds = new Array(NBIOMES).fill(0);
    for (const seed of SEEDS) {
      const seen = new Set(biomeMap(seed).biome);
      for (let i = 0; i < NBIOMES; i++) if (seen.has(i)) worlds[i]++;
    }
    BIOMES.forEach((b, i) => expect(worlds[i], b.name).toBeGreaterThanOrEqual(3));
  });

  it('give each island one or two biomes of its own', () => {
    for (const seed of SEEDS) {
      const { list } = islands(seed), seen = new Map(list.map((i) => [i, new Set<number>()]));
      for (let gz = 0; gz < GN; gz++) for (let gx = 0; gx < GN; gx++) {
        const x = gx * CELL + CELL / 2, z = gz * CELL + CELL / 2, c = coast(seed, x, z);
        if (c.t >= 0 && c.island) seen.get(c.island)!.add(biomeAt(seed, x, z));
      }
      for (const [isl, set] of seen) {
        expect(set.size, `island at ${Math.round(isl.x)},${Math.round(isl.z)}`).toBeLessThanOrEqual(2);
        for (const bm of set) expect([isl.primary, isl.secondary]).toContain(bm);
      }
      expect(list.length).toBeGreaterThanOrEqual(12);
    }
  });

  it('make sense next to each other: nothing cold within 12 blocks of anything hot', () => {
    const cold = new Set([FROZEN_OCEAN, TAIGA, SNOWY_PEAKS]), hot = new Set([WARM_REEF, TROPICAL, DESERT, BADLANDS, JUNGLE]);
    for (const seed of SEEDS) {
      const m = biomeMap(seed).biome, R = 3;
      for (let gz = 0; gz < GN; gz++) for (let gx = 0; gx < GN; gx++) {
        if (!cold.has(m[gx + gz * GN])) continue;
        for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
          const x = gx + dx, z = gz + dz;
          if (x >= 0 && z >= 0 && x < GN && z < GN && hot.has(m[x + z * GN])) {
            throw new Error(`seed ${seed}: ${BIOMES[m[gx + gz * GN]].name} at cell ${gx},${gz} next to ${BIOMES[m[x + z * GN]].name}`);
          }
        }
      }
    }
  });

  it('blend across their borders: a border is never steeper than the ground inside the biomes', () => {
    for (const seed of [4242, 777]) {
      const n = W, h = new Int16Array(n * n), bm = new Uint8Array(n * n), skip = new Uint8Array(n * n), c = newCol();
      for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
        column2(seed, x, z, c);
        h[x + z * n] = c.h; bm[x + z * n] = c.biome;
        skip[x + z * n] = +(Math.abs(c.t) < 10 || c.rock > 0);        // the coast's own cliffs and stacks are no border's doing
      }
      let border = 0, inside = 0, borders = 0;
      for (let z = 0; z < n - 1; z++) for (let x = 0; x < n - 1; x++) {
        const i = x + z * n;
        for (const j of [i + 1, i + n]) {
          if ((h[i] < 48 && h[j] < 48) || skip[i] || skip[j]) continue;   // the sea floor, the coast
          const d = Math.abs(h[i] - h[j]);
          if (bm[i] !== bm[j]) { border = Math.max(border, d); borders++; } else inside = Math.max(inside, d);
        }
      }
      expect(borders, `seed ${seed}`).toBeGreaterThan(1000);
      expect(border).toBeLessThanOrEqual(inside);
    }
  }, 60000);

  it('weigh the biomes around a column, adding up to one', () => {
    const w = new Float32Array(NBIOMES);
    for (const [x, z] of [[256, 256], [100, 300], [400, 450], [10, 10]]) {
      const best = weights(4242, x, z, w);
      expect(w.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 5);
      expect(w[best]).toBe(Math.max(...w));
    }
  });

  it('are found by the teleport: the nearest place of each, well inside it', () => {
    for (let id = 0; id < NBIOMES; id++) {
      const at = findBiome(4242, id, 256, 256);
      expect(at, BIOMES[id].name).not.toBeNull();
      const [x, z] = at!;
      expect(biomeAt(4242, x, z)).toBe(id);
      for (let dz = -CELL; dz <= CELL; dz += CELL) for (let dx = -CELL; dx <= CELL; dx += CELL) expect(biomeAt(4242, x + dx, z + dz)).toBe(id);
    }
    expect(findBiome(4242, FROZEN_OCEAN, 0, 0)).toEqual([2, 2]);  // the world's corner: open sea, and the north is cold
  });

  it('tint the world smoothly: neighbouring tint texels are close', () => {
    const t = tintMap(4242);
    let worst = 0;
    for (let k = 0; k < 3; k++) for (let gz = 0; gz < GN; gz++) for (let gx = 0; gx < GN - 1; gx++) {
      const o = (k * GN * GN + gx + gz * GN) * 4;
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(t[o + c] - t[o + 4 + c]));
    }
    expect(worst).toBeLessThan(80);
  });
});

describe('generator 2', () => {
  const g = generator(2);

  it('is deterministic: the same seed gives the same chunks, whatever was generated before', () => {
    const a = g.generateChunk(777, 14, 17);
    for (const [cx, cz] of [[3, 3], [14, 18], [30, 2]]) g.generateChunk(777, cx, cz);
    biomeMap(4242); biomeMap(1); biomeMap(99);                    // other seeds' maps in between
    expect(g.generateChunk(777, 14, 17)).toEqual(a);
  });

  it('is continuous across chunk borders: the ground goes on, and trees reach over them', () => {
    const seed = 4242, c = newCol();
    // the ground steps across chunk borders no more than it does between the columns inside chunks
    let across = 0, within = 0;
    for (let z = 0; z < D; z++) for (let x = 1; x < W; x++) {
      const d = Math.abs(column2(seed, x, z, c).h - column2(seed, x - 1, z, newCol()).h);
      if (x % CS === 0) across = Math.max(across, d); else within = Math.max(within, d);
    }
    expect(across).toBeLessThanOrEqual(within);
    // a tree by a chunk border has its crown on both sides: its trunk in one chunk, leaves 2 out in the next
    const chunk = new Map<number, Uint8Array>(), at = (x: number, y: number, z: number) => {
      const k = (x >> 4) + (z >> 4) * 32;
      if (!chunk.has(k)) chunk.set(k, g.generateChunk(seed, x >> 4, z >> 4));
      return chunk.get(k)![CI(x & 15, y, z & 15)];
    };
    let trees = 0;
    for (let cz = 8; cz <= 23; cz++) for (let cx = 8; cx <= 23; cx++) for (const [lx, dx] of [[14, 2], [15, 2], [0, -2], [1, -2]]) for (let lz = 2; lz < 14; lz++) {
      const x = cx * CS + lx, z = cz * CS + lz;
      let y = 1;
      while (y < H - 1 && !(at(x, y, z) === LOG && at(x, y - 1, z) !== LOG)) y++;
      if (y >= H - 1) continue;
      let top = y;
      while (at(x, top + 1, z) === LOG) top++;
      trees++;
      expect(at(x + dx, top - 1, z), `the tree at ${x},${y},${z}`).toBe(LEAVES);   // across the border, at the top of its trunk
    }
    expect(trees).toBeGreaterThan(5);
  });
});
