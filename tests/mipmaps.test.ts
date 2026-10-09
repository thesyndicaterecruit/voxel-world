import { describe, expect, it } from 'vitest';
import { coverageMips, bleedColors } from '../src/mipmaps';

const S = 32;
/** A leaves-like tile: clusters of opaque texels with clear gaps between them (about 37% opaque) */
function sparseTile(): Uint8Array {
  const t = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = Math.sin(x * 0.8 + 1.3) + Math.sin(y * 1.1 + 0.4) + Math.sin((x + y) * 0.55) + 0.6 * Math.sin((x - 2 * y) * 0.9);
    t.set(v > 0.5 ? [40, 150, 30, 255] : [0, 0, 0, 0], (y * S + x) * 4);
  }
  return t;
}
const coverage = (t: Uint8Array) => { let n = 0; for (let i = 3; i < t.length; i += 4) if (t[i] >= 128) n++; return n / (t.length / 4); };

describe('alpha-aware mipmaps', () => {
  it('makes every level down to 1×1', () => {
    expect(coverageMips(sparseTile(), S).map((l) => Math.sqrt(l.length / 4))).toEqual([16, 8, 4, 2, 1]);
  });

  it('keeps the share of texels that pass the alpha test, where plain averaging loses the leaves', () => {
    const tile = sparseTile(), target = coverage(tile), levels = coverageMips(tile, S);
    for (const l of levels.slice(0, 3)) {               // 16², 8², 4²
      expect(coverage(l)).toBeGreaterThanOrEqual(target);
      expect(coverage(l)).toBeLessThan(target + 0.12);
    }
    // plain 2×2 averages of alpha, for comparison: by 4×4 almost nothing passes the test any more
    let a = tile, s = S;
    while (s > 4) {
      const h = s >> 1, b = new Uint8Array(h * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) {
        let v = 0;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) v += a[((2 * y + dy) * s + 2 * x + dx) * 4 + 3];
        b[(y * h + x) * 4 + 3] = v / 4;
      }
      a = b; s = h;
    }
    expect(coverage(a)).toBeLessThan(target / 2);
  });

  it('colours clear texels like their neighbours, without making them visible', () => {
    const t = new Uint8Array(S * S * 4);
    t.set([200, 100, 50, 255], (5 * S + 5) * 4);
    bleedColors(t, S);
    expect([...t.subarray((5 * S + 6) * 4, (5 * S + 6) * 4 + 4)]).toEqual([200, 100, 50, 0]);
    expect(t[(20 * S + 20) * 4 + 3]).toBe(0);
  });
});
