import { describe, expect, it } from 'vitest';
import { BENTLEY, BENTLEY_MODEL, BENTLEY_STATES, bentleyPose, paintBentley, snortAt, zzzFrom, FAWN, MASK, WALK_SPEED, WALK_TURN, ZZZ_EVERY,
  type BentleyState } from '../src/bentley';
import { faceRect, partIndex, restPose, poseModel, vertexCount, texel, F_FRONT, F_PX, F_NX, F_BACK, F_TOP, F_BOTTOM, POSE, type Skin } from '../src/boxmodel';
import type { Creature } from '../src/entities';

const M = BENTLEY_MODEL, P = (n: string) => partIndex(M, n);
const skin = paintBentley();

/** Mean colour of face f of part `name` (or the rows y0…y1 of it, counted from its image's top) */
function mean(s: Skin, name: string, f: number, y0 = 0, y1 = Infinity): number[] {
  const [x, y, w, h] = faceRect(M.parts[P(name)], f), sum = [0, 0, 0];
  let n = 0;
  for (let j = y0; j < Math.min(h, y1 + 1); j++) for (let i = 0; i < w; i++) { texel(s, x + i, y + j).forEach((v, k) => (sum[k] += v)); n++; }
  return sum.map((v) => v / n);
}
const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const near = (c: number[], want: number[], d: number) => c.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThan(d));

describe("Bentley's skin", () => {
  it('is painted the same every time, every texel opaque', () => {
    expect(paintBentley().data).toEqual(skin.data);
    for (let i = 3; i < skin.data.length; i += 4) expect(skin.data[i]).toBe(255);
  });

  it('is fawn, with a darker back and a pale belly', () => {
    for (const f of [F_PX, F_NX]) near(mean(skin, 'body', f, 3, 9), FAWN, 14);
    expect(luma(mean(skin, 'body', F_TOP))).toBeLessThan(luma(FAWN) - 15);
    expect(luma(mean(skin, 'body', F_BOTTOM))).toBeGreaterThan(luma(FAWN) + 10);
    for (const leg of ['legFL', 'head', 'tail']) {
      const c = mean(skin, leg, F_PX);
      expect(c[0]).toBeGreaterThan(c[1]); expect(c[1]).toBeGreaterThan(c[2]);     // warm: r > g > b
      expect(c[0] - c[2]).toBeGreaterThan(45);
    }
  });

  it('has a black mask and muzzle, black ears, and darker wrinkles on the forehead', () => {
    near(mean(skin, 'head', F_FRONT, 4), MASK, 12);                // the face below the forehead
    near(mean(skin, 'muzzle', F_FRONT), MASK, 14);
    for (const f of [F_FRONT, F_PX, F_NX, F_BACK, F_TOP]) expect(luma(mean(skin, 'earL', f))).toBeLessThan(40);
    expect(luma(mean(skin, 'head', F_FRONT, 0, 2))).toBeGreaterThan(110);    // a fawn forehead…
    const [x, y, w] = faceRect(M.parts[P('head')], F_FRONT);
    const row = Array.from({ length: w }, (_, i) => luma(texel(skin, x + i, y + 1)));
    expect(Math.min(...row)).toBeLessThan(luma(FAWN) * 0.6);                 // …with a wrinkle across it
    expect(Math.max(...row)).toBeGreaterThan(luma(FAWN) * 0.85);
  });

  it('has big dark round eyes with a glint, and a pink tongue', () => {
    const [x, y] = faceRect(M.parts[P('eyeL')], F_FRONT);
    expect(texel(skin, x + 1, y + 1)).toEqual([255, 255, 255]);             // the glint
    expect(luma(texel(skin, x + 2, y + 2))).toBeLessThan(40);               // the dark of the eye
    expect(texel(skin, x, y)).toEqual(texel(skin, x + 3, y + 3));            // round: corners in the mask's black
    expect(luma(texel(skin, x, y))).toBeLessThan(40);
    // his shut eyes are drawn on the mask under the eye boxes (covered while he's awake, seen while he sleeps)
    const [hx, hy] = faceRect(M.parts[P('head')], F_FRONT);
    for (const c of [1, 2, 3, 4, 9, 10, 11, 12]) expect(luma(texel(skin, hx + c, hy + 6))).toBeGreaterThan(luma(MASK) + 20);
    const t = mean(skin, 'tongue', F_FRONT);
    expect(t[0]).toBeGreaterThan(200); expect(t[0] - t[1]).toBeGreaterThan(80); expect(t[2]).toBeGreaterThan(t[1]);
  });
});

/** Pose Bentley in `state` at `age`: positions in texels, yaw 0 */
function posed(state: BentleyState, age: number): Float32Array {
  const n = vertexCount(M), pos = new Float32Array(n * 3), p = restPose(M);
  bentleyPose(state, age, p);
  poseModel(M, p, 0, pos, new Float32Array(n * 3), new Float64Array(M.parts.length * 12));
  return pos.map((v) => v * 32);
}
/** [min, max] of coordinate k (0 x, 1 y, 2 z) over part `name` (or every part) */
function extent(pos: Float32Array, k: number, name?: string): number[] {
  const parts = name ? [P(name)] : M.parts.map((_, i) => i);
  let lo = Infinity, hi = -Infinity;
  for (const i of parts) for (let v = i * 24; v < i * 24 + 24; v++) { lo = Math.min(lo, pos[v * 3 + k]); hi = Math.max(hi, pos[v * 3 + k]); }
  return [lo, hi];
}
const hidden = (pos: Float32Array, name: string) => extent(pos, 0, name)[1] - extent(pos, 0, name)[0] < 1e-3 && extent(pos, 1, name)[1] - extent(pos, 1, name)[0] < 1e-3;
const AGES = Array.from({ length: 40 }, (_, i) => i * 0.37);

describe("Bentley's poses", () => {
  it('stand on the ground in every state: nothing floats or sinks', () => {
    for (const s of BENTLEY_STATES) for (const a of AGES) {
      const [lo, hi] = extent(posed(s, a), 1);
      expect(lo, `${s} at ${a}`).toBeGreaterThan(-2.5);          // texels: no more than a sliver in the ground
      expect(lo, `${s} at ${a}`).toBeLessThan(1);
      expect(hi).toBeLessThan(32);
    }
  });

  it('standing: 0.6 of a block at the shoulder, 0.8 to the top of his head, about 0.9 long; a pug-sized collision box', () => {
    const pos = posed('idle', 0);
    expect(extent(pos, 1, 'body')[1] / 32).toBeCloseTo(0.6, 1);
    expect(extent(pos, 1, 'head')[1] / 32).toBeCloseTo(0.8, 1);
    expect((extent(pos, 2)[1] - extent(pos, 2)[0]) / 32).toBeCloseTo(0.95, 1);
    expect(extent(pos, 1)[1] / 32).toBeLessThanOrEqual(BENTLEY.h);
    expect(BENTLEY.r * 2).toBeLessThan(1);                         // fits through a 1-block gap
  });

  it('sitting: rear on the ground, front up, head higher than standing, front legs straight down', () => {
    const sit = posed('sit', 1), stand = posed('idle', 1);
    expect(extent(sit, 1, 'body')[0]).toBeLessThan(1);
    expect(extent(sit, 1, 'body')[1]).toBeGreaterThan(extent(stand, 1, 'body')[1]);
    expect(extent(sit, 1, 'head')[1]).toBeGreaterThan(extent(stand, 1, 'head')[1] + 1);
    for (const leg of ['legFL', 'legFR']) {
      expect(extent(sit, 1, leg)[0]).toBeLessThan(0.5);            // on the ground
      expect(extent(sit, 2, leg)[1] - extent(sit, 2, leg)[0]).toBeLessThan(5.5);   // upright: no wider than the leg
    }
  });

  it('asleep: lying on his side, low, legs out sideways, eyes shut', () => {
    const sleep = posed('sleep', 2), stand = posed('idle', 2);
    expect(extent(sleep, 1)[1]).toBeLessThan(extent(stand, 1)[1] - 6);
    for (const leg of ['legFL', 'legBL', 'legFR', 'legBR']) {
      const [x0, x1] = extent(sleep, 0, leg), [y0, y1] = extent(sleep, 1, leg);
      expect(x1 - x0).toBeGreaterThan(y1 - y0);                   // lying across, not standing up
    }
    expect(hidden(sleep, 'eyeL') && hidden(sleep, 'eyeR')).toBe(true);
    for (const s of ['idle', 'walk', 'sit', 'wag'] as const) expect(hidden(posed(s, 2), 'eyeL')).toBe(false);
  });

  it('shows his tongue only when he pants: walking and wagging', () => {
    for (const s of BENTLEY_STATES) expect(hidden(posed(s, 1.3), 'tongue'), s).toBe(s !== 'walk' && s !== 'wag');
  });

  it('walks with a waddle: diagonal legs together, body rolling side to side', () => {
    const p = restPose(M), legs = ['legFL', 'legFR', 'legBL', 'legBR'].map(P), body = P('body');
    let swing = 0, roll = 0;
    for (const a of AGES) {
      p.fill(0);
      bentleyPose('walk', a, p);
      const [fl, fr, bl, br] = legs.map((i) => p[i * POSE]);
      expect(fl).toBeCloseTo(br, 9); expect(fr).toBeCloseTo(bl, 9); expect(fl).toBeCloseTo(-fr, 9);
      swing = Math.max(swing, Math.abs(fl));
      roll = Math.max(roll, Math.abs(p[body * POSE + 2]));
    }
    expect(swing).toBeGreaterThan(0.4);
    expect(roll).toBeGreaterThan(0.05);
  });

  it('wags: the tail swings side to side, fast', () => {
    const tips = Array.from({ length: 30 }, (_, i) => { const x = extent(posed('wag', i / 60), 0, 'tailTip'); return (x[0] + x[1]) / 2; });
    expect(Math.max(...tips) - Math.min(...tips)).toBeGreaterThan(4);
    const idle = Array.from({ length: 30 }, (_, i) => { const x = extent(posed('idle', i / 60), 0, 'tailTip'); return (x[0] + x[1]) / 2; });
    expect(Math.max(...idle) - Math.min(...idle)).toBeLessThan(2);
  });

  it('snorts and shakes his head every few seconds when he stands about', () => {
    let snorts = 0, was = false;
    const p = restPose(M), head = P('head');
    for (let a = 0; a < 60; a += 1 / 60) {
      const s = snortAt(a);
      if (s >= 0 && !was) snorts++;
      was = s >= 0;
      p.fill(0);
      bentleyPose('idle', a, p);
      if (s < 0) expect(Math.abs(p[head * POSE + 1])).toBeLessThanOrEqual(0.15);
    }
    expect(snorts).toBeGreaterThanOrEqual(9);
    expect(snorts).toBeLessThanOrEqual(10);
    // the shake swings the head well round
    let most = 0;
    for (let a = 0; a < 6; a += 1 / 60) if (snortAt(a) >= 0) { p.fill(0); bentleyPose('idle', a, p); most = Math.max(most, Math.abs(p[head * POSE + 1])); }
    expect(most).toBeGreaterThan(0.3);
  });

  it('moves smoothly: no part jumps from one frame to the next in any state', () => {
    for (const s of BENTLEY_STATES) {
      let prev = posed(s, 0), most = 0;
      for (let f = 1; f < 600; f++) {
        const pos = posed(s, f / 60);
        for (let i = 0; i < pos.length; i++) most = Math.max(most, Math.abs(pos[i] - prev[i]));
        prev = pos;
      }
      expect(most, s).toBeLessThan(3.5);                          // texels a frame: under 2 blocks a second
    }
  });
});

describe('what Bentley does', () => {
  const creature = (state: string): Creature => ({ body: { p: [100.5, 50, 100.5], v: [0, 0, 0], r: 0.3, h: 0.85, onGround: true }, yaw: 0, state, t: 0, age: 0, bumped: false });
  /** Run his behaviour for `seconds` (moving him by his velocity, no physics); returns the Zs he made */
  function live(c: Creature, seconds: number): number[][] {
    const zs: number[][] = [], fx = { zzz: (x: number, y: number, z: number) => { zs.push([x, y, z]); } }, dt = 1 / 60;
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      c.t += dt; c.age += dt;
      BENTLEY.think(c, dt, fx);
      c.body.p[0] += c.body.v[0] * dt; c.body.p[2] += c.body.v[2] * dt;
    }
    return zs;
  }

  it('walks round a small circle (until he can follow you), at a walk', () => {
    const c = creature('walk'), start = c.body.p.slice();
    live(c, 1);
    expect(Math.hypot(c.body.v[0], c.body.v[2])).toBeCloseTo(WALK_SPEED, 1);
    live(c, (2 * Math.PI) / WALK_TURN - 1);
    expect(Math.hypot(c.body.p[0] - start[0], c.body.p[2] - start[2])).toBeLessThan(0.3);   // back round
  });

  it('keeps still otherwise', () => {
    for (const s of ['idle', 'sit', 'sleep', 'wag']) {
      const c = creature(s);
      c.body.v[0] = 2;
      live(c, 1);
      expect(Math.abs(c.body.v[0])).toBeLessThan(0.01);
    }
  });

  it('asleep, a Z rises from over his head every couple of seconds; awake, none', () => {
    for (const yaw of [0, 1.2]) {
      const c = creature('sleep');
      c.yaw = yaw;
      const zs = live(c, 10);
      expect(zs.length).toBe(Math.floor((10 - 0.6) / ZZZ_EVERY) + 1);
      for (const z of zs) {
        expect(z).toEqual(zzzFrom(c));
        expect(z[1] - c.body.p[1]).toBeCloseTo(0.6, 6);
        expect(Math.hypot(z[0] - c.body.p[0], z[2] - c.body.p[2])).toBeLessThan(0.6);
      }
      // ahead of him, the way he faces
      expect((zs[0][0] - c.body.p[0]) * -Math.sin(yaw) + (zs[0][2] - c.body.p[2]) * -Math.cos(yaw)).toBeGreaterThan(0.2);
    }
    for (const s of ['idle', 'walk', 'sit', 'wag']) expect(live(creature(s), 10)).toEqual([]);
  });
});
