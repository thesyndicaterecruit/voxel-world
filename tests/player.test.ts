import { beforeAll, describe, expect, it } from 'vitest';
import { CHUNK_VOL, CI, WALK } from '../src/config';
import { STONE, ICE, PACKED_ICE } from '../src/blocks';
import { world } from '../src/world';
import { P, V, player, update, type Controls } from '../src/player';

// A stone floor (its top at y = 20) with lanes of ice and of packed ice in it, running along x
const FLOOR = 20, STONE_Z = 262, ICE_Z = 270, PACKED_Z = 278;
beforeAll(() => {
  for (let cz = 15; cz <= 18; cz++) for (let cx = 15; cx <= 19; cx++) {
    const d = new Uint8Array(CHUNK_VOL);
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) for (let y = 0; y < FLOOR; y++) d[CI(lx, y, lz)] = STONE;
    world.setChunk(cx, cz, d);
  }
  for (let x = 250; x < 310; x++) for (let dz = -2; dz <= 2; dz++) {
    world.setBlock(x, FLOOR - 1, ICE_Z + dz, ICE);
    world.setBlock(x, FLOOR - 1, PACKED_Z + dz, PACKED_ICE);
  }
});

const forward: Controls = { x: 0, z: -1, run: false, jump: false }, still: Controls = { x: 0, z: 0, run: false, jump: false };
/** Walk toward +x along lane z for `go` seconds, then let go: [speed after `go`, blocks slid after letting go] */
function walk(z: number, go: number): [number, number] {
  P[0] = 255.5; P[1] = FLOOR; P[2] = z + 0.5; V.fill(0); player.yaw = -Math.PI / 2;
  for (let i = 0; i < Math.round(go * 60); i++) update(1 / 60, forward);
  const speed = V[0], at = P[0];
  for (let i = 0; i < 180; i++) update(1 / 60, still);
  return [speed, P[0] - at];
}

describe('walking on ice', () => {
  it('slides: slow to get going and slow to stop', () => {
    const [stoneFast, stoneSlide] = walk(STONE_Z, 0.25), [iceSlow, iceSlide] = walk(ICE_Z, 0.25);
    expect(stoneFast).toBeGreaterThan(WALK * 0.9);                // on stone the feet grip: full speed at once
    expect(iceSlow).toBeLessThan(WALK * 0.5);                     // on ice it takes a while
    const [iceFast, iceSlideFast] = walk(ICE_Z, 3);
    expect(iceFast).toBeGreaterThan(WALK * 0.9);                  // but gets there
    expect(stoneSlide).toBeLessThan(0.5);                         // stone stops you dead
    expect(iceSlideFast).toBeGreaterThan(stoneSlide * 6);         // ice lets you slide on
    expect(iceSlideFast).toBeGreaterThan(2);
    expect(iceSlide).toBeLessThan(iceSlideFast);
    expect(P[1]).toBe(FLOOR);                                     // on the ice, not in it
  });

  it('packed ice is just as slippery', () => {
    const [, slide] = walk(PACKED_Z, 3), [, ice] = walk(ICE_Z, 3);
    expect(slide).toBeCloseTo(ice, 5);
  });
});
