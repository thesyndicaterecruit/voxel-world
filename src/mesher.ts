import { CS, H, W as WORLD_W, D as WORLD_D } from './config';
import { AIR, LEAVES, B, ROT, OCCLUDES, PASS, MODEL, FILTER, SOLID, FALLING, faceHidden, liquidHeight } from './blocks';
import { TORCH_MODELS } from './torch';
import { hash3 } from './noise';

/* ======================= CHUNK MESHING (+AO, smooth light) ======================= */
// Pure: reads a padded copy of the chunk (blocks and light) and returns typed arrays, so it can run
// off the main thread.

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

/** Vertex positions are fixed point, 1/FP of a block (fine enough for the tilted torch). */
export const FP = 64;
/** Texels per tile edge: texture coords are whole texels, 0..TEX. */
export const TEX = 32;

/** One render pass of a chunk mesh. */
export interface PassMesh {
  /** Vertex position relative to the chunk origin, in 1/FP block (x, y, z) */
  pos: Uint16Array;
  /**
   * Per vertex: r = baked face shading × AO × block jitter, g = skylight, b = block light (light as
   * level × 17, so 15 = 255; the chunk shader turns them into brightness, see textures.ts)
   */
  col: Uint8Array;
  /** Texture coords in texels, 0..TEX (u, v; v = TEX is the top of the tile) */
  uv: Uint8Array;
  /** Texture tile (layer of the tile array) per vertex */
  layer: Uint8Array;
  index: Uint16Array | Uint32Array;
}
/** A chunk's meshes by render pass — 0 opaque, 1 cutout, 2 translucent — null where a pass is empty. */
export type MeshData = (PassMesh | null)[];

/** Growable vertex/index buffers for one pass. */
function builder() {
  let cap = 1024, n = 0, ni = 0;
  let pos = new Uint16Array(cap * 3), col = new Uint8Array(cap * 3), uv = new Uint8Array(cap * 2);
  let lay = new Uint8Array(cap), idx = new Uint32Array(cap * 1.5);
  return {
    /** Add a vertex (k: shading, sky / blk: light × 17); returns its index. */
    vert(x: number, y: number, z: number, k: number, sky: number, blk: number, u: number, v: number, l: number): number {
      if (n === cap) {
        cap *= 2;
        const p2 = new Uint16Array(cap * 3), c2 = new Uint8Array(cap * 3), u2 = new Uint8Array(cap * 2);
        const l2 = new Uint8Array(cap), i2 = new Uint32Array(cap * 1.5);
        p2.set(pos); c2.set(col); u2.set(uv); l2.set(lay); i2.set(idx);
        pos = p2; col = c2; uv = u2; lay = l2; idx = i2;
      }
      pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
      col[n * 3] = k; col[n * 3 + 1] = sky; col[n * 3 + 2] = blk;
      uv[n * 2] = u; uv[n * 2 + 1] = v;
      lay[n] = l;
      return n++;
    },
    /** Two triangles over vertices a b c d (CCW); `flip` uses the other diagonal (b–d). */
    quad(a: number, b: number, c: number, d: number, flip: boolean): void {
      if (flip) { idx[ni++] = b; idx[ni++] = c; idx[ni++] = d; idx[ni++] = b; idx[ni++] = d; idx[ni++] = a; }
      else { idx[ni++] = a; idx[ni++] = b; idx[ni++] = c; idx[ni++] = a; idx[ni++] = c; idx[ni++] = d; }
    },
    finish(): PassMesh | null {
      if (!ni) return null;
      const index = n > 65535 ? idx.slice(0, ni) : Uint16Array.from(idx.subarray(0, ni));
      return { pos: pos.slice(0, n * 3), col: col.slice(0, n * 3), uv: uv.slice(0, n * 2), layer: lay.slice(0, n), index };
    },
  };
}

/** Texels to fixed-point position units */
const TP = FP / TEX;
/** Most blocks a merged water surface spans each way (texture coordinates are bytes: 7 × TEX ≤ 255) */
const MERGE = 7;

/**
 * Mesh one chunk. `pad` is the chunk plus a one-block border from its neighbours (PI layout; columns
 * outside the world or in missing chunks are air), `light` the same cells' light (packed, see
 * light.ts), `state` their per-block state (null when none of them has any). (x0, z0) is the chunk's
 * world origin: the per-block brightness and tile rotation hash world coordinates with the world
 * seed, so the result does not depend on which chunk is meshed first. Each block's faces go into its
 * render pass, one mesh per pass: the tile is a vertex attribute, so every pass of a chunk draws in a
 * single call. `opaqueLeaves`: leaves are meshed as opaque cubes, in the opaque pass (see faceHidden).
 */
export function meshChunk(pad: Uint8Array, light: Uint8Array, state: Uint8Array | null, x0: number, z0: number, seed: number,
  opaqueLeaves = true): MeshData {
  const passes = [builder(), builder(), builder()];
  /** Is padded column (qx, qz) beyond the edge of the world? */
  const outside = (qx: number, qz: number) => x0 + qx - 1 < 0 || z0 + qz - 1 < 0 || x0 + qx - 1 >= WORLD_W || z0 + qz - 1 >= WORLD_D;
  /**
   * Liquid `id`'s surface height (0–1 block above layer y) at the top corner shared by padded columns
   * cx−1…cx × cz−1…cz: full where any of them is falling or has the liquid on top, else the average
   * of their liquid heights — sources count 10 times, so open water stays level — pulled down by
   * open cells; solid cells have no say. Beyond the world's edge is more sea. Liquid next door shares
   * the corner, so the surfaces join up.
   */
  const surface = (cx: number, y: number, cz: number, id: number) => {
    let sum = 0, n = 0;
    for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
      const qx = cx + dx, qz = cz + dz, i = PI(qx, y, qz), out = outside(qx, qz), b = out ? id : pad[i];
      if (b === id) {
        const st = state && !out ? state[i] : 0;
        if (st & FALLING || (!out && y + 1 < H && pad[i + PW * PW] === id)) return 1;
        const h = liquidHeight(st);
        if (st === 0) { sum += h * 10; n += 10; } else { sum += h; n++; }
      } else if (!SOLID[b]) n++;
    }
    return sum / n;
  };
  const occ = (px: number, y: number, pz: number) => (y >= 0 && y < H ? OCCLUDES[pad[PI(px, y, pz)]] : 0);
  const aoAt = (px: number, y: number, pz: number, o: number[]) => {
    const s1 = occ(px + o[0], y + o[1], pz + o[2]), s2 = occ(px + o[3], y + o[4], pz + o[5]);
    return s1 && s2 ? AO[0] : AO[3 - s1 - s2 - occ(px + o[6], y + o[7], pz + o[8])];
  };
  // smooth light: a vertex gets the average light of the cells touching its corner on the face's
  // outer side — the face's own neighbour, the two beside it and the diagonal one (unless both of
  // those hide it) — leaving out solid ones, which hold no light; above the world is open sky
  let ss = 0, sb = 0, sc = 0;
  const take = (px: number, y: number, pz: number) => {
    if (y >= H) { ss += 15; sc++; return true; }
    if (y < 0) return false;
    const i = PI(px, y, pz);
    if (FILTER[pad[i]] >= 15) return false;
    const v = light[i];
    ss += v >> 4; sb += v & 15; sc++;
    return true;
  };
  const smooth = (px: number, y: number, pz: number, n: number[], o: number[], i: number) => {
    ss = sb = sc = 0;
    take(px + n[0], y + n[1], pz + n[2]);
    const a = take(px + o[0], y + o[1], pz + o[2]), b = take(px + o[3], y + o[4], pz + o[5]);
    if (a || b) take(px + o[6], y + o[7], pz + o[8]);
    SKY[i] = Math.round((ss / sc) * 17); BLK[i] = Math.round((sb / sc) * 17);
  };
  const L = [0, 0, 0, 0], vi = [0, 0, 0, 0], SKY = [0, 0, 0, 0], BLK = [0, 0, 0, 0], C = [0, 0, 0, 0];
  // the flat, evenly lit tops of still water in the current layer, to be merged (flushFlat): per
  // column 1 + surface height (FP units) + 65 × (skylight + 256 × block light) × 17, 0 for none
  const flat = new Int32Array(CS * CS);
  let flatTile = 0;
  /**
   * Merge the flat water tops of layer y into rectangles of up to MERGE × MERGE blocks (the
   * texture repeats across them: texture coordinates are bytes, so 7 tiles is the most).
   */
  const flushFlat = (y: number) => {
    const out = passes[2];
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const key = flat[lx + CS * lz];
      if (!key) continue;
      let w = 1, h = 1;
      while (lx + w < CS && w < MERGE && flat[lx + w + CS * lz] === key) w++;
      grow: while (lz + h < CS && h < MERGE) {
        for (let i = 0; i < w; i++) if (flat[lx + i + CS * (lz + h)] !== key) break grow;
        h++;
      }
      for (let j = 0; j < h; j++) flat.fill(0, lx + CS * (lz + j), lx + w + CS * (lz + j));
      const top = y * FP + ((key - 1) % 65), l = Math.floor((key - 1) / 65), sky = l % 256, blk = Math.floor(l / 256);
      const F = FACES[2];
      for (let i = 0; i < 4; i++) {
        const v = F.v[i];
        vi[i] = out.vert((lx + v[0] * w) * FP, top, (lz + v[2] * h) * FP, 255, sky, blk, v[0] * w * TEX, v[2] * h * TEX, flatTile);
      }
      out.quad(vi[0], vi[1], vi[2], vi[3], false);
    }
  };
  // skip the empty layers above the highest block
  let top = H - 1;
  for (; top >= 0; top--) {
    let any = false;
    for (let pz = 1; pz <= CS && !any; pz++) for (let px = 1; px <= CS; px++) if (pad[PI(px, top, pz)] !== AIR) { any = true; break; }
    if (any) break;
  }

  for (let y = 0; y <= top; y++) { if (y) flushFlat(y - 1); for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
    const px = lx + 1, pz = lz + 1, id = pad[PI(px, y, pz)];
    if (id === AIR) continue;
    const x = x0 + lx, z = z0 + lz, b = B[id], model = MODEL[id];
    const fast = opaqueLeaves && id === LEAVES, out = passes[fast ? 0 : PASS[id]], tex = fast && b.fastTex ? b.fastTex : b.tex;

    if (model === 1) {                             // torch: its stick-and-flame model, tilted per facing
      const st = state ? state[PI(px, y, pz)] : 0, quads = TORCH_MODELS[st <= 4 ? st : 0];
      const v = light[PI(px, y, pz)], sky = (v >> 4) * 17, blk = (v & 15) * 17;   // the light it stands in
      for (const q of quads) {
        const k = q.glow ? 255 : Math.round(q.shade * 255);
        for (let i = 0; i < 4; i++) {
          const p = q.p[i];
          vi[i] = out.vert(Math.round((lx * TEX + p[0]) * TP), Math.round((y * TEX + p[1]) * TP), Math.round((lz * TEX + p[2]) * TP),
            k, sky, q.glow ? 255 : blk, q.uv[i][0], q.uv[i][1], tex[0]);   // the flame shines at full
        }
        out.quad(vi[0], vi[1], vi[2], vi[3], false);
      }
      continue;
    }

    if (model === 2) {                             // liquid: a surface shaped by its neighbours, no AO
      // the surface's height at the top corners (x0 z0, x1 z0, x0 z1, x1 z1)
      C[0] = surface(px, y, pz, id); C[1] = surface(px + 1, y, pz, id);
      C[2] = surface(px, y, pz + 1, id); C[3] = surface(px + 1, y, pz + 1, id);
      // a sloping surface flows downhill: its streaks are turned that way (rot: toward −z, +z, +x, −x)
      const gx = C[1] + C[3] - C[0] - C[2], gz = C[2] + C[3] - C[0] - C[1], still = Math.abs(gx) + Math.abs(gz) < 0.01;
      const rot = still ? 0 : Math.abs(gx) >= Math.abs(gz) ? (gx < 0 ? 2 : 3) : (gz < 0 ? 1 : 0);
      for (let f = 0; f < 6; f++) {
        const F = FACES[f], ny = y + F.n[1], qx = px + F.n[0], qz = pz + F.n[2];
        if (ny < 0 || (!F.n[1] && outside(qx, qz))) continue;           // the sea goes on past the world's edge
        // the (lowered) top shows under anything but more liquid; the other faces cull as usual
        const nb = ny < H ? pad[PI(qx, ny, qz)] : AIR;
        if (f === 2 ? nb === id : faceHidden(id, nb, opaqueLeaves)) continue;
        const k = Math.round(F.s * 255), tl = f === 2 && !still ? tex[0] : tex[F.k];
        if (f === 2 && still && C[0] === C[1] && C[0] === C[2] && C[0] === C[3]) {
          // a flat top, lit the same at every corner: merged with its like (flushFlat)
          for (let i = 0; i < 4; i++) smooth(px, y, pz, F.n, F.ao[i], i);
          if (SKY[0] === SKY[1] && SKY[0] === SKY[2] && SKY[0] === SKY[3] && BLK[0] === BLK[1] && BLK[0] === BLK[2] && BLK[0] === BLK[3]) {
            flat[lx + CS * lz] = 1 + Math.round(C[0] * FP) + 65 * (SKY[0] + 256 * BLK[0]);
            flatTile = tl;
            continue;
          }
        }
        for (let i = 0; i < 4; i++) {
          const v = F.v[i], h = v[1] ? C[v[0] + 2 * v[2]] : 0;
          let u = F.uv[i][0], w = F.uv[i][1];
          if (f === 2) {
            u = rot === 0 ? v[0] : rot === 1 ? 1 - v[0] : rot === 2 ? v[2] : 1 - v[2];
            w = rot === 0 ? v[2] : rot === 1 ? 1 - v[2] : rot === 2 ? 1 - v[0] : v[0];
          } else if (!F.n[1]) w = h;                // a side reaches up to the surface
          smooth(px, y, pz, F.n, F.ao[i], i);
          vi[i] = out.vert((lx + v[0]) * FP, y * FP + Math.round(h * FP), (lz + v[2]) * FP, k, SKY[i], BLK[i],
            Math.round(u * TEX), Math.round(w * TEX), tl);
        }
        // split the top across the two corners closer in height: a smoother surface
        out.quad(vi[0], vi[1], vi[2], vi[3], f === 2 && Math.abs(C[3] - C[0]) < Math.abs(C[2] - C[1]));
      }
      continue;
    }

    const j = 1 - b.jit * hash3(seed, x, y, z);
    for (let f = 0; f < 6; f++) {
      const F = FACES[f], ny = y + F.n[1];
      if (ny < 0 || (ny < H && faceHidden(id, pad[PI(px + F.n[0], ny, pz + F.n[2])], opaqueLeaves))) continue; // hidden face
      const o = F.ao;
      const l0 = L[0] = aoAt(px, y, pz, o[0]), l1 = L[1] = aoAt(px, y, pz, o[1]);
      const l2 = L[2] = aoAt(px, y, pz, o[2]), l3 = L[3] = aoAt(px, y, pz, o[3]);
      const tl = tex[F.k];
      const rot = ROT.has(tl) ? Math.floor(hash3(seed, x * 3 + f, y, z - f) * 4) : 0;
      const sh = F.s * j;
      for (let i = 0; i < 4; i++) {
        const v = F.v[i], q = F.uv[(i + rot) & 3];
        smooth(px, y, pz, F.n, o[i], i);
        // face shading × AO tints the texture; the light goes along for the shader
        vi[i] = out.vert((lx + v[0]) * FP, (y + v[1]) * FP, (lz + v[2]) * FP, Math.round(sh * L[i] * 255), SKY[i], BLK[i],
          q[0] * TEX, q[1] * TEX, tl);
      }
      // flip the quad diagonal so AO and light interpolate smoothly
      const b0 = l0 * (1 + SKY[0] + BLK[0]), b1 = l1 * (1 + SKY[1] + BLK[1]), b2 = l2 * (1 + SKY[2] + BLK[2]), b3 = l3 * (1 + SKY[3] + BLK[3]);
      out.quad(vi[0], vi[1], vi[2], vi[3], b0 + b2 > b1 + b3);
    }
  } }
  flushFlat(top);
  return passes.map((p) => p.finish());
}
