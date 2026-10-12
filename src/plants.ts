import { CS, W, D } from './config';
import { AIR, WATER, VINES, SOLID, MODEL, SUPPORT, STACKS, LOGGABLE, OFFSET, WATERLOGGED, M_CUBE, M_TORCH, M_CROSS, M_INSET, M_FLAT,
  S_FLOOR, S_WATER, S_WALL, S_TORCH, S_HANG, waterState } from './blocks';
import { TORCH_SUPPORT, torchBox } from './torch';
import { hash3 } from './noise';

/* ============================ PLANTS ============================ */
// Blocks that aren't cubes (blocks.ts models cross, inset and flat): where their quads go, the box
// a tap has to hit, and what holds them up. Pure: shared by the mesher in workers, the raycast and
// the break/place logic.
//
// Support: a plant stands on the block below (a solid cube, or more of itself if it stacks), a lily
// pad on water, vines against a wall (the block their state faces, or more vines above facing the
// same way; other wall blocks only the wall), a torch on the block its state faces, a bauble hangs
// from the solid cube above it. Whenever a block changes, the blocks it held up
// that have nothing to hold them any more pop off (popUnsupported), and so on up the chain: break
// the sand under a cactus and the whole cactus falls.

/** How far a cross plant's quads stop short of its block's corners (blocks) */
export const CROSS_IN = 0.1;
/** How far the cactus's sides are in from its block's (1/16 block) */
export const INSET = 1 / 16;
/** A flat quad lies this far above its floor, or this far out from its wall (blocks) */
export const FLAT_UP = 1 / 64, FLAT_OUT = 1 / 16;
/** A lily pad floats on the water's surface, this far below the floor of its own block (a source's surface is 1/8 below its top) */
export const ON_WATER = 1 / 8 - 1 / 64;
/**
 * A flat block's state: 0 on the floor (or the water), turned by a hash of where it is (lily pads);
 * 1–4 against the wall at −x, +x, −z, +z (TORCH_SUPPORT); 5–8 on the floor, turned 0–3 (FLAT_TURNED +
 * the turn: blocks that turn the way the player looks, see flatTurnFor)
 */
export const FLAT_FLOOR = 0, FLAT_TURNED = 5;
/** The wall a flat block with state `st` is against: 1–4 (TORCH_SUPPORT), 0 on the floor */
export const flatWall = (st: number) => { const s = st & 15; return s >= 1 && s <= 4 ? s : 0; };
/** How a flat block on the floor is turned: 0–3 (its tile's top toward −z, −x, +z, +x), −1 by a hash of where it is */
export const flatTurn = (st: number) => { const s = st & 15; return s >= FLAT_TURNED && s < FLAT_TURNED + 4 ? s - FLAT_TURNED : -1; };
/** The turn (see flatTurn) of a block placed by a player looking along `yaw` (0 looks toward −z), however far round it is wound */
export const flatTurnFor = (yaw: number) => Math.round(yaw / (Math.PI / 2)) & 3;
/** A hanging block's hit box: round the ball, up to the block it hangs from */
const HANG_BOX = [0.28, 0.3, 0.28, 0.72, 1, 0.72];
/** How far an offset plant (grass, flowers) may sit off the middle of its block, each way */
const OFF = 0.2;
const K_OFF = 0x2d8f61a3;

const off = [0, 0];
/**
 * How far off the middle of block (x, y, z) a plant there is drawn: [x, z] in blocks (the array is
 * reused). The same for every chunk that draws it; never so far toward −x or −z that it leaves its
 * chunk (vertex positions are relative to the chunk's corner, and unsigned).
 */
export function plantOffset(seed: number, x: number, y: number, z: number): number[] {
  off[0] = (hash3(seed ^ K_OFF, x, y, z) - 0.5) * 2 * OFF;
  off[1] = (hash3(seed ^ (K_OFF + 1), x, y, z) - 0.5) * 2 * OFF;
  if ((x & (CS - 1)) === 0) off[0] = Math.max(off[0], -CROSS_IN);
  if ((z & (CS - 1)) === 0) off[1] = Math.max(off[1], -CROSS_IN);
  return off;
}

/**
 * The box a tap has to hit on block `id` (state `st`) at (x, y, z), in block units relative to it
 * [x0, y0, z0, x1, y1, z1]; null for a whole block. Plants have small ones, so a tap just past one
 * reaches the block behind it.
 */
export function blockBox(id: number, st: number, seed: number, x: number, y: number, z: number): number[] | null {
  switch (MODEL[id]) {
    case M_TORCH: return torchBox(st);
    case M_INSET: return [INSET, 0, INSET, 1 - INSET, 1, 1 - INSET];
    case M_CROSS: {
      if (SUPPORT[id] === S_HANG) return HANG_BOX;
      const o = OFFSET[id] ? plantOffset(seed, x, y, z) : [0, 0], a = 0.15;
      return [a + o[0], 0, a + o[1], 1 - a + o[0], 0.9, 1 - a + o[1]];
    }
    case M_FLAT: {
      const s = flatWall(st), t = 0.1;
      if (!s) return [0, 0, 0, 1, t, 1];
      const [dx, , dz] = TORCH_SUPPORT[s];
      return [dx > 0 ? 1 - t : 0, 0, dz > 0 ? 1 - t : 0, dx < 0 ? t : 1, 1, dz < 0 ? t : 1];
    }
    default: return null;
  }
}

/** What support needs of the world (World, or a stand-in in tests) */
export interface SupportWorld {
  getBlock(x: number, y: number, z: number): number;
  getState(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, id: number, state?: number): boolean;
  /** Is column (x, z)'s chunk loaded? A wall in a chunk that isn't is taken to hold (it reads as air) */
  isLoaded?(x: number, z: number): boolean;
}

const isCube = (b: number) => SOLID[b] === 1 && MODEL[b] === M_CUBE;
/** Column (x, z) is in a chunk that isn't loaded (inside the world): what's there is unknown */
const unknown = (w: Omit<SupportWorld, 'setBlock'>, x: number, z: number) =>
  !!w.isLoaded && x >= 0 && z >= 0 && x < W && z < D && !w.isLoaded(x, z);

/** Is block `id` with state `st` held up at (x, y, z)? (always, for blocks that need no support) */
export function holds(w: Omit<SupportWorld, 'setBlock'>, id: number, st: number, x: number, y: number, z: number): boolean {
  switch (SUPPORT[id]) {
    case S_FLOOR: {
      const b = w.getBlock(x, y - 1, z);
      return isCube(b) || (STACKS[id] === 1 && b === id);
    }
    case S_WATER: return waterState(w.getBlock(x, y - 1, z), w.getState(x, y - 1, z)) >= 0;
    case S_WALL: {
      const s = flatWall(st);
      if (!s) return false;
      const [dx, dy, dz] = TORCH_SUPPORT[s];
      // vines also hang from more vines (curtains); a stocking or a wreath needs its wall
      return isCube(w.getBlock(x + dx, y + dy, z + dz)) || unknown(w, x + dx, z + dz) ||
        (id === VINES && w.getBlock(x, y + 1, z) === id && flatWall(w.getState(x, y + 1, z)) === s);
    }
    case S_TORCH: {
      const [dx, dy, dz] = TORCH_SUPPORT[st <= 4 ? st : 0];
      return isCube(w.getBlock(x + dx, y + dy, z + dz)) || unknown(w, x + dx, z + dz);
    }
    case S_HANG: return isCube(w.getBlock(x, y + 1, z));
    default: return true;
  }
}

const AROUND = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
/**
 * The block at (x, y, z) has just changed: the blocks next to it that it held up, and nothing holds
 * up any more, pop off — and the blocks those held up, and so on. A waterlogged plant leaves its
 * water behind. `onPop` hears about each (where, and what it was). Returns how many popped.
 */
export function popUnsupported(w: SupportWorld, x: number, y: number, z: number,
  onPop?: (x: number, y: number, z: number, id: number) => void): number {
  const todo = [x, y, z];
  let n = 0;
  while (todo.length) {
    const cz = todo.pop()!, cy = todo.pop()!, cx = todo.pop()!;
    for (const [dx, dy, dz] of AROUND) {
      const X = cx + dx, Y = cy + dy, Z = cz + dz, id = w.getBlock(X, Y, Z);
      if (!SUPPORT[id]) continue;
      const st = w.getState(X, Y, Z);
      if (holds(w, id, st, X, Y, Z)) continue;
      if (!w.setBlock(X, Y, Z, st & WATERLOGGED && LOGGABLE[id] ? WATER : AIR)) continue;
      n++;
      if (onPop) onPop(X, Y, Z, id);
      todo.push(X, Y, Z);
    }
  }
  return n;
}
