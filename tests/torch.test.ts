import { describe, expect, it } from 'vitest';
import { TORCH_FLOOR, TORCH_SUPPORT, TORCH_MODELS, torchStateFor, torchBox } from '../src/torch';

/** Normals of the faces a torch can be built against: top, +x, −x, +z, −z */
const FACES = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

describe('torch placement', () => {
  it('stands on a top face and leans out of a side face, held by the block it was built against', () => {
    const states = FACES.map(([x, y, z]) => torchStateFor(x, y, z));
    expect(states[0]).toBe(TORCH_FLOOR);
    expect(new Set(states).size).toBe(5);
    // the torch goes in the cell the normal points into, so its support is one step back
    FACES.forEach((n, i) => expect(TORCH_SUPPORT[states[i]]).toEqual(n.map((v) => (v === 0 ? 0 : -v))));
  });

  it('cannot hang from the underside of a block', () => {
    expect(torchStateFor(0, -1, 0)).toBe(-1);
  });
});

describe('torch model and hit box', () => {
  for (let s = 0; s <= 4; s++) {
    it(`state ${s}: model inside its block, hit box around the stick`, () => {
      const box = torchBox(s), pts = TORCH_MODELS[s].flatMap((q) => q.p);
      for (const p of pts) for (let a = 0; a < 3; a++) {
        expect(p[a]).toBeGreaterThanOrEqual(0);
        expect(p[a]).toBeLessThanOrEqual(32);
      }
      for (let a = 0; a < 3; a++) {
        expect(box[a]).toBeGreaterThanOrEqual(0);
        expect(box[a + 3]).toBeLessThanOrEqual(1);
        expect(box[a + 3] - box[a]).toBeGreaterThan(0.2);   // big enough to tap
      }
      // every corner of the stick (the shaded, not glowing, quads) is inside the box
      for (const q of TORCH_MODELS[s].filter((q) => !q.glow)) for (const p of q.p) for (let a = 0; a < 3; a++) {
        expect(p[a] / 32).toBeGreaterThanOrEqual(box[a] - 1e-9);
        expect(p[a] / 32).toBeLessThanOrEqual(box[a + 3] + 1e-9);
      }
    });
  }

  it('leans wall torches away from the wall: the foot touches it, the flame is further out', () => {
    for (let s = 1; s <= 4; s++) {
      const out = TORCH_SUPPORT[s].map((v) => -v), pts = TORCH_MODELS[s].flatMap((q) => q.p);
      // distance from the supporting wall along the outward direction, in texels
      const from = (p: number[]) => (out[0] ? (out[0] > 0 ? p[0] : 32 - p[0]) : out[2] > 0 ? p[2] : 32 - p[2]);
      const low = pts.filter((p) => p[1] < 6), high = pts.filter((p) => p[1] > 28);
      expect(Math.min(...low.map(from))).toBeLessThan(2);
      expect(Math.min(...high.map(from))).toBeGreaterThan(Math.max(...low.map(from)));
    }
  });
});
