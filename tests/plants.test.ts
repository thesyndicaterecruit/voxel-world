import { describe, expect, it } from 'vitest';
import { CHUNK_VOL, CI, CS } from '../src/config';
import { AIR, STONE, SAND, WATER, TORCH, TALL_GRASS, SEAGRASS, CACTUS, LILY_PAD, VINES, WATERLOGGED, LEAVES, GLASS, SNOW,
  PAW_PRINTS, BAUBLE, BAUBLES, FAIRY_LIGHTS, WREATH, STOCKING, STAR } from '../src/blocks';
import { World } from '../src/world';
import { popUnsupported, holds, blockBox, plantOffset, CROSS_IN, INSET, flatWall, flatTurn, flatTurnFor, FLAT_TURNED } from '../src/plants';
import { TORCH_SUPPORT } from '../src/torch';

/** 3×3 chunks round chunk (16, 16) — x and z 240–287 — stone up to y = 9; `popped` lists what fell off */
function testWorld() {
  const w = new World();
  for (let cz = 15; cz <= 17; cz++) for (let cx = 15; cx <= 17; cx++) {
    const d = new Uint8Array(CHUNK_VOL);
    for (let i = 0; i < CI(0, 10, 0); i++) d[i] = STONE;
    w.setChunk(cx, cz, d);
  }
  const popped: number[][] = [];
  /** Change a block the way the game does: whatever it held up pops off */
  const set = (x: number, y: number, z: number, id: number, st = 0) => {
    w.setBlock(x, y, z, id, st);
    popUnsupported(w, x, y, z, (px, py, pz, pid) => popped.push([px, py, pz, pid]));
  };
  return { w, set, popped };
}
const Y = 10, X = 264, Z = 264;

describe('plants and torches pop off', () => {
  it('when the ground under a plant goes', () => {
    const t = testWorld();
    t.w.setBlock(X, Y, Z, TALL_GRASS);
    t.set(X + 1, Y - 1, Z, AIR);                       // next door: nothing happens
    expect(t.w.getBlock(X, Y, Z)).toBe(TALL_GRASS);
    t.set(X, Y - 1, Z, AIR);
    expect(t.w.getBlock(X, Y, Z)).toBe(AIR);
    expect(t.popped).toEqual([[X, Y, Z, TALL_GRASS]]);
  });

  it('all the way up a cactus, and only above where it was cut', () => {
    const t = testWorld();
    t.w.setBlock(X, Y - 1, Z, SAND);
    for (let y = Y; y < Y + 3; y++) t.w.setBlock(X, y, Z, CACTUS);
    expect(holds(t.w, CACTUS, 0, X, Y + 2, Z)).toBe(true);         // cactus stands on cactus
    t.set(X, Y + 1, Z, AIR);                                        // cut the middle: the top falls
    expect([Y, Y + 1, Y + 2].map((y) => t.w.getBlock(X, y, Z))).toEqual([CACTUS, AIR, AIR]);
    t.w.setBlock(X, Y + 1, Z, CACTUS);
    t.set(X, Y - 1, Z, AIR);                                        // the sand under it: the lot
    expect([Y, Y + 1].map((y) => t.w.getBlock(X, y, Z))).toEqual([AIR, AIR]);
    expect(t.popped.length).toBe(3);
  });

  it('down a curtain of vines, from where the wall behind it went', () => {
    const t = testWorld();
    t.w.setBlock(X - 1, Y + 5, Z, STONE);                       // a wall at −x, up high
    for (let y = Y + 1; y <= Y + 5; y++) t.w.setBlock(X, y, Z, VINES, 1);   // state 1: the wall is at −x
    for (let y = Y + 1; y <= Y + 5; y++) expect(holds(t.w, VINES, 1, X, y, Z), `y ${y}`).toBe(true);
    expect(holds(t.w, VINES, 2, X, Y + 5, Z)).toBe(false);      // facing the other way: nothing there
    expect(holds(t.w, VINES, 0, X, Y + 5, Z)).toBe(false);      // vines don't lie on the floor
    t.set(X, Y + 3, Z, AIR);                                    // cut the curtain: what hung below falls
    expect([1, 2, 3, 4, 5].map((d) => t.w.getBlock(X, Y + d, Z))).toEqual([AIR, AIR, AIR, VINES, VINES]);
    t.set(X - 1, Y + 5, Z, AIR);                                // and the wall: the rest
    expect([4, 5].map((d) => t.w.getBlock(X, Y + d, Z))).toEqual([AIR, AIR]);
  });

  it('a lily pad when the water under it drains, seagrass leaving its water behind', () => {
    const t = testWorld();
    t.w.setBlock(X, Y, Z, WATER);
    t.w.setBlock(X, Y + 1, Z, LILY_PAD);
    t.w.setBlock(X + 1, Y, Z, SEAGRASS, WATERLOGGED);
    t.set(X, Y, Z, AIR);
    expect(t.w.getBlock(X, Y + 1, Z)).toBe(AIR);
    t.set(X + 1, Y - 1, Z, AIR);                                 // the ground under the seagrass
    expect([t.w.getBlock(X + 1, Y, Z), t.w.getState(X + 1, Y, Z)]).toEqual([WATER, 0]);
    expect(t.popped.map((p) => p[3])).toEqual([LILY_PAD, SEAGRASS]);
  });

  it('never because the wall behind is in a chunk that isn\'t loaded', () => {
    const t = testWorld();
    const x = 18 * CS - 1;                                      // the last column before chunk 18, which isn't loaded
    t.w.setBlock(x, Y + 1, Z, VINES, 2);                         // on the wall at +x
    t.w.setBlock(x, Y + 2, Z, TORCH, 2);
    t.set(x, Y, Z, AIR);                                          // a change next to them
    expect([t.w.getBlock(x, Y + 1, Z), t.w.getBlock(x, Y + 2, Z)]).toEqual([VINES, TORCH]);
  });

  it('a torch, on the floor or on a wall, when what holds it goes — not otherwise', () => {
    const t = testWorld();
    t.w.setBlock(X, Y, Z, TORCH, 0);                             // standing on the ground
    t.w.setBlock(X + 2, Y + 1, Z, STONE);
    t.w.setBlock(X + 1, Y + 1, Z, TORCH, 2);                      // state 2: on the wall at +x
    t.set(X + 2, Y + 2, Z, STONE);                                // building nearby changes nothing
    expect([t.w.getBlock(X, Y, Z), t.w.getBlock(X + 1, Y + 1, Z)]).toEqual([TORCH, TORCH]);
    t.set(X + 2, Y + 1, Z, AIR);
    t.set(X, Y - 1, Z, AIR);
    expect([t.w.getBlock(X, Y, Z), t.w.getBlock(X + 1, Y + 1, Z)]).toEqual([AIR, AIR]);
  });
});

describe('plant models', () => {
  it('sit a little off the middle of their block, the same every time, without leaving their chunk', () => {
    const seen = new Set<string>();
    for (let x = 0; x < 64; x++) for (let z = 0; z < 4; z++) {
      const [ox, oz] = plantOffset(7, x, 20, z);
      expect([ox, oz]).toEqual([...plantOffset(7, x, 20, z)]);
      expect(Math.abs(ox)).toBeLessThanOrEqual(0.2);
      expect(Math.abs(oz)).toBeLessThanOrEqual(0.2);
      if ((x & (CS - 1)) === 0) expect(ox + CROSS_IN).toBeGreaterThanOrEqual(0);
      if ((z & (CS - 1)) === 0) expect(oz + CROSS_IN).toBeGreaterThanOrEqual(0);
      seen.add(ox.toFixed(2));
    }
    expect(seen.size).toBeGreaterThan(30);
  });

  it('are hit only where they are: small boxes for plants and torches, the whole block for cubes', () => {
    expect(blockBox(STONE, 0, 1, 0, 0, 0)).toBeNull();
    expect(blockBox(CACTUS, 0, 1, 0, 0, 0)).toEqual([INSET, 0, INSET, 1 - INSET, 1, 1 - INSET]);
    const [ox, oz] = plantOffset(1, 5, 9, 5), g = blockBox(TALL_GRASS, 0, 1, 5, 9, 5)!;
    expect(g[0] - ox).toBeCloseTo(0.15);
    expect(g[2] - oz).toBeCloseTo(0.15);
    expect(blockBox(SEAGRASS, WATERLOGGED, 1, 5, 9, 5)).toEqual([0.15, 0, 0.15, 0.85, 0.9, 0.85]);   // seagrass isn't offset
    expect(blockBox(LILY_PAD, 0, 1, 0, 0, 0)![4]).toBeLessThan(0.2);                              // flat on the floor
    expect(blockBox(VINES, 1, 1, 0, 0, 0)).toEqual([0, 0, 0, 0.1, 1, 1]);                          // against the wall at −x
    expect(blockBox(VINES, 4, 1, 0, 0, 0)).toEqual([0, 0, 0.9, 1, 1, 1]);                          // … at +z
    expect(blockBox(TORCH, 0, 1, 0, 0, 0)![4]).toBeLessThan(1);
  });
});

describe('Christmas decorations', () => {
  const BAUBLE_IDS = BAUBLES.map((_, i) => BAUBLE + i), WALL_DECOR = [FAIRY_LIGHTS, WREATH, STOCKING];

  it('hang a bauble under a solid cube — leaves, glass — and nothing else', () => {
    const t = testWorld();
    for (const [above, ok] of [[STONE, true], [LEAVES, true], [GLASS, true], [AIR, false], [TORCH, false], [BAUBLE, false], [WATER, false],
      [CACTUS, false]] as const) {
      t.w.setBlock(X, Y + 4, Z, above);
      for (const id of BAUBLE_IDS) expect(holds(t.w, id, 0, X, Y + 3, Z), `${id} under ${above}`).toBe(ok);
    }
  });

  it('every one pops off when what holds it goes, in every state it can be in', () => {
    const t = testWorld();
    /** Put `id` (state `st`) at (x, y, z) held by `support` at (sx, sy, sz); take the support away: it pops, and only it */
    const check = (id: number, st: number, [x, y, z]: number[], support: number, [sx, sy, sz]: number[]) => {
      t.w.setBlock(sx, sy, sz, support);
      t.w.setBlock(x, y, z, id, st);
      expect(holds(t.w, id, st, x, y, z), `${id}/${st} held`).toBe(true);
      t.popped.length = 0;
      t.set(sx, sy, sz, AIR);
      expect([t.w.getBlock(x, y, z), t.popped], `${id}/${st} popped`).toEqual([AIR, [[x, y, z, id]]]);
    };
    // paw prints on snow, turned every way (state 8 too, which a 3-bit mask would read as 0)
    for (let turn = 0; turn < 4; turn++) check(PAW_PRINTS, FLAT_TURNED + turn, [X, Y + 3, Z], SNOW, [X, Y + 2, Z]);
    // the star on top of a tree's leaves
    check(STAR, 0, [X, Y + 3, Z], LEAVES, [X, Y + 2, Z]);
    // baubles under stone and under leaves
    for (const id of BAUBLE_IDS) for (const above of [STONE, LEAVES]) check(id, 0, [X, Y + 3, Z], above, [X, Y + 4, Z]);
    // fairy lights, wreaths and stockings on each of the four walls
    for (const id of WALL_DECOR) for (let s = 1; s <= 4; s++) {
      const [dx, , dz] = TORCH_SUPPORT[s];
      check(id, s, [X, Y + 3, Z], STONE, [X + dx, Y + 3, Z + dz]);
    }
  });

  it('only vines hang from more of themselves: a stocking under a stocking still needs its wall', () => {
    for (const id of [VINES, ...WALL_DECOR]) {
      const t = testWorld();
      t.w.setBlock(X - 1, Y + 3, Z, STONE);                       // a wall at −x, for both
      t.w.setBlock(X - 1, Y + 2, Z, STONE);
      t.w.setBlock(X, Y + 3, Z, id, 1);
      t.w.setBlock(X, Y + 2, Z, id, 1);
      t.set(X - 1, Y + 2, Z, AIR);                                // the lower one's wall goes
      expect(t.w.getBlock(X, Y + 2, Z), `${id}`).toBe(id === VINES ? VINES : AIR);
      expect(t.w.getBlock(X, Y + 3, Z)).toBe(id);
    }
  });

  it('are hit only where they are: a bauble round its ball, up to what it hangs from; paw prints flat on the floor however turned', () => {
    for (const id of BAUBLES.map((_, i) => BAUBLE + i)) {
      const b = blockBox(id, 0, 1, 0, 0, 0)!;
      expect(b[4]).toBe(1);                                        // up to the block above
      expect(b[1]).toBeGreaterThan(0.1);                           // nothing to hit at its foot
      expect(b[3] - b[0]).toBeLessThan(0.5);                       // small: a tap beside it reaches the leaves
    }
    for (let turn = 0; turn < 4; turn++) expect(blockBox(PAW_PRINTS, FLAT_TURNED + turn, 1, 0, 0, 0)).toEqual([0, 0, 0, 1, 0.1, 1]);
    expect(blockBox(STOCKING, 3, 1, 0, 0, 0)).toEqual(blockBox(VINES, 3, 1, 0, 0, 0));
    expect(blockBox(STAR, 0, 1, 0, 0, 0)).toEqual([0.15, 0, 0.15, 0.85, 0.9, 0.85]);
  });

  it('read a flat block\'s state: 1–4 a wall, 5–8 the floor turned 0–3, 0 the floor turned by a hash', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(flatWall)).toEqual([0, 1, 2, 3, 4, 0, 0, 0, 0]);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(flatTurn)).toEqual([-1, -1, -1, -1, -1, 0, 1, 2, 3]);
    expect([flatWall(WATERLOGGED | 2), flatTurn(WATERLOGGED | 6)]).toEqual([2, 1]);   // the waterlogged bit doesn't count
  });

  it('turn the way the player looks, however far round they have turned', () => {
    // turns 0–3 point toward −z, −x, +z, +x; yaw 0 looks toward −z, and the look is (−sin yaw, −cos yaw)
    const DIRS = [[0, -1], [-1, 0], [0, 1], [1, 0]];
    for (let k = -1440; k <= 1440; k += 7) {
      const yaw = (k * Math.PI) / 180, turn = flatTurnFor(yaw);
      expect(turn).toBeGreaterThanOrEqual(0);
      expect(turn).toBeLessThan(4);
      expect(FLAT_TURNED + turn).toBeLessThanOrEqual(8);
      // the nearest of the four ways to where the player looks
      const lx = -Math.sin(yaw), lz = -Math.cos(yaw), best = DIRS.map(([x, z]) => x * lx + z * lz);
      expect(best[turn]).toBeCloseTo(Math.max(...best), 6);
    }
    expect([0, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI, (5 * Math.PI) / 2, (-7 * Math.PI) / 2, 2 * Math.PI + 0.1].map(flatTurnFor))
      .toEqual([0, 1, 2, 3, 2, 1, 1, 0]);
  });
});
