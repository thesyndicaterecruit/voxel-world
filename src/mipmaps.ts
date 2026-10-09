/* ======================= ALPHA-AWARE MIPMAPS ======================= */
// Cutout tiles are alpha-tested at 0.5. Plain box-filtered mipmaps average alpha, which pushes most
// texels of a sparse tile below the cutoff, so leaves and glass frames thin out and vanish in the
// distance. These mip levels keep the share of texels that pass the alpha test the same as in the
// full-size tile (coverage-preserving mipmaps, after Castaño), and average colour weighted by alpha
// so transparent texels don't darken the edges. Pure functions on square RGBA tiles.

const CUTOFF = 128;

/** Share of texels whose alpha, scaled by `s`, passes the alpha test. */
function coverage(a: Float32Array, s: number): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] * s >= CUTOFF) n++;
  return n / a.length;
}

/**
 * Mip levels 1..log2(size) of a size×size RGBA tile (level 0 is `rgba` itself), each with alpha
 * rescaled so the same share of texels passes the alpha test as at level 0.
 */
export function coverageMips(rgba: Uint8Array, size: number): Uint8Array[] {
  let s = size, a = new Float32Array(s * s), rgb = new Float32Array(s * s * 3);
  for (let i = 0; i < s * s; i++) { a[i] = rgba[i * 4 + 3]; rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
  const target = coverage(a, 1), levels: Uint8Array[] = [];
  while (s > 1) {
    // box-filter the unscaled chain; colour weighted by alpha (plain average where all four are clear)
    const h = s >> 1, a2 = new Float32Array(h * h), rgb2 = new Float32Array(h * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) {
      const q = [(2 * y) * s + 2 * x, (2 * y) * s + 2 * x + 1, (2 * y + 1) * s + 2 * x, (2 * y + 1) * s + 2 * x + 1];
      let sa = 0;
      for (const i of q) sa += a[i];
      const o = y * h + x;
      a2[o] = sa / 4;
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (const i of q) v += rgb[i * 3 + c] * (sa > 0 ? a[i] / sa : 0.25);
        rgb2[o * 3 + c] = v;
      }
    }
    // smallest alpha scale that brings coverage back up to the level-0 share
    let lo = 0, hi = 64;
    if (coverage(a2, hi) < target) lo = hi;
    else for (let it = 0; it < 24; it++) { const m = (lo + hi) / 2; if (coverage(a2, m) >= target) hi = m; else lo = m; }
    const scale = coverage(a2, hi) >= target ? hi : lo, out = new Uint8Array(h * h * 4);
    for (let i = 0; i < h * h; i++) {
      out[i * 4] = Math.round(rgb2[i * 3]); out[i * 4 + 1] = Math.round(rgb2[i * 3 + 1]); out[i * 4 + 2] = Math.round(rgb2[i * 3 + 2]);
      out[i * 4 + 3] = Math.min(255, Math.round(a2[i] * scale));
    }
    levels.push(out);
    s = h; a = a2; rgb = rgb2;
  }
  return levels;
}

/**
 * Give fully transparent texels the average colour of their non-transparent neighbours, a few
 * rings deep, so texture filtering at the edges of cutouts doesn't pull in black. Alpha is left
 * as it is. Works in place on a size×size RGBA tile.
 */
export function bleedColors(rgba: Uint8Array, size: number, rings = 4): void {
  let known = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) known[i] = rgba[i * 4 + 3] > 0 ? 1 : 0;
  for (let r = 0; r < rings; r++) {
    const next = known.slice();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (known[i]) continue;
      let n = 0, cr = 0, cg = 0, cb = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = ((y + dy + size) % size) * size + ((x + dx + size) % size);   // tiles wrap
        if (!known[j]) continue;
        n++; cr += rgba[j * 4]; cg += rgba[j * 4 + 1]; cb += rgba[j * 4 + 2];
      }
      if (!n) continue;
      rgba[i * 4] = Math.round(cr / n); rgba[i * 4 + 1] = Math.round(cg / n); rgba[i * 4 + 2] = Math.round(cb / n);
      next[i] = 1;
    }
    known = next;
  }
}
