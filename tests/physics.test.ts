import { beforeAll, describe, expect, it } from 'vitest';
import { CHUNK_VOL, CI, PR, PH } from '../src/config';
import { STONE, ICE, WATER } from '../src/blocks';
import { world } from '../src/world';
import { P, V, player, update, collides, type Controls } from '../src/player';
import { boxCollides, moveBody, stepBody, unstick, TERMINAL, type Body } from '../src/physics';

// A stone floor (its top at y = 20) over chunks 15–19 × 15–20, with a pool, a step, a wall, a lane of
// ice and a low roof for the player's run (z < 304), and a course for bodies at z 310–330
const FLOOR = 20;
beforeAll(() => {
  for (let cz = 15; cz <= 20; cz++) for (let cx = 15; cx <= 19; cx++) {
    const d = new Uint8Array(CHUNK_VOL);
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const x = cx * 16 + lx, z = cz * 16 + lz, pool = x >= 290 && x <= 300 && z >= 290 && z <= 300;
      for (let y = 0; y < FLOOR; y++) d[CI(lx, y, lz)] = !pool || y < 12 ? STONE : y <= 18 ? WATER : 0;
    }
    world.setChunk(cx, cz, d);
  }
  for (let z = 258; z <= 266; z++) { world.setBlock(260, FLOOR, z, STONE); world.setBlock(266, FLOOR, z, STONE); world.setBlock(266, FLOOR + 1, z, STONE); }
  for (let x = 250; x < 285; x++) for (let dz = -2; dz <= 2; dz++) world.setBlock(x, FLOOR - 1, 275 + dz, ICE);
  for (let x = 268; x <= 272; x++) for (let z = 280; z <= 284; z++) world.setBlock(x, FLOOR + 1, z, STONE);   // a low roof
  // the bodies' course: a wall across x = 270, a roof 1 block up over x 280–284, a 1-wide gap in a wall at z = 325
  for (let z = 310; z <= 320; z++) for (let y = FLOOR; y < FLOOR + 3; y++) world.setBlock(270, y, z, STONE);
  for (let x = 280; x <= 284; x++) for (let z = 310; z <= 320; z++) world.setBlock(x, FLOOR + 1, z, STONE);
  for (let x = 250; x <= 300; x++) if (x !== 260) for (let y = FLOOR; y < FLOOR + 3; y++) world.setBlock(x, y, 325, STONE);
});

describe('the player moves exactly as before bodies were shared', () => {
  it('reproduces a recorded run bit for bit: walking, a step, a wall, jumping, ice, a pool, a low roof, stuck in stone', () => {
    // a hash of every position, velocity and state after every step, recorded with player.ts before
    // its collision moved to physics.ts
    let h = 2166136261;
    const dv = new DataView(new ArrayBuffer(8));
    const mix = (v: number) => { dv.setFloat64(0, v); for (let i = 0; i < 8; i++) h = Math.imul(h ^ dv.getUint8(i), 16777619); };
    const run = (at: number[] | null, yaw: number, seconds: number, ctl: Controls, fps = 60) => {
      if (at) { P[0] = at[0]; P[1] = at[1]; P[2] = at[2]; V.fill(0); player.yaw = yaw; player.onGround = false; player.wet = 0; player.jumpBuf = 0; }
      for (let i = 0; i < Math.round(seconds * fps); i++) {
        update(1 / fps, ctl);
        for (const v of P) mix(v);
        for (const v of V) mix(v);
        mix(+player.onGround); mix(player.wet); mix(player.breath);
      }
    };
    const c = (x: number, z: number, run = false, jump = false): Controls => ({ x, z, run, jump });
    run([255.5, FLOOR + 3, 262.5], -Math.PI / 2, 4, c(0, -1));           // fall, walk into a step (auto-jump), over it, into a wall
    run(null, -Math.PI / 2 + 0.4, 1, c(0.3, -1, true));                   // slide along the wall, sprinting
    run(null, 1, 1.5, c(0, -1, false, true));                             // jumping
    run([252.5, FLOOR, 275.5], -Math.PI / 2, 2, c(0, -1, true));           // ice
    run(null, -Math.PI / 2, 2, c(0, 0));
    run([295.5, 30, 295.5], 0.3, 3, c(0, 0));                             // into the pool from high up
    run(null, 0.3, 2, c(0, -1, false, true));                             // swim, climb out
    run([296.5, 15, 296.5], 0, 3, c(0.5, -0.5, false, true));
    run([270.5, FLOOR, 286.5], 0, 2, c(0, -1, false, true), 30);          // under a low roof, 30 fps
    run([262.5, 12.3, 262.5], 0, 0.5, c(0, 0), 45);                       // stuck inside stone
    expect((h >>> 0).toString(16)).toBe('a6c313e0');
    expect(P).toEqual([262.5, 20, 262.5]);
  });

  it('is a body, its own P and V', () => {
    expect(player.p).toBe(P);
    expect(player.v).toBe(V);
    expect([player.r, player.h]).toEqual([PR, PH]);
    for (const at of [[262.5, FLOOR, 262.5], [260.5, FLOOR - 0.5, 262.5], [265.75, FLOOR, 262.5], [270.5, FLOOR + 0.3, 282.5]]) {
      expect(collides(at[0], at[1], at[2])).toBe(boxCollides(at[0], at[1], at[2], PR, PH));
    }
  });
});

const body = (x: number, y: number, z: number, r = 0.3, h = 0.85): Body => ({ p: [x, y, z], v: [0, 0, 0], r, h, onGround: false });
/** Run a body's physics for `seconds` at `fps`, pushing it along (vx, vz) every step; returns the hits seen */
function go(b: Body, seconds: number, vx = 0, vz = 0, fps = 60): number {
  let hits = 0;
  for (let i = 0; i < Math.round(seconds * fps); i++) { b.v[0] = vx; b.v[2] = vz; hits |= stepBody(b, 1 / fps); }
  return hits;
}

describe('bodies', () => {
  it('fall and land flush on the ground, the same at any frame rate', () => {
    const a = body(255.5, FLOOR + 6, 312.5), b = body(256.5, FLOOR + 6, 312.5);
    go(a, 0.3);
    expect(a.onGround).toBe(false);
    expect(a.v[1]).toBeLessThan(-5);
    go(a, 1.2); go(b, 1.5, 0, 0, 24);
    for (const x of [a, b]) {
      expect(x.p[1]).toBe(FLOOR);
      expect(x.onGround).toBe(true);
      expect(x.v[1]).toBe(0);
    }
  });

  it('never fall faster than terminal speed', () => {
    const b = body(255.5, 110, 314.5);
    go(b, 2);
    expect(b.v[1]).toBe(-TERMINAL);
  });

  it('stop flush against a wall, which is told as a hit on that axis', () => {
    const b = body(266.5, FLOOR, 315.5);
    expect(go(b, 3, 1.5, 0)).toBe(1);
    expect(b.p[0]).toBeCloseTo(270 - 0.3, 9);
    expect(b.v[0]).toBe(0);
    const c = body(255.5, FLOOR, 321.5);
    expect(go(c, 3, 0, 1.5)).toBe(2);
    expect(c.p[2]).toBeCloseTo(325 - 0.3, 9);
  });

  it('slide along a wall they walk into at an angle', () => {
    const b = body(266.5, FLOOR, 312.5);
    go(b, 3, 1.5, 1);
    expect(b.p[0]).toBeCloseTo(269.7, 9);
    expect(b.p[2]).toBeGreaterThan(314);
  });

  it('fit where their size fits: under a low roof and through a 1-wide gap, where bigger ones are stopped', () => {
    const dog = body(277.5, FLOOR, 315.5), tall = body(277.5, FLOOR, 316.5, 0.3, 1.8);
    go(dog, 3, 1.5, 0); go(tall, 3, 1.5, 0);
    expect(dog.p[0]).toBeGreaterThan(281);                      // under the roof one block up
    expect(tall.p[0]).toBeCloseTo(280 - 0.3, 9);                // the player's size is stopped
    const slim = body(260.5, FLOOR, 322.5), wide = body(260.5, FLOOR, 323.5, 0.6);
    go(slim, 3, 0, 1.5); go(wide, 3, 0, 1.5);
    expect(slim.p[2]).toBeGreaterThan(326);                     // through the gap at x = 260
    expect(wide.p[2]).toBeLessThan(325);
  });

  it('rise out of solid blocks they are stuck in', () => {
    const b = body(256.5, FLOOR - 3.4, 318.5);
    unstick(b);
    expect(b.p[1]).toBe(FLOOR);
    expect(boxCollides(b.p[0], b.p[1], b.p[2], b.r, b.h)).toBe(false);
  });

  it('moveBody moves by the given vertical speed and says which ways it was stopped', () => {
    const b = body(268.5, FLOOR + 0.5, 312.5);
    b.v[0] = 10;
    expect(moveBody(b, 0.5, -2)).toBe(1);
    expect(b.p[1]).toBe(FLOOR);
    expect(b.onGround).toBe(true);
  });
});
