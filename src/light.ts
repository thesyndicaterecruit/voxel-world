import { CB, CS, H, CHUNK_VOL } from './config';
import { FILTER, EMIT } from './blocks';

/* ============================ LIGHT ============================ */
// Two channels per block, 0–15, packed into one byte: skylight in the high nibble, block light in
// the low one. Light is never saved; it is worked out again from the blocks. Pure (runs in workers).
//
// The rules, shared by the full computation and the incremental updates:
// - A block's light filter (FILTER) is what light loses entering it; 15 is opaque: no light gets in.
// - Skylight: the sky above the world shines 15 into the top layer. Straight down it only loses each
//   block's filter (open air stays 15 down to the ground; one layer of leaves leaves 14 under it); in
//   any other direction it loses max(1, filter) per block.
// - Block light: an emitting block (EMIT: a torch gives 14) starts with that much and loses
//   max(1, filter) per block in every direction.
// Light travels at most 15 blocks sideways, so a chunk's light depends only on the blocks of its 8
// neighbours: lightChunk() lights a chunk exactly from those 3×3 chunks (in a worker). After that,
// relight() keeps it up to date when a block changes: take out the light that depended on the old
// block, then spread light in again from the edge of the hole (the classic two-queue flood fill).

export const skyOf = (v: number) => v >> 4;
export const blockOf = (v: number) => v & 15;

/** Stand-in block for cells beyond what is being lit: dark, and light doesn't pass */
export const WALL = 255;
const FILT = FILTER.slice(), EM = EMIT.slice();
FILT[WALL] = 15;
const W = CS, HT = H, VOL = CHUNK_VOL;           // local copies for the hot loops
/** Light lost entering a block with filter f: skylight falling straight down loses just the filter */
const loss = (f: number, fall: boolean) => (fall ? f : f > 1 ? f : 1);

/* ---------- lighting from scratch ---------- */
// Works on scratch arrays padded with one cell of wall all round (so neighbours need no bounds
// checks), reused from call to call: F filter, SK skylight, BL block light.
let F = new Uint8Array(0), SK = new Uint8Array(0), BL = new Uint8Array(0);
let LO = new Uint8Array(0), BOT = new Uint8Array(0);
const Q: number[][] = Array.from({ length: 16 }, () => []);
const emitters: number[] = [];

/** Get the scratch arrays ready for SX × SZ columns; fill() then sets F and BL inside the walls. */
function prepare(SX: number, SZ: number): void {
  const N = (SX + 2) * (SZ + 2) * (HT + 2);
  if (F.length < N) { F = new Uint8Array(N); SK = new Uint8Array(N); BL = new Uint8Array(N); }
  const C = (SX + 2) * (SZ + 2);
  if (LO.length < C) { LO = new Uint8Array(C); BOT = new Uint8Array(C); }
  F.fill(15, 0, N);
  emitters.length = 0;
}

/** Spread light in L from the queued cells, brightest first, so each cell settles at its final level. */
function spread(L: Uint8Array, PX: number, PL: number, fall: boolean): void {
  const step = [1, -1, PX, -PX, PL, -PL], f = F;   // +x −x +z −z +y −y (5: straight down)
  for (let lv = 15; lv > 0; lv--) {
    const b = Q[lv];
    for (let k = 0; k < b.length; k++) {
      const i = b[k];
      if (L[i] !== lv) continue;                   // raised since it was queued
      for (let d = 0; d < 6; d++) {
        const n = i + step[d], fn = f[n];
        if (fn >= 15) continue;
        const v = lv - loss(fn, fall && d === 5);
        if (v > L[n]) { L[n] = v; Q[v].push(n); }
      }
    }
    b.length = 0;
  }
}

/** Light the prepared, filled scratch arrays (SX × SZ columns). */
function solve(SX: number, SZ: number): void {
  const PX = SX + 2, PL = PX * (SZ + 2), F_ = F, sk = SK, lo_ = LO, bot_ = BOT;
  // skylight straight down each column; LO: where the open sky (15) ends, BOT: the lowest lit cell
  for (let z = 1; z <= SZ; z++) for (let x = 1; x <= SX; x++) {
    const c = x + PX * z;
    let v = 15, lo = HT, bot = HT;
    for (let y = HT - 1, i = c + PL * HT; y >= 0; y--, i -= PL) {
      const fi = F_[i];
      v = fi >= 15 ? 0 : v > fi ? v - fi : 0;
      sk[i] = v;
      if (v === 15) lo = y;
      if (v > 0) bot = y;
    }
    lo_[c] = lo; bot_[c] = bot;
  }
  // then sideways from wherever it is brighter than a neighbour can be: only between a column's
  // lowest lit cell and the height where it and its neighbours are all open sky
  for (let z = 1; z <= SZ; z++) for (let x = 1; x <= SX; x++) {
    const c = x + PX * z, top = Math.max(lo_[c], x > 1 ? lo_[c - 1] : 0, x < SX ? lo_[c + 1] : 0, z > 1 ? lo_[c - PX] : 0, z < SZ ? lo_[c + PX] : 0);
    for (let y = bot_[c], i = c + PL * (y + 1); y < top; y++, i += PL) {
      const v = sk[i];
      if (v < 2) continue;
      if ((F_[i + 1] < 15 && v - loss(F_[i + 1], false) > sk[i + 1]) || (F_[i - 1] < 15 && v - loss(F_[i - 1], false) > sk[i - 1]) ||
        (F_[i + PX] < 15 && v - loss(F_[i + PX], false) > sk[i + PX]) || (F_[i - PX] < 15 && v - loss(F_[i - PX], false) > sk[i - PX])) Q[v].push(i);
    }
  }
  spread(sk, PX, PL, true);
  // block light, from every emitting block
  for (const i of emitters) Q[BL[i]].push(i);
  spread(BL, PX, PL, false);
}

/**
 * Light a box of SX × SZ full-height columns (layout x + SX·(z + SZ·y)), as if nothing were around
 * it (cells outside are walls). Returns the packed light in the same layout.
 */
export function computeLight(blocks: Uint8Array, SX: number, SZ: number): Uint8Array {
  prepare(SX, SZ);
  const PX = SX + 2, PL = PX * (SZ + 2), f = F, bl = BL, sk = SK, flt = FILT, em = EM;
  for (let y = 0; y < HT; y++) for (let z = 0; z < SZ; z++) {
    const s = SX * (z + SZ * y), d = 1 + PX * (z + 1) + PL * (y + 1);
    for (let x = 0; x < SX; x++) {
      const id = blocks[s + x], e = em[id];
      f[d + x] = flt[id]; bl[d + x] = e;
      if (e > 1) emitters.push(d + x);
    }
  }
  solve(SX, SZ);
  const out = new Uint8Array(SX * SZ * HT);
  for (let y = 0; y < HT; y++) for (let z = 0; z < SZ; z++) {
    const s = 1 + PX * (z + 1) + PL * (y + 1), d = SX * (z + SZ * y);
    for (let x = 0; x < SX; x++) out[d + x] = (sk[s + x] << 4) | bl[s + x];
  }
  return out;
}

/**
 * Light of one chunk, from the blocks of it and its 8 neighbours: `blocks9` holds 9 chunks' data
 * (CI layout), chunk k at offset k·CHUNK_VOL being the neighbour at dx = k % 3 − 1, dz = ⌊k / 3⌋ − 1.
 * Bit k of `present` says whether that chunk exists (missing ones, beyond the world edge, are walls).
 */
export function lightChunk(blocks9: Uint8Array, present: number): Uint8Array {
  const S = W * 3, PX = S + 2, PL = PX * PX;
  prepare(S, S);
  const f = F, bl = BL, sk = SK, flt = FILT, em = EM;
  for (let k = 0; k < 9; k++) {
    if (!((present >> k) & 1)) continue;           // stays wall
    const ox = 1 + (k % 3) * W, oz = 1 + ((k / 3) | 0) * W, base = k * VOL;
    // chunk rows (CI layout: x, then z, then y) go to padded rows
    for (let y = 0, s = base; y < HT; y++) for (let z = 0; z < W; z++, s += W) {
      const d = ox + PX * (oz + z) + PL * (y + 1);
      for (let x = 0; x < W; x++) {
        const id = blocks9[s + x], e = em[id];
        f[d + x] = flt[id]; bl[d + x] = e;
        if (e > 1) emitters.push(d + x);
      }
    }
  }
  solve(S, S);
  const out = new Uint8Array(VOL);
  for (let y = 0, d = 0; y < HT; y++) for (let z = 0; z < W; z++, d += W) {
    const s = 1 + W + PX * (1 + W + z) + PL * (y + 1);
    for (let x = 0; x < W; x++) out[d + x] = (sk[s + x] << 4) | bl[s + x];
  }
  return out;
}

/* ---------- incremental updates ---------- */
/**
 * Where relight() finds blocks and light: chunk (cx, cz) (CI layout), or nothing / no light where
 * light isn't kept (beyond the world, chunks not lit yet), which it treats as walls.
 */
export interface LightWorld {
  chunk(cx: number, cz: number): { data: Uint8Array; light: Uint8Array | null } | undefined;
}

/** Key of a cell in relight's results: x and z below 512, y below 64 */
export const cellKey = (x: number, y: number, z: number) => x | (z << 9) | (y << 18);
export const keyX = (k: number) => k & 511, keyY = (k: number) => k >>> 18, keyZ = (k: number) => (k >> 9) & 511;

// relightMany() works in a box around the changed blocks: light changes at most 14 blocks from
// them sideways, so 16 blocks each way, full height, hold every cell that can change plus the cells
// around those. Copied in, padded with walls like computeLight's arrays (which grow as needed).
const BR = 16;
let bF = new Uint8Array(0), bE = new Uint8Array(0), bL = new Uint8Array(0), stamp = new Uint32Array(0);
const RQ: number[][] = Array.from({ length: 16 }, () => []);
const touched: number[] = [], before: number[] = [], rs: number[] = [];
let gen = 0;

/**
 * Update the light after the block at (x, y, z) changed from `oldId` to `newId` (already in place
 * in `w`). Writes the new light into the chunks and returns the keys of the cells that changed.
 * Call it only when everything within 16 blocks is lit: anything that isn't counts as a wall.
 */
export function relight(w: LightWorld, x: number, y: number, z: number, oldId: number, newId: number): number[] {
  return relightMany(w, [x, y, z, oldId, newId]);
}

/**
 * relight() for many changed blocks at once (`edits`: x, y, z, oldId, newId for each, all already in
 * place in `w`): one pass over one box around all of them, so keep them together (changes more than
 * 32 blocks apart can't affect each other's light: light them separately). Everything within 16
 * blocks of every change must be lit.
 */
export function relightMany(w: LightWorld, edits: number[]): number[] {
  const seeds: number[] = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let e = 0; e < edits.length; e += 5) {
    const o = edits[e + 3], n = edits[e + 4];
    if (FILT[o] === FILT[n] && EM[o] === EM[n]) continue;        // light can't notice
    seeds.push(e);
    x0 = Math.min(x0, edits[e]); x1 = Math.max(x1, edits[e]);
    z0 = Math.min(z0, edits[e + 2]); z1 = Math.max(z1, edits[e + 2]);
  }
  if (!seeds.length) return [];
  const bx = x0 - BR, bz = z0 - BR, SX = x1 - x0 + 1 + 2 * BR, SZ = z1 - z0 + 1 + 2 * BR;
  const PX = SX + 2, PL = PX * (SZ + 2), N = PL * (HT + 2);
  if (bF.length < N) { bF = new Uint8Array(N); bE = new Uint8Array(N); bL = new Uint8Array(N); stamp = new Uint32Array(N); gen = 0; }
  const F = bF, E = bE, B = bL, step = [1, -1, PX, -PX, PL, -PL];   // 5: straight down
  F.fill(15, 0, N); B.fill(0, 0, N);
  for (let cz = bz >> CB; cz <= (bz + SZ - 1) >> CB; cz++) for (let cx = bx >> CB; cx <= (bx + SX - 1) >> CB; cx++) {
    const c = w.chunk(cx, cz);
    if (!c || !c.light) continue;
    const ax = Math.max(bx, cx * W), ex = Math.min(bx + SX - 1, cx * W + W - 1);
    const az = Math.max(bz, cz * W), ez = Math.min(bz + SZ - 1, cz * W + W - 1), data = c.data, light = c.light;
    for (let yy = 0; yy < HT; yy++) for (let zz = az; zz <= ez; zz++) {
      const s = (ax - cx * W) + W * ((zz - cz * W) + W * yy), d = (ax - bx + 1) + PX * (zz - bz + 1) + PL * (yy + 1);
      for (let k = 0; k <= ex - ax; k++) { const id = data[s + k]; F[d + k] = FILT[id]; E[d + k] = EM[id]; B[d + k] = light[s + k]; }
    }
  }
  gen++;
  touched.length = 0; before.length = 0;
  const top = PL * HT, at = (e: number) => (edits[e] - bx + 1) + PX * (edits[e + 2] - bz + 1) + PL * (edits[e + 1] + 1);

  for (const sky of [true, false]) {
    const sh = sky ? 4 : 0, keep = sky ? 0x0f : 0xf0;
    const lv = (i: number) => (B[i] >> sh) & 15;
    const setLv = (i: number, v: number) => {
      if (stamp[i] !== gen) { stamp[i] = gen; touched.push(i); before.push(B[i]); }
      B[i] = (B[i] & keep) | (v << sh);
    };
    /** What a cell gets on its own: block light it gives off, or the sky shining into the top layer */
    const src = (i: number) => (sky ? (i >= top && F[i] < 15 ? 15 - F[i] : 0) : E[i]);
    const queue = (i: number) => { const v = lv(i); if (v > 0) RQ[v].push(i); };

    // where light can only drop, take it out, with all the light that may have come through there,
    // and queue the lit cells around those holes to spread back in
    for (const e of seeds) {
      const b = at(e), oldId = edits[e + 3], newId = edits[e + 4];
      const s1 = src(b), s0 = sky ? (edits[e + 1] === HT - 1 && FILT[oldId] < 15 ? 15 - FILT[oldId] : 0) : EM[oldId];
      if (FILT[newId] > FILT[oldId] || s1 < s0) {
        const old = lv(b);
        setLv(b, 0);
        if (old > 0) rs.push(b, old);
      }
    }
    while (rs.length) {
      const l = rs.pop()!, k = rs.pop()!;
      for (let d = 0; d < 6; d++) {
        const m = k + step[d], ml = lv(m);
        if (ml === 0) continue;
        const f = F[m], s = src(m);
        if (f < 15 && ml <= l - loss(f, sky && d === 5) && ml > s) {
          setLv(m, s);
          queue(m);
          rs.push(m, ml);
        } else queue(m);
      }
    }
    // the blocks' own light, and the light around them spreading into them again
    for (const e of seeds) {
      const b = at(e), s1 = src(b);
      if (s1 > lv(b)) setLv(b, s1);
      queue(b);
      for (let d = 0; d < 6; d++) queue(b + step[d]);
    }
    for (let L = 15; L > 0; L--) {
      const q = RQ[L];
      for (let j = 0; j < q.length; j++) {
        const k = q[j];
        if (lv(k) !== L) continue;                 // changed since it was queued
        for (let d = 0; d < 6; d++) {
          const m = k + step[d], f = F[m];
          if (f >= 15) continue;
          const v = L - loss(f, sky && d === 5);
          if (v > lv(m)) { setLv(m, v); RQ[v].push(m); }
        }
      }
      q.length = 0;
    }
  }

  // write what changed back into the chunks (touched cells are never walls, so their chunk is lit)
  const changed: number[] = [];
  for (let t = 0; t < touched.length; t++) {
    const i = touched[t], v = B[i];
    if (v === before[t]) continue;
    const wx = bx + (i % PX) - 1, wz = bz + (((i / PX) | 0) % (SZ + 2)) - 1, wy = ((i / PL) | 0) - 1;
    w.chunk(wx >> CB, wz >> CB)!.light![(wx & (W - 1)) + W * ((wz & (W - 1)) + W * wy)] = v;
    changed.push(cellKey(wx, wy, wz));
  }
  return changed;
}
