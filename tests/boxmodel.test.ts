import { describe, expect, it } from 'vitest';
import { FACES } from '../src/mesher';
import { boxModel, partIndex, faceRect, modelBuffers, vertexCount, restPose, resetPose, turn, shift, scale, blendPose, poseModel,
  newSkin, paintFace, texel, F_FRONT, F_PX, F_NX, F_BACK, F_TOP, F_BOTTOM, POSE, type BoxModel } from '../src/boxmodel';

// a body 8 × 6 × 12 texels standing on a leg, with a head on a neck at its front
const M = boxModel([
  ['body', '', [0, 10, 0], [-4, -3, -6], [8, 6, 12], [0, 0]],
  ['head', 'body', [0, 3, -6], [-3, -2, -6], [6, 6, 6], [40, 0]],
  ['leg', 'body', [0, -3, 0], [-1, -7, -1], [2, 7, 2], [0, 18]],
], 64, 32);
const HEAD = partIndex(M, 'head'), LEG = partIndex(M, 'leg');

/** Pose m: [positions in texels, shades] */
function posed(m: BoxModel, pose: Float32Array, yaw = 0): [Float32Array, Float32Array] {
  const n = vertexCount(m), pos = new Float32Array(n * 3), shade = new Float32Array(n * 3);
  poseModel(m, pose, yaw, pos, shade, new Float64Array(m.parts.length * 12));
  return [pos.map((v) => v * 32), shade];
}
/** Corner c (0–3: top-left, top-right, bottom-right, bottom-left of its image) of face f of part i */
const corner = (pos: Float32Array, i: number, f: number, c: number) => Array.from(pos.subarray((i * 24 + f * 4 + c) * 3, (i * 24 + f * 4 + c) * 3 + 3));
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: number[]) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
const OUT = [[0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 1, 0], [0, -1, 0]];   // front, +x, −x, back, top, bottom
const close = (a: number[], b: number[], d = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));

describe('box models', () => {
  it('unwrap a part round its sides in the skin (the box layout)', () => {
    const b = M.parts[0];                                    // 8 wide, 6 high, 12 deep at (0, 0)
    expect(faceRect(b, F_TOP)).toEqual([12, 0, 8, 12]);
    expect(faceRect(b, F_BOTTOM)).toEqual([20, 0, 8, 12]);
    expect(faceRect(b, F_PX)).toEqual([0, 12, 12, 6]);
    expect(faceRect(b, F_FRONT)).toEqual([12, 12, 8, 6]);
    expect(faceRect(b, F_NX)).toEqual([20, 12, 12, 6]);
    expect(faceRect(b, F_BACK)).toEqual([32, 12, 8, 6]);
    const { uv, index } = modelBuffers(M);
    expect(uv.length).toBe(vertexCount(M) * 2);
    expect(index.length).toBe(M.parts.length * 36);
    expect(Math.min(...uv)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...uv)).toBeLessThanOrEqual(1);
    // the front's image: its top-left corner is at its rectangle's top-left, in the skin's 0–1
    expect([uv[F_FRONT * 8], uv[F_FRONT * 8 + 1]]).toEqual([12 / 64, 12 / 32]);
  });

  it('stand at rest where the table puts them, children hanging from their parents', () => {
    const [pos] = posed(M, restPose(M));
    const lo = (i: number) => [0, 1, 2].map((k) => Math.min(...Array.from({ length: 24 }, (_, v) => pos[(i * 24 + v) * 3 + k])));
    const hi = (i: number) => [0, 1, 2].map((k) => Math.max(...Array.from({ length: 24 }, (_, v) => pos[(i * 24 + v) * 3 + k])));
    close(lo(0), [-4, 7, -6]); close(hi(0), [4, 13, 6]);
    close(lo(HEAD), [-3, 11, -12]); close(hi(HEAD), [3, 17, -6]);
    close(lo(LEG), [-1, 0, -1]); close(hi(LEG), [1, 7, 1]);
  });

  it('face outward: triangles wind counter-clockwise seen from outside, and each face is shaded the way it points', () => {
    const [pos, shade] = posed(M, restPose(M));
    const want = [FACES[5].s, FACES[0].s, FACES[1].s, FACES[4].s, FACES[2].s, FACES[3].s];
    for (let i = 0; i < M.parts.length; i++) for (let f = 0; f < 6; f++) {
      const tl = corner(pos, i, f, 0), br = corner(pos, i, f, 2), bl = corner(pos, i, f, 3);
      close(unit(cross(sub(bl, tl), sub(br, tl))), OUT[f]);      // the triangle (tl, bl, br)'s normal
      expect(shade[(i * 24 + f * 4) * 3]).toBeCloseTo(want[f], 6);
    }
    // the front's image has its top up and its left at +x
    const front = [0, 1, 2, 3].map((c) => corner(pos, 0, F_FRONT, c));
    close(front[0], [4, 13, -6]); close(front[1], [-4, 13, -6]); close(front[2], [-4, 7, -6]); close(front[3], [4, 7, -6]);
  });

  it('turn parts about their pivots, carrying their children', () => {
    const p = restPose(M);
    turn(p, 0, 0, 0, Math.PI / 2);                            // the body rolls onto its side
    const [pos, shade] = posed(M, p);
    // the body's pivot stays put; its old top now faces −x, and is shaded like a −x side
    close(corner(pos, 0, F_TOP, 0), [-3, 14, 6]);
    expect(shade[(0 * 24 + F_TOP * 4) * 3]).toBeCloseTo(FACES[1].s, 6);
    // the leg went with it: it sticks out to +x now
    const leg = Array.from({ length: 24 }, (_, v) => pos[(LEG * 24 + v) * 3]);
    expect(Math.min(...leg)).toBeCloseTo(3, 6);
    expect(Math.max(...leg)).toBeCloseTo(10, 6);
    // a turned head keeps its neck where it was
    const q = restPose(M);
    turn(q, HEAD, 0.4, 0.3);
    const [a] = posed(M, restPose(M)), [b] = posed(M, q);
    const pivot = [0, 13, -6];
    for (let v = HEAD * 24; v < HEAD * 24 + 24; v++) {
      const da = Math.hypot(...sub(Array.from(a.subarray(v * 3, v * 3 + 3)), pivot)), db = Math.hypot(...sub(Array.from(b.subarray(v * 3, v * 3 + 3)), pivot));
      expect(db).toBeCloseTo(da, 4);                            // every corner the same distance from the neck
    }
  });

  it('shift, scale (0 hides a part, all of it at its pivot) and blend poses', () => {
    const p = restPose(M);
    shift(p, LEG, 1, 2, 3);
    scale(p, HEAD, 0);
    const [pos] = posed(M, p);
    for (let v = HEAD * 24; v < HEAD * 24 + 24; v++) close(Array.from(pos.subarray(v * 3, v * 3 + 3)), [0, 13, -6]);
    close(corner(pos, LEG, F_BOTTOM, 1), [0, 2, 2]);
    const a = restPose(M), b = restPose(M), out = restPose(M);
    turn(b, HEAD, 1, -1, 0.5);
    blendPose(a, b, 0.25, out);
    expect(Array.from(out.subarray(HEAD * POSE, HEAD * POSE + 3))).toEqual([0.25, -0.25, 0.125]);
    blendPose(a, b, 1, out);
    expect(out).toEqual(b);
    resetPose(out);
    expect(out).toEqual(restPose(M));
  });

  it('face −z at yaw 0 and turn with the yaw like the player (yaw π/2 faces −x), in blocks', () => {
    const n = vertexCount(M), pos = new Float32Array(n * 3), shade = new Float32Array(n * 3), mats = new Float64Array(M.parts.length * 12);
    poseModel(M, restPose(M), Math.PI / 2, pos, shade, mats);
    // the head (in front at −z when yaw is 0) is now toward −x, 6–12 texels out
    const hx = Array.from({ length: 24 }, (_, v) => pos[(HEAD * 24 + v) * 3]);
    expect(Math.min(...hx)).toBeCloseTo(-12 / 32, 6);
    expect(Math.max(...hx)).toBeCloseTo(-6 / 32, 6);
    // and its face, toward −x, is shaded like a −x side
    expect(shade[(HEAD * 24 + F_FRONT * 4) * 3]).toBeCloseTo(FACES[1].s, 6);
  });

  it('paint skins a face at a time, its texels counted from the image\'s top-left', () => {
    const s = newSkin(64, 32);
    paintFace(s, M.parts[0], F_FRONT, (x, y, w, h) => (x === 0 && y === 0 ? [255, 0, 0] : x === w - 1 && y === h - 1 ? [0, 0, 255] : null));
    expect(texel(s, 12, 12)).toEqual([255, 0, 0]);
    expect(texel(s, 19, 17)).toEqual([0, 0, 255]);
    expect(texel(s, 13, 12)).toEqual([0, 0, 0]);
    expect(s.data[(12 * 64 + 13) * 4 + 3]).toBe(0);              // untouched texels stay clear
  });
});
