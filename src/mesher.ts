import { CS, H } from './config';
import { AIR, B, ROT, OCCLUDES, faceHidden } from './blocks';
import { hash3 } from './noise';

/* ======================= CHUNK MESHING (+AO) ======================= */
// Pure: reads a padded copy of the chunk and returns typed arrays, so it can run off the main thread.

/** Padded chunk width: the chunk plus one column of each neighbour, for face culling and AO at borders. */
export const PW = CS + 2;
export const PAD_VOL = PW * PW * H;
/** Index into padded data; px = lx + 1, pz = lz + 1. */
export const PI = (px: number, y: number, pz: number) => px + PW * (pz + PW * y);

type V3 = [number, number, number];
export interface Face {
  /** Normal */
  n: V3;
  /** Face kind: 0 side, 1 top, 2 bottom (indexes BlockDef.t) */
  k: number;
  /** Baked "sunlight" */
  s: number;
  /** Corners, CCW seen from outside */
  v: V3[];
  /** Per corner: the 3 neighbour offsets (side1, side2, diagonal) that occlude it, flattened */
  ao: number[][];
  /** Per corner texture coords */
  uv: [number, number][];
}

export const FACES: Face[] = ([
  { n: [1, 0, 0],  k: 0, s: 0.84, v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], k: 0, s: 0.62, v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0],  k: 1, s: 1.0,  v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], k: 2, s: 0.5,  v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1],  k: 0, s: 0.68, v: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], k: 0, s: 0.76, v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
] as Omit<Face, 'ao' | 'uv'>[]).map((F) => {
  // precompute the 3 neighbour offsets that occlude each corner
  const a = F.n[0] ? 0 : F.n[1] ? 1 : 2, u = (a + 1) % 3, w = (a + 2) % 3;
  const ao = F.v.map((c) => {
    const s1 = F.n.slice(), s2 = F.n.slice();
    s1[u] += c[u] ? 1 : -1; s2[w] += c[w] ? 1 : -1;
    const cr = s1.slice(); cr[w] += c[w] ? 1 : -1;
    return s1.concat(s2, cr);
  });
  // texture coords per corner (v follows +Y on side faces so grass overhang stays on top)
  const uv = F.v.map((c): [number, number] =>
    (F.n[1] ? [c[0], c[2]] : F.n[0] ? [F.n[0] > 0 ? 1 - c[2] : c[2], c[1]] : [F.n[2] > 0 ? c[0] : 1 - c[0], c[1]]));
  return { ...F, ao, uv };
});

const AO = [0.5, 0.68, 0.85, 1];

export interface MeshData {
  /** Vertex position relative to the chunk origin (x, y, z) */
  pos: Uint8Array;
  /** Baked face light × AO × block jitter, 0..255 (r = g = b) */
  col: Uint8Array;
  /** Texture coords, 0 or 1 */
  uv: Uint8Array;
  /** Texture tile (layer of the tile array) per vertex */
  layer: Uint8Array;
  index: Uint16Array | Uint32Array;
}

/**
 * Mesh one chunk. `pad` is the chunk plus a one-block border from its neighbours (PI layout; columns
 * outside the world or in missing chunks are air). (x0, z0) is the chunk's world origin: the
 * per-block brightness and tile rotation hash world coordinates with the world seed, so the result
 * does not depend on which chunk is meshed first. Every face goes in one index list: the tile is a
 * vertex attribute, so a chunk draws in a single call. `opaqueLeaves`: leaves are meshed as opaque
 * cubes (see faceHidden).
 */
export function meshChunk(pad: Uint8Array, x0: number, z0: number, seed: number, opaqueLeaves = true): MeshData {
  let cap = 8192, n = 0, ni = 0;                  // vertex capacity, vertex count, index count
  let pos = new Uint8Array(cap * 3), col = new Uint8Array(cap * 3), uv = new Uint8Array(cap * 2);
  let lay = new Uint8Array(cap), idx = new Uint32Array(cap * 1.5);
  const occ = (px: number, y: number, pz: number) => (y >= 0 && y < H ? OCCLUDES[pad[PI(px, y, pz)]] : 0);
  const aoAt = (px: number, y: number, pz: number, o: number[]) => {
    const s1 = occ(px + o[0], y + o[1], pz + o[2]), s2 = occ(px + o[3], y + o[4], pz + o[5]);
    return s1 && s2 ? AO[0] : AO[3 - s1 - s2 - occ(px + o[6], y + o[7], pz + o[8])];
  };
  const L = [0, 0, 0, 0];
  // skip the empty layers above the highest block
  let top = H - 1;
  for (; top >= 0; top--) {
    let any = false;
    for (let pz = 1; pz <= CS && !any; pz++) for (let px = 1; px <= CS; px++) if (pad[PI(px, top, pz)] !== AIR) { any = true; break; }
    if (any) break;
  }

  for (let y = 0; y <= top; y++) for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
    const px = lx + 1, pz = lz + 1, id = pad[PI(px, y, pz)];
    if (id === AIR) continue;
    const x = x0 + lx, z = z0 + lz;
    const b = B[id], j = 1 - b.jit * hash3(seed, x, y, z);
    for (let f = 0; f < 6; f++) {
      const F = FACES[f], ny = y + F.n[1];
      if (ny < 0 || (ny < H && faceHidden(id, pad[PI(px + F.n[0], ny, pz + F.n[2])], opaqueLeaves))) continue; // hidden face
      const o = F.ao;
      const l0 = L[0] = aoAt(px, y, pz, o[0]), l1 = L[1] = aoAt(px, y, pz, o[1]);
      const l2 = L[2] = aoAt(px, y, pz, o[2]), l3 = L[3] = aoAt(px, y, pz, o[3]);
      const tl = b.tex[F.k];
      const rot = ROT.has(tl) ? Math.floor(hash3(seed, x * 3 + f, y, z - f) * 4) : 0;
      const sh = F.s * j;
      if (n + 4 > cap) {                           // grow the buffers
        cap *= 2;
        const p2 = new Uint8Array(cap * 3), c2 = new Uint8Array(cap * 3), u2 = new Uint8Array(cap * 2);
        const l2a = new Uint8Array(cap), i2 = new Uint32Array(cap * 1.5);
        p2.set(pos); c2.set(col); u2.set(uv); l2a.set(lay); i2.set(idx);
        pos = p2; col = c2; uv = u2; lay = l2a; idx = i2;
      }
      const base = n;
      for (let i = 0; i < 4; i++, n++) {
        const v = F.v[i], k = Math.round(sh * L[i] * 255), q = F.uv[(i + rot) & 3];
        pos[n * 3] = lx + v[0]; pos[n * 3 + 1] = y + v[1]; pos[n * 3 + 2] = lz + v[2];
        col[n * 3] = col[n * 3 + 1] = col[n * 3 + 2] = k;   // baked light + AO tints the texture
        uv[n * 2] = q[0]; uv[n * 2 + 1] = q[1];
        lay[n] = tl;
      }
      // flip the quad diagonal so AO interpolates smoothly
      if (l0 + l2 > l1 + l3) {
        idx[ni++] = base + 1; idx[ni++] = base + 2; idx[ni++] = base + 3;
        idx[ni++] = base + 1; idx[ni++] = base + 3; idx[ni++] = base;
      } else {
        idx[ni++] = base; idx[ni++] = base + 1; idx[ni++] = base + 2;
        idx[ni++] = base; idx[ni++] = base + 2; idx[ni++] = base + 3;
      }
    }
  }
  const index = n > 65535 ? idx.slice(0, ni) : Uint16Array.from(idx.subarray(0, ni));
  return { pos: pos.slice(0, n * 3), col: col.slice(0, n * 3), uv: uv.slice(0, n * 2), layer: lay.slice(0, n), index };
}
