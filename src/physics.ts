import { H, GRAV, EPS } from './config';
import { world } from './world';

/* ============================ BODIES ============================ */
// What the player and the entities share: an axis-aligned box that falls and stops flush against
// solid blocks (world.isSolid, so unloaded chunks and the world's edge are walls too).

/** Something that moves and collides: a box `r` out from its feet `p` each way across, `h` high. */
export interface Body {
  /** Feet position (x, y, z): the middle of the box's bottom. Mutated in place. */
  p: number[];
  /** Velocity (blocks a second). Mutated in place. */
  v: number[];
  /** Half-width */
  r: number;
  /** Height */
  h: number;
  /** Standing on something (set by moveBody) */
  onGround: boolean;
}

/** Fastest fall (blocks a second) */
export const TERMINAL = 48;

/** Does a box r out from (px, py, pz) each way across and h high overlap a solid block? */
export function boxCollides(px: number, py: number, pz: number, r: number, h: number): boolean {
  const x0 = Math.floor(px - r + EPS), x1 = Math.floor(px + r - EPS);
  const y0 = Math.floor(py + EPS), y1 = Math.floor(py + h - EPS);
  const z0 = Math.floor(pz - r + EPS), z1 = Math.floor(pz + r - EPS);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (world.isSolid(x, y, z)) return true;
  return false;
}

/** Move b along one axis (0 x, 1 y, 2 z) by d, then snap flush against whatever it hit; true if it hit something. */
export function moveAxis(b: Body, a: number, d: number): boolean {
  if (!d) return false;
  const P = b.p, r = b.r;
  P[a] += d;
  const x0 = Math.floor(P[0] - r + EPS), x1 = Math.floor(P[0] + r - EPS);
  const y0 = Math.floor(P[1] + EPS), y1 = Math.floor(P[1] + b.h - EPS);
  const z0 = Math.floor(P[2] - r + EPS), z1 = Math.floor(P[2] + r - EPS);
  let lim = d > 0 ? Infinity : -Infinity, hit = false;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    if (!world.isSolid(x, y, z)) continue;
    hit = true;
    const c = a === 0 ? x : a === 1 ? y : z;
    lim = d > 0 ? Math.min(lim, c) : Math.max(lim, c);
  }
  if (!hit) return false;
  if (a === 1) P[1] = d > 0 ? lim - b.h : lim + 1;
  else P[a] = d > 0 ? lim - r : lim + 1 + r;
  return true;
}

/** A body inside solid blocks rises out of them, a block at a time (never stay stuck). */
export function unstick(b: Body): void {
  for (let g = 0; g < H && boxCollides(b.p[0], b.p[1], b.p[2], b.r, b.h); g++) { b.p[1] = Math.floor(b.p[1]) + 1; b.v[1] = 0; }
}

/**
 * Move b by its velocity for dt seconds (× `slow`, what it's in slowing it), vertically by `vy` (the
 * average over the frame), in steps of at most 0.3 blocks so it never passes through a block: x, then
 * z, then y each step. What it hits stops it on that axis; landing sets onGround. Returns which
 * horizontal axes hit something (1 x, 2 z).
 */
export function moveBody(b: Body, dt: number, vy: number, slow = 1): number {
  const V = b.v;
  const n = Math.max(1, Math.ceil((Math.max(Math.abs(V[0]), Math.abs(vy), Math.abs(V[2])) * dt) / 0.3));
  const h = (dt / n) * slow;
  let hit = 0;
  b.onGround = false;
  for (let i = 0; i < n; i++) {
    if (moveAxis(b, 0, V[0] * h)) { V[0] = 0; hit |= 1; }
    if (moveAxis(b, 2, V[2] * h)) { V[2] = 0; hit |= 2; }
    if (moveAxis(b, 1, vy * h)) { if (vy < 0) b.onGround = true; V[1] = 0; vy = 0; }
  }
  return hit;
}

/** Gravity and moving for dt seconds: what an entity does each frame (its v[0], v[2] set by what it wants). Returns moveBody's hits. */
export function stepBody(b: Body, dt: number): number {
  unstick(b);
  const vy0 = b.v[1];
  b.v[1] = Math.max(vy0 - GRAV * dt, -TERMINAL);
  return moveBody(b, dt, (vy0 + b.v[1]) / 2);   // the average → the same fall at any frame rate
}
