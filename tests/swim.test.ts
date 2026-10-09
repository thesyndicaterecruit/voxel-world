import { beforeAll, describe, expect, it } from 'vitest';
import { CHUNK_VOL, CI, EYE, WALK } from '../src/config';
import { STONE, WATER } from '../src/blocks';
import { world, inWater, waterDepth } from '../src/world';
import { P, V, player, update, BREATH, type Controls } from '../src/player';

// A pool, x and z 260–275, of still water from y 10 to 17 (the surface at 17.875), in stone that
// stands a block above it (the ground at y 19): a 1-block ledge all round
const SURFACE = 17.875, GROUND = 19;
beforeAll(() => {
  for (let cz = 15; cz <= 17; cz++) for (let cx = 15; cx <= 17; cx++) {
    const d = new Uint8Array(CHUNK_VOL);
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const x = cx * 16 + lx, z = cz * 16 + lz, pool = x >= 260 && x <= 275 && z >= 260 && z <= 275;
      for (let y = 0; y < GROUND; y++) d[CI(lx, y, lz)] = y < 10 || !pool ? STONE : y <= 17 ? WATER : 0;
    }
    world.setChunk(cx, cz, d);
  }
  // a stream: flowing water levels 1–6 running toward +x along z = 280, in a stone trench
  for (let x = 250; x <= 256; x++) {
    world.setBlock(x, GROUND - 1, 280, WATER, x - 250);
    world.setBlock(x, GROUND - 1, 279, STONE); world.setBlock(x, GROUND - 1, 281, STONE);
  }
});

const still: Controls = { x: 0, z: 0, run: false, jump: false };
/** Put the player at (x, y, z), still, facing `yaw`, then run `seconds` of physics at 60 fps with controls `ctl`; calls `each` after every step */
function run(at: number[] | null, seconds: number, ctl: Controls, each?: () => void, yaw = 0): void {
  if (at) { P[0] = at[0]; P[1] = at[1]; P[2] = at[2]; V.fill(0); player.yaw = yaw; player.wet = 0; }
  for (let i = 0; i < Math.round(seconds * 60); i++) { update(1 / 60, ctl); each?.(); }
}

describe('being in water', () => {
  it('knows how deep a point is', () => {
    expect(inWater(268, 17.5, 268)).toBe(true);
    expect(inWater(268, 17.95, 268)).toBe(false);
    expect(waterDepth(268, 12, 268)).toBeCloseTo(SURFACE - 12, 5);
    expect(waterDepth(250, 25, 250)).toBe(-1);
  });
});

describe('swimming', () => {
  it('sinks slowly without JUMP, instead of falling', () => {
    run([268, 13, 268], 1, still);
    expect(player.wet).toBe(3);
    expect(V[1]).toBeCloseTo(-1, 1);
    expect(P[1]).toBeGreaterThan(13 - 1.1);
    expect(P[1]).toBeLessThan(13 - 0.5);
  });

  it('swims up at about 3 blocks a second with JUMP held', () => {
    run([268, 10.5, 268], 0.6, { ...still, jump: true });
    expect(V[1]).toBeGreaterThan(2.6);
    expect(V[1]).toBeLessThan(3.1);
  });

  it('keeps bobbing at the surface with the head above water while JUMP is held', () => {
    run([268, 10, 268], 4, { ...still, jump: true });
    const eyes: number[] = [], feet: number[] = [];
    run(null, 3, { ...still, jump: true }, () => { eyes.push(P[1] + EYE); feet.push(P[1]); });
    expect(Math.min(...eyes)).toBeGreaterThan(SURFACE + 0.2);    // head out all the time
    expect(Math.max(...feet)).toBeLessThan(SURFACE);              // still in the water, not jumping out
    expect(Math.max(...eyes) - Math.min(...eyes)).toBeGreaterThan(0.05);   // bobbing up and down
  });

  it('brakes a fall into water hard', () => {
    let speed = 0;
    run([268, 40, 268], 3, still, () => { if (P[1] < SURFACE - 3 && !speed) speed = -V[1]; });
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThan(8);                                // falling ~27 blocks a second when it hit
  });

  it('is slower than walking', () => {
    run([268, 13, 268], 1.5, { ...still, z: -1 });
    expect(Math.hypot(V[0], V[2])).toBeCloseTo(WALK * 0.55, 1);
  });

  it('climbs out over a 1-block ledge with forward and JUMP held, and not without JUMP', () => {
    // floating at the surface by the pool's north wall (z = 259), facing it (yaw 0 looks toward −z)
    run([268.5, SURFACE - 1.1, 260.5], 3, { ...still, z: -1 });
    expect(P[2]).toBeGreaterThan(260);                            // no auto-jump while swimming
    expect(player.wet).toBeGreaterThan(0);
    run(null, 2, { ...still, z: -1, jump: true });
    expect(P[2]).toBeLessThan(259.7);                             // over the wall
    run(null, 1, still);
    expect(P[1]).toBeCloseTo(GROUND, 3);
    expect(player.onGround).toBe(true);
    expect(player.wet).toBe(0);
  });

  it('is carried along by flowing water', () => {
    run([251.5, GROUND - 1, 280.5], 1, still);
    expect(player.wet).toBe(1);
    expect(V[0]).toBeGreaterThan(0.6);
    expect(Math.abs(V[2])).toBeLessThan(0.05);
  });

  it('keeps count of the air left with the head under water', () => {
    player.breath = BREATH;
    run([268, 12, 268], 4, still);
    expect(player.breath).toBeCloseTo(BREATH - 4, 1);
    run([268, GROUND, 250], 2, still);
    expect(player.breath).toBe(BREATH);
  });
});
