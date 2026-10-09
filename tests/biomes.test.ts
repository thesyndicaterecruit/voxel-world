import { describe, expect, it } from 'vitest';
import { CS, CI, H } from '../src/config';
import { B, AIR, WATER, SOLID } from '../src/blocks';
import { BIOMES, NBIOMES, GN, CELL, DEEP_OCEAN, WARM_REEF, FROZEN_OCEAN, TROPICAL, TAIGA, SNOWY_PEAKS, DESERT, BADLANDS, JUNGLE,
  biomeMap, biomeAt, islands, coast, findBiome, tintMap, weights } from '../src/biomes';
import { generator, column2 } from '../src/gen';

const SEEDS = [4242, 777, 123, 1, 99];

describe('biomes', () => {
  it('are data: every one has a name, its shape, blocks that exist, colours and haze', () => {
    expect(BIOMES.length).toBe(NBIOMES);
    expect(new Set(BIOMES.map((b) => b.name)).size).toBe(NBIOMES);
    BIOMES.forEach((b, i) => {
      expect(b.id).toBe(i);
      for (const id of [b.top, b.fill, b.bed, b.shore]) expect(B[id], `${b.name}: block ${id}`).toBeDefined();
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
    const seed = 4242, x0 = 128, z0 = 128, n = 256;
    const h = new Int16Array(n * n), bm = new Uint8Array(n * n);
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { const c = column2(seed, x0 + x, z0 + z); h[x + z * n] = c.h; bm[x + z * n] = c.biome; }
    let border = 0, inside = 0, borders = 0;
    for (let z = 0; z < n - 1; z++) for (let x = 0; x < n - 1; x++) {
      const i = x + z * n;
      for (const j of [i + 1, i + n]) {
        if (h[i] < 48 && h[j] < 48) continue;                    // the sea floor
        const d = Math.abs(h[i] - h[j]);
        if (bm[i] !== bm[j]) { border = Math.max(border, d); borders++; } else inside = Math.max(inside, d);
      }
    }
    expect(borders).toBeGreaterThan(1000);
    expect(border).toBeLessThanOrEqual(inside);
    expect(border).toBeLessThanOrEqual(8);
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

  it('is continuous across chunk and section borders: every column is its ground and the sea, nothing else', () => {
    const seed = 4242;
    for (const [cx, cz] of [[15, 15], [16, 15], [15, 16], [16, 16]]) {
      const d = g.generateChunk(seed, cx, cz);
      for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
        const { h } = column2(seed, cx * CS + lx, cz * CS + lz);
        for (let y = 0; y < h; y++) expect(SOLID[d[CI(lx, y, lz)]], `${lx},${y},${lz} in ${cx},${cz}`).toBe(1);
        for (let y = h; y < H; y++) {
          const b = d[CI(lx, y, lz)];
          // above the ground: the sea, and trees
          if (y < g.seaLevel) expect(b).toBe(WATER);
          else if (b !== AIR) expect(B[b].name === 'Log' || B[b].name === 'Leaves').toBe(true);
        }
      }
    }
    // across a chunk border the ground goes on as smoothly as inside a chunk
    let across = 0, within = 0;
    for (let z = 240; z < 272; z++) {
      across = Math.max(across, Math.abs(column2(seed, 255, z).h - column2(seed, 256, z).h));
      within = Math.max(within, Math.abs(column2(seed, 250, z).h - column2(seed, 251, z).h));
    }
    expect(across).toBeLessThanOrEqual(Math.max(3, within + 2));
  });
});
