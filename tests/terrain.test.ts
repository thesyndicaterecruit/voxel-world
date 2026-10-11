import { describe, expect, it } from 'vitest';
import { CS, CI, H, W, D, NCX, NCZ, CHUNK_VOL } from '../src/config';
import { AIR, WATER, ICE, SNOW, OBSIDIAN, GLOW_CRYSTAL, COAL_ORE, COPPER_ORE, IRON_ORE, GOLD_ORE, STONE, LOG, LEAVES, TERRACOTTA, OPAQUE } from '../src/blocks';
import { generator, column2, newCol, SEA_LEVEL as S } from '../src/gen';
import { islands, biomeAt, SNOWY_PEAKS, BADLANDS, DESERT, SWAMP, VOLCANIC, DEEP_OCEAN, WARM_REEF } from '../src/biomes';
import { carveCaves, fileShape, type CaveNet } from '../src/caves';

// Generator 2's ground, seen whole: two seeds' worlds generated chunk by chunk (each kept for the
// tests below), and what their columns say.
const g = generator(2), SEEDS = [4242, 777];
const worlds = new Map<number, Uint8Array[]>();
function chunks(seed: number): Uint8Array[] {
  let w = worlds.get(seed);
  if (!w) {
    w = [];
    for (let cz = 0; cz < NCZ; cz++) for (let cx = 0; cx < NCX; cx++) w.push(g.generateChunk(seed, cx, cz));
    worlds.set(seed, w);
  }
  return w;
}
/** The block at (x, y, z) of seed's world (stone outside it) */
const at = (seed: number, x: number, y: number, z: number) =>
  x < 0 || z < 0 || x >= W || z >= D || y < 0 || y >= H ? STONE : chunks(seed)[(x >> 4) + (z >> 4) * NCX][CI(x & 15, y, z & 15)];
/** Every column of seed's world: x, z and column2's answer (a reused object) */
function columns(seed: number, f: (x: number, z: number, c: ReturnType<typeof newCol>) => void): void {
  const c = newCol();
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) f(x, z, column2(seed, x, z, c));
}
const SIX = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

describe('generator 2: landforms', { timeout: 120000 }, () => {
  it('raises jagged snowy peaks toward y = 120, white above the snow line and rock on their steep faces', () => {
    for (const seed of SEEDS) {
      let top = 0, snow = 0, rock = 0;
      columns(seed, (x, z, c) => {
        if (c.biome !== SNOWY_PEAKS) return;
        top = Math.max(top, c.h);
        let y = H - 1;
        while (y > 0 && at(seed, x, y, z) === AIR) y--;
        if (y >= 82) { if (at(seed, x, y, z) === SNOW) snow++; else if (at(seed, x, y, z) === STONE) rock++; }
      });
      expect(top, `seed ${seed}`).toBeGreaterThanOrEqual(110);
      expect(snow).toBeGreaterThan(300);
      expect(rock).toBeGreaterThan(100);
    }
  });

  it('builds the badlands of flat-topped mesas, their sides stepped in terraces of terracotta bands', () => {
    for (const seed of SEEDS) {
      // neighbouring mesa columns are level or a terrace apart, seldom a block or two
      let flat = 0, small = 0, big = 0;
      const colours = new Set<number>(), all = new Set<number>(), c2 = newCol();
      columns(seed, (x, z, c) => {
        if (c.biome !== BADLANDS || biomeAt(seed, x, z) !== BADLANDS || c.h <= S + 3 || c.lean > 0) return;
        const d = Math.abs(column2(seed, x + 1, z, c2).h - c.h);
        if (d === 0) flat++; else if (d <= 2) small++; else big++;
        for (let y = S; y < c.h; y++) {
          const b = at(seed, x, y, z);
          if (b < TERRACOTTA || b >= TERRACOTTA + 6) continue;
          all.add(b);
          if (SIX.some(([dx, dy, dz]) => !dy && at(seed, x + dx, y, z + dz) === AIR)) colours.add(b);
        }
      });
      expect(flat, `seed ${seed}`).toBeGreaterThan(5 * small);
      expect(big).toBeGreaterThan(20);
      expect(all.size).toBe(6);                                        // bands of all six colours
      expect(colours.size).toBeGreaterThanOrEqual(4);                  // most of them showing on the faces
    }
  });

  it('heaps the desert into dunes, keeps the swamp low with pools, gives the volcano a crater', () => {
    for (const seed of SEEDS) {
      let dLo = H, dHi = 0, swamp = 0, low = 0, pools = 0, obsidian = 0;
      columns(seed, (x, z, c) => {
        if (biomeAt(seed, x, z) === DESERT && c.biome === DESERT && c.t > 8) { dLo = Math.min(dLo, c.h); dHi = Math.max(dHi, c.h); }
        if (biomeAt(seed, x, z) === SWAMP && c.biome === SWAMP && c.t > 4) { swamp++; if (c.h <= S + 2) low++; if (c.h < S) pools++; }
      });
      for (const ch of chunks(seed)) for (let i = 0; i < CHUNK_VOL; i++) if (ch[i] === OBSIDIAN) obsidian++;
      expect(dHi - dLo, `seed ${seed}: dunes`).toBeGreaterThanOrEqual(5);
      expect(low / swamp).toBeGreaterThan(0.8);                        // (where it meets hills, it rises to meet them)
      expect(pools).toBeGreaterThan(10);
      expect(obsidian).toBeGreaterThan(20);                           // the crater's floor (lava comes later)
      // the crater: the island's middle is below the top of its rim
      const v = islands(seed).list.find((i) => i.primary === VOLCANIC)!, c = newCol();
      let rim = 0;
      for (let a = 0; a < 64; a++) {
        const dx = ((a % 8) - 3.5) / 3.5, dz = (Math.floor(a / 8) - 3.5) / 3.5;
        rim = Math.max(rim, column2(seed, Math.round(v.x + dx * v.r * 0.5), Math.round(v.z + dz * v.r * 0.5), c).h);
      }
      expect(column2(seed, Math.round(v.x), Math.round(v.z), c).h).toBeLessThan(rim - 3);
    }
  });

  it('gives the deep ocean trenches and the warm reef sandbars that break the surface', () => {
    for (const seed of SEEDS) {
      let deepest = H, bars = 0;
      columns(seed, (x, z, c) => {
        if (c.biome === DEEP_OCEAN) deepest = Math.min(deepest, c.h);
        if (c.biome === WARM_REEF && c.h >= S && !c.rock && at(seed, x, c.h - 1, z) !== STONE) bars++;
      });
      expect(deepest, `seed ${seed}`).toBeLessThanOrEqual(S - 30);
      expect(bars).toBeGreaterThan(10);
    }
  });
});

describe('generator 2: coasts', { timeout: 120000 }, () => {
  it('has sea cliffs on some islands and beaches on the others, the start island among them', () => {
    for (const seed of [4242, 777, 123, 1, 99]) {
      const list = islands(seed).list, mid = list.find((i) => i.gx === 2 && i.gz === 2)!;
      expect(list.filter((i) => i.cliff > 0).length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      expect(list.filter((i) => i.cliff === 0).length).toBeGreaterThanOrEqual(5);
      expect(mid.cliff).toBe(0);
    }
  });

  it('stands sea stacks off the cliffs, and arches from some of them back to the cliff', () => {
    for (const seed of SEEDS) {
      let stacks = 0, arches = 0;
      columns(seed, (x, z, c) => {
        if (c.rock && c.h >= S + 5 && c.t < -3) stacks++;
        // an arch: the sea under it, open air above the water, then rock
        if (c.hi > c.lo && c.lo > S && c.h < S && at(seed, x, S - 1, z) === WATER && at(seed, x, S, z) === AIR && OPAQUE[at(seed, x, c.lo, z)]) arches++;
      });
      expect(stacks, `seed ${seed}`).toBeGreaterThan(100);
      expect(arches).toBeGreaterThan(10);
    }
  });

  it('leans cliffs and mountainsides out into overhangs', () => {
    for (const seed of SEEDS) {
      let over = 0;
      columns(seed, (x, z, c) => {
        if (c.lean < 1) return;
        for (let y = S + 2; y < H - 1; y++) {
          const above = at(seed, x, y + 1, z);
          if (at(seed, x, y, z) === AIR && OPAQUE[above] && above !== LOG && y + 1 < c.h + 4) over++;
        }
      });
      expect(over, `seed ${seed}`).toBeGreaterThan(300);
    }
  });
});

describe('generator 2: underground', { timeout: 120000 }, () => {
  it('has caves: tunnels and caverns, and some open on a hillside', () => {
    for (const seed of SEEDS) {
      let cave = 0, openings = 0;
      columns(seed, (x, z, c) => {
        for (let y = 1; y < c.h - 3; y++) if (at(seed, x, y, z) === AIR) cave++;
        if (c.h >= S + 4 && c.lean === 0 && !c.rock) {
          let y = H - 1;
          while (y > 0 && at(seed, x, y, z) === AIR) y--;
          if (y < c.h - 2 && at(seed, x, y + 1, z) === AIR) openings++;
        }
      });
      expect(cave, `seed ${seed}`).toBeGreaterThan(50000);
      expect(openings).toBeGreaterThan(20);
    }
  });

  it('never lets the sea in: below sea level no cave touches water, across chunk borders too', () => {
    for (const seed of SEEDS) {
      let leaks = 0, checked = 0;
      for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) for (let y = 1; y < S; y++) {
        if (at(seed, x, y, z) !== AIR) continue;
        checked++;
        for (const [dx, dy, dz] of SIX) if (at(seed, x + dx, y + dy, z + dz) === WATER) leaks++;
      }
      expect(checked, `seed ${seed}`).toBeGreaterThan(10000);       // plenty of cave down there
      expect(leaks).toBe(0);
    }
  });

  it('carves a cave the same from both sides of a chunk border and a section border', () => {
    const net: CaveNet = { carve: new Map(), crystals: new Map() };
    const [ex, ey, ez, rx, ry, rz] = [CS * 5 - 0.3, 31.7, CS * 7 + 6.2, 3.4, 2.6, 2.9];   // across x = 80 and y = 32
    fileShape(net, ex, ey, ez, rx, ry, rz);
    expect([...net.carve.keys()].sort((a, b) => a - b)).toEqual([4 + 7 * NCX, 5 + 7 * NCX]);
    const dry = new Int16Array(CS * CS).fill(H);
    for (const cx of [4, 5]) {
      const data = new Uint8Array(CHUNK_VOL).fill(STONE);
      carveCaves(1, net, data, cx, 7, dry);
      for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) for (let y = 0; y < H; y++) {
        const x = cx * CS + lx + 0.5, z = 7 * CS + lz + 0.5, u = (x - ex) / rx, v = (y + 0.5 - ey) / ry, w = (z - ez) / rz;
        expect(data[CI(lx, y, lz)], `${x},${y},${z}`).toBe(u * u + v * v + w * w <= 1 ? AIR : STONE);
      }
    }
  });

  it('puts ore in veins at their depths: coal the most, gold the least and deepest', () => {
    for (const seed of SEEDS) {
      const ores = [COAL_ORE, COPPER_ORE, IRON_ORE, GOLD_ORE], n = [0, 0, 0, 0], top = [0, 0, 0, 0], joined = [0, 0, 0, 0];
      for (let z = 0; z < D; z += 2) for (let x = 0; x < W; x++) for (let y = 1; y < H; y++) {
        const k = ores.indexOf(at(seed, x, y, z));
        if (k < 0) continue;
        n[k]++; top[k] = Math.max(top[k], y);
        if (SIX.some(([dx, dy, dz]) => at(seed, x + dx, y + dy, z + dz) === ores[k])) joined[k]++;
      }
      expect(n[0], `seed ${seed}`).toBeGreaterThan(n[1]);
      expect(Math.min(n[1], n[2])).toBeGreaterThan(n[3]);
      expect(n[3]).toBeGreaterThan(500);
      expect(top).toEqual([expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)]);
      expect(top[0]).toBeLessThanOrEqual(96 + 12);                   // each within its range, give or take a vein
      expect(top[1]).toBeLessThanOrEqual(64 + 8);
      expect(top[2]).toBeLessThanOrEqual(56 + 7);
      expect(top[3]).toBeLessThanOrEqual(28 + 5);
      for (let k = 0; k < 4; k++) expect(joined[k] / n[k]).toBeGreaterThan(0.6);   // in clusters, not scattered
    }
  });

  it('puts glow crystals on the walls of deep caverns, and nowhere else', () => {
    for (const seed of SEEDS) {
      let crystals = 0, high = 0, buried = 0;
      chunks(seed).forEach((ch, k) => {
        for (let i = CS * CS; i < CHUNK_VOL; i++) {
          if (ch[i] !== GLOW_CRYSTAL) continue;
          const x = (k % NCX) * CS + (i & 15), z = Math.floor(k / NCX) * CS + ((i >> 4) & 15), y = i >> 8;
          crystals++;
          if (y > 40) high++;
          if (!SIX.some(([dx, dy, dz]) => at(seed, x + dx, y + dy, z + dz) === AIR)) buried++;
        }
      });
      expect(crystals, `seed ${seed}`).toBeGreaterThan(50);
      expect([high, buried]).toEqual([0, 0]);
    }
  });

  it('keeps the sea and the ice where they belong, and trees on the ground', () => {
    for (const seed of SEEDS) {
      let wrong = 0;
      for (const ch of chunks(seed)) for (let i = 0; i < CHUNK_VOL; i++) {
        const b = ch[i], y = (i / (CS * CS)) | 0;
        if ((b === WATER && y >= S) || (b === ICE && y !== S - 1) || ((b === LEAVES || b === LOG) && y <= S)) wrong++;
      }
      expect(wrong, `seed ${seed}`).toBe(0);
    }
  });
});
