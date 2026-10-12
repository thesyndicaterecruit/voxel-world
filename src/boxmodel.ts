import { FACES } from './mesher';

/* ============================ BOX MODELS ============================ */
// Creatures and props are cuboids ("parts") textured from one skin, posed on the CPU into one
// geometry, so an entity costs one draw call. Units are texels, 1/32 of a block like the tiles'.
// A part hangs from its parent at a pivot (in the parent's space; a root part's is in the model's,
// whose origin is the feet with the front toward −z), and its box sits relative to that pivot.
// A pose turns, shifts and scales each part about its pivot; the parts below it follow.
//
// Skins use the box unwrap (Minecraft's): a part w × h × d with its uv at (u, v) has, left to
// right, its top (w × d) and bottom on the first row, then its +x side, front (−z), −x side and back
// (d, w, d, w wide, h high) on the second, so the four sides wrap round it in order:
//
//          u    u+d     u+d+w   u+2d+w   u+2d+2w
//      v         | top   | bottom |
//      v+d  | +x | front |   −x   |  back  |
//      v+d+h
//
// Seen from outside, a side's image has its top up; the front's left is the model's +x (its own
// right, as a face looking at you has). The top's image has the front at its bottom edge.

/** A part's faces, in the order of a part's vertices (4 each): front (−z), +x side, −x side, back (+z), top, bottom */
export const F_FRONT = 0, F_PX = 1, F_NX = 2, F_BACK = 3, F_TOP = 4, F_BOTTOM = 5;
const NFACE = 6;
/** Each face's corners (bit 0: x at the box's far x, 1: y, 2: z), top-left, top-right, bottom-right, bottom-left in its image */
const CORNERS = [[3, 2, 0, 1], [7, 3, 1, 5], [2, 6, 4, 0], [6, 7, 5, 4], [7, 6, 2, 3], [1, 0, 4, 5]];
/** Each face's outward normal */
const NORMALS = [[0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 1, 0], [0, -1, 0]];
// the world's face shading (mesher.ts FACES): +x, −x, top, bottom, +z, −z
const S_PX = FACES[0].s, S_NX = FACES[1].s, S_TOP = FACES[2].s, S_BOT = FACES[3].s, S_PZ = FACES[4].s, S_NZ = FACES[5].s;

export interface Part {
  name: string;
  /** Index of the part it hangs from (−1: none) */
  parent: number;
  /** Where it hangs: a point in its parent's space (texels) */
  pivot: number[];
  /** The box's lower corner relative to the pivot, and its size (texels) */
  from: number[];
  size: number[];
  /** Top-left of its unwrapped faces in the skin (texels) */
  uv: number[];
}
export interface BoxModel {
  parts: Part[];
  /** The skin's size in texels */
  skinW: number;
  skinH: number;
}
/** A part as written in a model's table: [name, parent's name or '', pivot, from, size, uv] */
export type PartDef = [string, string, number[], number[], number[], number[]];

/** A model from its table (parents before their children) and its skin's size. */
export function boxModel(defs: PartDef[], skinW: number, skinH: number): BoxModel {
  const parts: Part[] = [];
  for (const [name, parent, pivot, from, size, uv] of defs) {
    const p = parent ? parts.findIndex((q) => q.name === parent) : -1;
    if (parent && p < 0) throw new Error(`part ${name}: no ${parent} before it`);
    parts.push({ name, parent: p, pivot, from, size, uv });
  }
  return { parts, skinW, skinH };
}
/** Index of a model's part by name */
export function partIndex(m: BoxModel, name: string): number {
  const i = m.parts.findIndex((p) => p.name === name);
  if (i < 0) throw new Error(`no part ${name}`);
  return i;
}

/** A face's rectangle in the skin: [x, y, width, height] (texels) */
export function faceRect(p: Part, f: number): number[] {
  const [u, v] = p.uv, [w, h, d] = p.size;
  return f === F_TOP ? [u + d, v, w, d] : f === F_BOTTOM ? [u + d + w, v, w, d] : f === F_PX ? [u, v + d, d, h]
    : f === F_FRONT ? [u + d, v + d, w, h] : f === F_NX ? [u + d + w, v + d, d, h] : [u + 2 * d + w, v + d, w, h];
}

/** What doesn't change as the model moves: uvs (0–1, v down the skin) and triangles, 4 vertices a face, 24 a part */
export function modelBuffers(m: BoxModel): { uv: Float32Array; index: Uint16Array } {
  const n = m.parts.length, uv = new Float32Array(n * NFACE * 8), index = new Uint16Array(n * NFACE * 6);
  m.parts.forEach((p, i) => {
    for (let f = 0; f < NFACE; f++) {
      const [x, y, w, h] = faceRect(p, f), o = (i * NFACE + f) * 4;
      uv.set([x / m.skinW, y / m.skinH, (x + w) / m.skinW, y / m.skinH, (x + w) / m.skinW, (y + h) / m.skinH, x / m.skinW, (y + h) / m.skinH], o * 2);
      index.set([o, o + 3, o + 2, o, o + 2, o + 1], (i * NFACE + f) * 6);   // counter-clockwise seen from outside
    }
  });
  return { uv, index };
}
/** Vertices of a model (24 a part) */
export const vertexCount = (m: BoxModel) => m.parts.length * NFACE * 4;

/* ---------- poses ---------- */
/** Numbers per part in a pose: rotation about x, y, z (radians, x first), offset x, y, z (texels, in its parent's space), scale x, y, z */
export const POSE = 9;
/** A pose that leaves every part as the model has it */
export function restPose(m: BoxModel): Float32Array {
  const p = new Float32Array(m.parts.length * POSE);
  for (let i = 0; i < m.parts.length; i++) p.fill(1, i * POSE + 6, i * POSE + 9);
  return p;
}
/** Set a pose back to rest */
export function resetPose(p: Float32Array): void {
  p.fill(0);
  for (let i = 0; i < p.length; i += POSE) p.fill(1, i + 6, i + 9);
}
/** Turn part i (radians about x, y, z: x first) */
export function turn(p: Float32Array, i: number, rx: number, ry = 0, rz = 0): void { p[i * POSE] = rx; p[i * POSE + 1] = ry; p[i * POSE + 2] = rz; }
/** Shift part i (texels, in its parent's space) */
export function shift(p: Float32Array, i: number, x: number, y = 0, z = 0): void { p[i * POSE + 3] = x; p[i * POSE + 4] = y; p[i * POSE + 5] = z; }
/** Scale part i about its pivot (0 hides it) */
export function scale(p: Float32Array, i: number, sx: number, sy = sx, sz = sx): void { p[i * POSE + 6] = sx; p[i * POSE + 7] = sy; p[i * POSE + 8] = sz; }
/** out = a eased toward b by k (0 a, 1 b) */
export function blendPose(a: Float32Array, b: Float32Array, k: number, out: Float32Array): void {
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * k;
}

/**
 * Pose model m: every vertex's position in blocks from the feet, turned by `yaw` (0 faces −z, like
 * the player), into `pos` (3 a vertex), and its brightness from the way its face points now (the
 * world's face shading, so a creature lying on its side is shaded like the ground) into `shade` (3 a
 * vertex: grey). `mats` is scratch space, 12 numbers a part.
 */
export function poseModel(m: BoxModel, pose: Float32Array, yaw: number, pos: Float32Array, shade: Float32Array, mats: Float64Array): void {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), k = 1 / 32, c = C, L = LOCAL;
  const root = ROOT;
  root[0] = cy * k; root[2] = sy * k; root[5] = k; root[8] = -sy * k; root[10] = cy * k;
  m.parts.forEach((part, i) => {
    // this part's matrix (3 × 4, rows): its parent's (or the yaw and texels → blocks) × move to the
    // pivot × turn (z · y · x) × scale
    const q = i * POSE, M = mats.subarray(i * 12, i * 12 + 12);
    const ax = pose[q], ay = pose[q + 1], az = pose[q + 2], sx = pose[q + 6], sY = pose[q + 7], sz = pose[q + 8];
    const ca = Math.cos(ax), sa = Math.sin(ax), cb = Math.cos(ay), sb = Math.sin(ay), cc = Math.cos(az), sc = Math.sin(az);
    L[0] = cc * cb * sx; L[1] = (cc * sb * sa - sc * ca) * sY; L[2] = (cc * sb * ca + sc * sa) * sz; L[3] = part.pivot[0] + pose[q + 3];
    L[4] = sc * cb * sx; L[5] = (sc * sb * sa + cc * ca) * sY; L[6] = (sc * sb * ca - cc * sa) * sz; L[7] = part.pivot[1] + pose[q + 4];
    L[8] = -sb * sx; L[9] = cb * sa * sY; L[10] = cb * ca * sz; L[11] = part.pivot[2] + pose[q + 5];
    const P = part.parent >= 0 ? mats.subarray(part.parent * 12, part.parent * 12 + 12) : root;
    for (let r = 0; r < 3; r++) for (let col = 0; col < 4; col++) {
      M[r * 4 + col] = P[r * 4] * L[col] + P[r * 4 + 1] * L[4 + col] + P[r * 4 + 2] * L[8 + col] + (col === 3 ? P[r * 4 + 3] : 0);
    }
    // its 8 corners
    for (let b = 0; b < 8; b++) {
      const x = part.from[0] + (b & 1 ? part.size[0] : 0), y = part.from[1] + (b & 2 ? part.size[1] : 0), z = part.from[2] + (b & 4 ? part.size[2] : 0);
      for (let r = 0; r < 3; r++) c[b * 3 + r] = M[r * 4] * x + M[r * 4 + 1] * y + M[r * 4 + 2] * z + M[r * 4 + 3];
    }
    for (let f = 0; f < NFACE; f++) {
      const n = NORMALS[f], o = (i * NFACE + f) * 12;
      for (let v = 0; v < 4; v++) { const b = CORNERS[f][v] * 3; pos[o + v * 3] = c[b]; pos[o + v * 3 + 1] = c[b + 1]; pos[o + v * 3 + 2] = c[b + 2]; }
      // the face's normal now (normalised whatever the scale; a hidden part's doesn't matter)
      let nx = M[0] * n[0] + M[1] * n[1] + M[2] * n[2], ny = M[4] * n[0] + M[5] * n[1] + M[6] * n[2], nz = M[8] * n[0] + M[9] * n[1] + M[10] * n[2];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      shade.fill(nx * nx * (nx > 0 ? S_PX : S_NX) + ny * ny * (ny > 0 ? S_TOP : S_BOT) + nz * nz * (nz > 0 ? S_PZ : S_NZ), o, o + 12);
    }
  });
}
/** Scratch for poseModel: a part's corners, its own matrix, the model's (yaw, texels → blocks) */
const C = new Float64Array(24), LOCAL = new Float64Array(12), ROOT = new Float64Array(12);

/* ---------- skins ---------- */
export type RGB = [number, number, number];
/** A skin being painted: its texels (RGBA, rows top down) and size */
export interface Skin { data: Uint8ClampedArray; w: number; h: number }
/** A blank (clear) skin */
export const newSkin = (w: number, h: number): Skin => ({ data: new Uint8ClampedArray(w * h * 4), w, h });
/** Set texel (x, y) to colour c × brightness k */
export function put(s: Skin, x: number, y: number, c: RGB, k = 1): void {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
  const i = (y * s.w + x) * 4;
  s.data[i] = c[0] * k; s.data[i + 1] = c[1] * k; s.data[i + 2] = c[2] * k; s.data[i + 3] = 255;
}
/** The colour of texel (x, y) */
export function texel(s: Skin, x: number, y: number): RGB {
  const i = (y * s.w + x) * 4;
  return [s.data[i], s.data[i + 1], s.data[i + 2]];
}
/**
 * Paint face f of part p: `paint(x, y, w, h)` for each of its texels, x and y counted from the
 * face image's top-left (see the unwrap above), w × h its size; it returns the colour, or null to leave it.
 */
export function paintFace(s: Skin, p: Part, f: number, paint: (x: number, y: number, w: number, h: number) => RGB | null): void {
  const [fx, fy, w, h] = faceRect(p, f);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = paint(x, y, w, h); if (c) put(s, fx + x, fy + y, c); }
}
