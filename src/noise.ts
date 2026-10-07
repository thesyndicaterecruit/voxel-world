// Seeded hashing, PRNG and value noise. Pass ?seed=123 (or #seed=123) in the URL for a fixed world.
const sm = /[?&#]seed=(\d+)/.exec(location.href);
export const SEED = sm ? (+sm[1] | 0) : (Math.random() * 2147483647) | 0;

export function hash2(x: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(SEED, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const hash3 = (x: number, y: number, z: number) => hash2(x + Math.imul(y, 7919), z + Math.imul(y, 31337));

export function mulberry(a: number): () => number {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * World PRNG. Shared by world generation and clouds, so the order of calls
 * (trees first, then clouds) is part of what a seed produces.
 */
export const rand = mulberry(SEED ^ 0x5bd1e995);

export const sstep = (t: number) => t * t * (3 - 2 * t);

export function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = sstep(x - ix), fz = sstep(z - iz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export const fbm = (x: number, z: number) =>
  vnoise(x, z) * 0.55 + vnoise(x * 2.03 + 17.3, z * 2.03 - 9.1) * 0.3 + vnoise(x * 4.1 - 5.7, z * 4.1 + 23.9) * 0.15;
