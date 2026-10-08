// Seeded hashing, PRNG and value noise. Everything takes the world seed explicitly, so the same calls
// give the same answers on the main thread and in workers, in any order.

export function hash2(seed: number, x: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const hash3 = (seed: number, x: number, y: number, z: number) =>
  hash2(seed, x + Math.imul(y, 7919), z + Math.imul(y, 31337));

export function mulberry(a: number): () => number {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sstep = (t: number) => t * t * (3 - 2 * t);

export function vnoise(seed: number, x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = sstep(x - ix), fz = sstep(z - iz);
  const a = hash2(seed, ix, iz), b = hash2(seed, ix + 1, iz), c = hash2(seed, ix, iz + 1), d = hash2(seed, ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export const fbm = (seed: number, x: number, z: number) =>
  vnoise(seed, x, z) * 0.55 + vnoise(seed, x * 2.03 + 17.3, z * 2.03 - 9.1) * 0.3 + vnoise(seed, x * 4.1 - 5.7, z * 4.1 + 23.9) * 0.15;

/** Seed from ?seed=123 (or #seed=123) in the page URL, if there is one. */
export function urlSeed(): number | null {
  const m = /[?&#]seed=(\d+)/.exec(location.href);
  return m ? (+m[1] | 0) : null;
}
export const randomSeed = () => (Math.random() * 2147483647) | 0;
