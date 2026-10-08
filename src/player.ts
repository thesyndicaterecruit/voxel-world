import { H, PR, PH, EYE, GRAV, JUMP, WALK, RUN, REACH, EPS } from './config';
import { world, raycast, type Hit } from './world';

/* ============================ PLAYER ============================ */
/** Feet position (x, y, z). Mutated in place — never reassign. */
export const P = [0, 0, 0];
/** Velocity (x, y, z). Mutated in place — never reassign. */
export const V = [0, 0, 0];
export const player = { yaw: 0, pitch: -0.25, onGround: false, jumpBuf: 0 };

/** What the controls want this frame (see input.ts readControls). */
export interface Controls {
  /** Strafe, -1..1 (right positive) */
  x: number;
  /** Forward/back, -1..1 (back positive, like screen Y) */
  z: number;
  run: boolean;
  /** Jump is being held */
  jump: boolean;
}

/** Stand the player on top of column (x, z), centred in the block. Its chunk must be loaded. */
export function spawn(x: number, z: number): void {
  P[0] = x + 0.5; P[1] = world.topY(x, z) + 1; P[2] = z + 0.5;
}

/** Buffer a jump so a tap slightly before landing still jumps. */
export function bufferJump(): void { player.jumpBuf = 0.18; }

export function collides(px: number, py: number, pz: number): boolean {
  const x0 = Math.floor(px - PR + EPS), x1 = Math.floor(px + PR - EPS);
  const y0 = Math.floor(py + EPS), y1 = Math.floor(py + PH - EPS);
  const z0 = Math.floor(pz - PR + EPS), z1 = Math.floor(pz + PR - EPS);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (world.isSolid(x, y, z)) return true;
  return false;
}
// move along one axis, then snap flush against whatever we hit
function moveAxis(a: number, d: number): boolean {
  if (!d) return false;
  P[a] += d;
  const x0 = Math.floor(P[0] - PR + EPS), x1 = Math.floor(P[0] + PR - EPS);
  const y0 = Math.floor(P[1] + EPS), y1 = Math.floor(P[1] + PH - EPS);
  const z0 = Math.floor(P[2] - PR + EPS), z1 = Math.floor(P[2] + PR - EPS);
  let lim = d > 0 ? Infinity : -Infinity, hit = false;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    if (!world.isSolid(x, y, z)) continue;
    hit = true;
    const c = a === 0 ? x : a === 1 ? y : z;
    lim = d > 0 ? Math.min(lim, c) : Math.max(lim, c);
  }
  if (!hit) return false;
  if (a === 1) P[1] = d > 0 ? lim - PH : lim + 1;
  else P[a] = d > 0 ? lim - PR : lim + 1 + PR;
  return true;
}
export const overlapsPlayer = (x: number, y: number, z: number) =>
  x < P[0] + PR - EPS && x + 1 > P[0] - PR + EPS &&
  y < P[1] + PH - EPS && y + 1 > P[1] + EPS &&
  z < P[2] + PR - EPS && z + 1 > P[2] - PR + EPS;

/** Advance player physics by dt seconds. */
export function update(dt: number, ctl: Controls): void {
  for (let g = 0; g < H && collides(P[0], P[1], P[2]); g++) { P[1] = Math.floor(P[1]) + 1; V[1] = 0; } // never stay stuck

  const ix = ctl.x, iz = ctl.z;
  const sp = ctl.run ? RUN : WALK;
  const s = Math.sin(player.yaw), c = Math.cos(player.yaw), f = -iz;
  const tx = (-s * f + c * ix) * sp, tz = (-c * f - s * ix) * sp;
  const k = 1 - Math.exp(-(player.onGround ? 14 : 5) * dt);
  V[0] += (tx - V[0]) * k;
  V[2] += (tz - V[2]) * k;

  player.jumpBuf -= dt;
  if ((ctl.jump || player.jumpBuf > 0) && player.onGround) { V[1] = JUMP; player.onGround = false; player.jumpBuf = 0; }
  const vy0 = V[1];
  V[1] = Math.max(V[1] - GRAV * dt, -48);
  let vy = (vy0 + V[1]) / 2; // average velocity over the frame → same jump height at any frame rate

  const n = Math.max(1, Math.ceil((Math.max(Math.abs(V[0]), Math.abs(vy), Math.abs(V[2])) * dt) / 0.3));
  const h = dt / n;
  let bx = false, bz = false;
  player.onGround = false;
  for (let i = 0; i < n; i++) {
    if (moveAxis(0, V[0] * h)) { V[0] = 0; bx = true; }
    if (moveAxis(2, V[2] * h)) { V[2] = 0; bz = true; }
    if (moveAxis(1, vy * h)) { if (vy < 0) player.onGround = true; V[1] = 0; vy = 0; }
  }
  // auto-jump: walking into a 1-block step hops onto it
  if (player.onGround && (bx || bz)) {
    const ux = bx && Math.abs(tx) > sp * 0.3 ? Math.sign(tx) * 0.45 : 0;
    const uz = bz && Math.abs(tz) > sp * 0.3 ? Math.sign(tz) * 0.45 : 0;
    if ((ux || uz) && !collides(P[0], P[1] + 1.1, P[2]) && !collides(P[0] + ux, P[1] + 1.1, P[2] + uz)) V[1] = JUMP;
  }
}

/** The block under the crosshair, within reach. */
export function aim(): Hit | null {
  const cp = Math.cos(player.pitch);
  return raycast(P[0], P[1] + EYE, P[2], -Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp, REACH);
}
