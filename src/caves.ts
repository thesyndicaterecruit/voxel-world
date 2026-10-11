import { CS, H, W, D, CI, NCX, NCZ } from './config';
import { AIR, WATER, ICE, STONE, BEDROCK, GLOW_CRYSTAL, COAL_ORE, COPPER_ORE, IRON_ORE, GOLD_ORE } from './blocks';
import { hash2, hash3, vnoise, vnoise3 } from './noise';
import { islands } from './biomes';

/* ============================ UNDERGROUND ============================ */
// Generator 2's caves, caverns, glow crystals and ore veins. Pure: everything comes from hashes and
// noise of the seed and world coordinates. A world's cave network — worm tunnels and caverns — is
// worked out once per seed and thread (network()), as ellipsoids filed under every chunk they reach
// into, so a chunk carves just its own and whatever crosses a chunk or section border is carved the
// same from both sides. Glow crystals grow in patches (3D noise) on the walls of the deep caverns.
// Ore veins are small random walks started per chunk; a chunk walks its neighbours' veins too and
// keeps the blocks that land in it.

const K_WORM = 0x2b7e1516, K_WX = 0x28aed2a6, K_WY = 0x7f6a0d6b, K_WZ = 0x3c4fcec1, K_WR = 0x5be0cd19, K_CAV = 0x510e527f;
const K_CRY = 0x1f83d9ab, K_ORE = 0x6a09e667, K_STEP = 0x3f84d5b5;
/** Worms start in cells of this many blocks */
const WCELL = 32;

/** A world's caves: per chunk (index cx + cz·NCX), its carving ellipsoids (x, y, z, rx, ry, rz each), and those of deep caverns, whose walls grow crystals */
export interface CaveNet { carve: Map<number, number[]>; crystals: Map<number, number[]> }

/** What the cave network needs to know about the ground: how high column (x, z) is, and how far inland (coast distance) */
export interface Ground { height(x: number, z: number): number; inland(x: number, z: number): number }

let netSeed = NaN, net: CaveNet = { carve: new Map(), crystals: new Map() };

/** File an ellipsoid under every chunk its box reaches (in `to`: what it carves, or a deep cavern's walls for crystals) */
export function fileShape(n: CaveNet, x: number, y: number, z: number, rx: number, ry: number, rz: number, to = n.carve): void {
  const c0 = Math.max(0, Math.floor((x - rx - 1) / CS)), c1 = Math.min(NCX - 1, Math.floor((x + rx + 1) / CS));
  const d0 = Math.max(0, Math.floor((z - rz - 1) / CS)), d1 = Math.min(NCZ - 1, Math.floor((z + rz + 1) / CS));
  for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) {
    const k = cx + cz * NCX;
    let l = to.get(k);
    if (!l) to.set(k, (l = []));
    l.push(x, y, z, rx, ry, rz);
  }
}

/**
 * A worm tunnel from (x, y, z): about `steps` steps of 1.2 blocks, turning smoothly, mostly level,
 * 1.3–2.7 blocks wide. `into`: the way it sets off (into a hillside, slowly going down), else any way.
 */
function worm(n: CaveNet, seed: number, k: number, x: number, y: number, z: number, steps: number, into: number[] | null = null): void {
  let dx = into ? into[0] : hash2(seed ^ K_WX, k, 1) - 0.5, dz = into ? into[1] : hash2(seed ^ K_WZ, k, 1) - 0.5;
  let dy = into ? -0.18 : (hash2(seed ^ K_WY, k, 1) - 0.5) * 0.3;
  for (let s = 0; s < steps; s++) {
    const r = 1.3 + 1.4 * vnoise(seed ^ K_WR, k * 7.31, s / 9);
    fileShape(n, x, y, z, r, r * 0.85, r);
    const turn = into && s < 8 ? 0.1 : 0.45;                       // an entrance heads straight in at first
    dx += (vnoise(seed ^ K_WX, k * 3.17, s / 7) - 0.5) * turn;
    dz += (vnoise(seed ^ K_WZ, k * 3.17, s / 7) - 0.5) * turn;
    dy = (into && s < 14 ? dy : dy * 0.85) + (vnoise(seed ^ K_WY, k * 3.17, s / 7) - 0.5) * 0.22;
    if (y < 8) dy = Math.abs(dy) + 0.05;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= l; dy /= l; dz /= l;
    x += dx * 1.2; y += dy * 1.2; z += dz * 1.2;
    if (x < 2 || z < 2 || x > W - 3 || z > D - 3 || y > H - 4) return;
  }
}

/** The seed's cave network (worked out once per seed and thread) */
export function network(seed: number, ground: Ground, seaLevel: number): CaveNet {
  if (seed === netSeed) return net;
  const n: CaveNet = { carve: new Map(), crystals: new Map() };
  let k = 0;
  // caverns: deep under the bigger islands (two under the biggest); tunnels lead off them, and the
  // deepest have glow crystals on their walls
  const caverns: [number, number, number, number][] = [];
  for (const isl of islands(seed).list) {
    if (isl.r < 16) continue;
    for (let j = 0; j < (isl.r > 30 ? 2 : 1); j++) caverns.push([isl.x, isl.z, isl.r, isl.gx * 8 + isl.gz * 64 + j]);
  }
  for (const [ix, iz, ir, id] of caverns) {
    const r = (a: number, b: number) => hash2(seed ^ K_CAV, id + a, b);
    const x = ix + (r(5, 0) - 0.5) * 0.7 * ir, z = iz + (r(0, 5) - 0.5) * 0.7 * ir;
    if (ground.inland(x, z) < 10) continue;                       // not under the sea or a beach
    const y = 12 + r(9, 0) * 16;
    // three ellipsoids, the main one and two smaller lobes beside it
    const e: number[] = [];
    const lobe = (ox: number, oy: number, oz: number, s: number, j: number) =>
      e.push(x + ox, y + oy, z + oz, s * (7 + r(j, 11) * 6), s * (4 + r(j, 13) * 3), s * (7 + r(j, 15) * 6));
    lobe(0, 0, 0, 1, 0);
    lobe((r(0, 21) - 0.5) * 14, 2, (r(21, 0) - 0.5) * 14, 0.7, 1);
    lobe((r(0, 23) - 0.5) * 16, -1, (r(23, 0) - 0.5) * 16, 0.6, 2);
    for (let i = 0; i < e.length; i += 6) {
      fileShape(n, e[i], e[i + 1], e[i + 2], e[i + 3], e[i + 4], e[i + 5]);
      if (y <= 26) fileShape(n, e[i], e[i + 1], e[i + 2], e[i + 3], e[i + 4], e[i + 5], n.crystals);   // deep: crystals on its walls
    }
    for (let j = 0; j < 3; j++) worm(n, seed, 100000 + k++, x, y + 2, z, 70 + Math.floor(hash2(seed ^ K_WORM, id * 7 + j, 0) * 60));
  }
  // worm tunnels: one in most cells, deep down; now and then one sets off into a hillside: an entrance
  for (let gz = 0; gz < D / WCELL; gz++) for (let gx = 0; gx < W / WCELL; gx++) {
    const r = hash2(seed ^ K_WORM, gx, gz);
    if (r > 0.6) continue;
    const x = gx * WCELL + hash2(seed ^ K_WORM, gx + 3, gz) * WCELL, z = gz * WCELL + hash2(seed ^ K_WORM, gx, gz + 3) * WCELL;
    const fx = Math.floor(x), fz = Math.floor(z), h = ground.height(fx, fz);
    if (r < 0.16 && h >= seaLevel + 4) {
      // uphill, where the ground slopes enough to have a side to go in at
      const ux = ground.height(fx + 3, fz) - ground.height(fx - 3, fz), uz = ground.height(fx, fz + 3) - ground.height(fx, fz - 3), l = Math.sqrt(ux * ux + uz * uz);
      if (l >= 3) worm(n, seed, k++, x, h + 0.5, z, 60 + Math.floor(r * 400), [ux / l, uz / l]);
    } else if (h >= seaLevel - 4) worm(n, seed, k++, x, 10 + hash2(seed ^ K_WORM, gx + 7, gz) * (h - 18), z, 60 + Math.floor(hash2(seed ^ K_WORM, gx, gz + 7) * 80));
  }
  netSeed = seed; net = n;
  return n;
}

/**
 * Carve chunk (cx, cz)'s caves into `data` and grow crystals on the walls of its deep caverns. `dry`
 * holds per column (lx + CS·lz) the height caves stay below there: 2 blocks under any water around,
 * so the sea and lakes never leak into them.
 */
export function carveCaves(seed: number, n: CaveNet, data: Uint8Array, cx: number, cz: number, dry: Int16Array): void {
  const x0 = cx * CS, z0 = cz * CS, list = n.carve.get(cx + cz * NCX);
  if (list) for (let e = 0; e < list.length; e += 6) {
    const ex = list[e], ey = list[e + 1], ez = list[e + 2], rx = list[e + 3], ry = list[e + 4], rz = list[e + 5];
    const ax = Math.max(x0, Math.ceil(ex - rx - 0.5)), bx = Math.min(x0 + CS - 1, Math.floor(ex + rx - 0.5));
    const az = Math.max(z0, Math.ceil(ez - rz - 0.5)), bz = Math.min(z0 + CS - 1, Math.floor(ez + rz - 0.5));
    const ay = Math.max(1, Math.ceil(ey - ry - 0.5)), by = Math.min(H - 1, Math.floor(ey + ry - 0.5));
    for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) {
      const c = (x - x0) + CS * (z - z0), top = Math.min(by, dry[c] - 1);
      const u = (x + 0.5 - ex) / rx, w = (z + 0.5 - ez) / rz, uw = u * u + w * w;
      if (uw > 1) continue;
      for (let y = ay; y <= top; y++) {
        const v = (y + 0.5 - ey) / ry;
        if (uw + v * v > 1) continue;
        const i = CI(x - x0, y, z - z0), b = data[i];
        if (b !== AIR && b !== WATER && b !== ICE && b !== BEDROCK) data[i] = AIR;
      }
    }
  }
  // crystals: in patches on a deep cavern's walls (rock next to the cavern's air, in this chunk)
  const cr = n.crystals.get(cx + cz * NCX);
  if (cr) for (let e = 0; e < cr.length; e += 6) {
    const ex = cr[e], ey = cr[e + 1], ez = cr[e + 2], rx = cr[e + 3] + 1, ry = cr[e + 4] + 1, rz = cr[e + 5] + 1;
    for (let x = Math.max(x0, Math.floor(ex - rx)); x <= Math.min(x0 + CS - 1, Math.ceil(ex + rx)); x++) {
      for (let z = Math.max(z0, Math.floor(ez - rz)); z <= Math.min(z0 + CS - 1, Math.ceil(ez + rz)); z++) {
        for (let y = Math.max(2, Math.floor(ey - ry)); y <= Math.ceil(ey + ry); y++) {
          const u = (x + 0.5 - ex) / rx, v = (y + 0.5 - ey) / ry, w = (z + 0.5 - ez) / rz;
          if (u * u + v * v + w * w > 1) continue;
          const lx = x - x0, lz = z - z0, i = CI(lx, y, lz), b = data[i];
          if (b === AIR || b === WATER || b === ICE || b === BEDROCK || b === GLOW_CRYSTAL || vnoise3(seed ^ K_CRY, x / 2.5, y / 2.5, z / 2.5) < 0.8) continue;
          if ((lx > 0 && data[i - 1] === AIR) || (lx < CS - 1 && data[i + 1] === AIR) || (lz > 0 && data[i - CS] === AIR) ||
            (lz < CS - 1 && data[i + CS] === AIR) || data[i - CS * CS] === AIR || data[i + CS * CS] === AIR) data[i] = GLOW_CRYSTAL;
        }
      }
    }
  }
}

/* ---------- ore veins ---------- */
/** id, veins per chunk, blocks per vein (a walk this long), lowest and highest y */
const ORES: [number, number, number, number, number][] = [
  [COAL_ORE, 20, 12, 16, 96], [COPPER_ORE, 8, 8, 12, 64], [IRON_ORE, 7, 7, 6, 56], [GOLD_ORE, 2, 5, 4, 28],
];
/** Put chunk (cx, cz)'s ore into its stone: the veins started in it and in its 8 neighbours, the blocks of them that land in it */
export function placeOres(seed: number, data: Uint8Array, cx: number, cz: number): void {
  const x0 = cx * CS, z0 = cz * CS;
  for (let nz = cz - 1; nz <= cz + 1; nz++) for (let nx = cx - 1; nx <= cx + 1; nx++) {
    for (let o = 0; o < ORES.length; o++) {
      const [id, veins, len, lo, hi] = ORES[o];
      for (let v = 0; v < veins; v++) {
        const s = seed ^ (K_ORE + o * 0x9e3779b9);
        let x = nx * CS + Math.floor(hash3(s, nx, v, nz) * CS), z = nz * CS + Math.floor(hash3(s, nx, v + 64, nz) * CS);
        let y = lo + Math.floor(hash3(s, nx, v + 128, nz) * (hi - lo));
        for (let j = 0; j < len; j++) {
          const lx = x - x0, lz = z - z0;
          if (lx >= 0 && lz >= 0 && lx < CS && lz < CS && y > 0 && y < H) {
            const i = CI(lx, y, lz);
            if (data[i] === STONE) data[i] = id;
          }
          const r = Math.floor(hash3(s ^ K_STEP, nx * 64 + v, j, nz) * 6);
          if (r === 0) x++; else if (r === 1) x--; else if (r === 2) z++; else if (r === 3) z--; else if (r === 4) y++; else y--;
        }
      }
    }
  }
}
