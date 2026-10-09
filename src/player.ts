import { H, PR, PH, EYE, GRAV, JUMP, WALK, RUN, REACH, EPS } from './config';
import { world, raycast, inWater, waterFlow, type Hit } from './world';
import { SLIPPERY } from './blocks';

/* ============================ PLAYER ============================ */
/** Feet position (x, y, z). Mutated in place — never reassign. */
export const P = [0, 0, 0];
/** Velocity (x, y, z). Mutated in place — never reassign. */
export const V = [0, 0, 0];
/** Seconds of air a player holds under water (for drowning, once there is health) */
export const BREATH = 15;
/**
 * `wet`: how deep in water the player is — 0 dry, 1 feet, 2 waist (swimming), 3 head under.
 * `breath`: seconds of air left; it runs down with the head under water and comes back above it.
 * Nothing uses it yet: drowning comes with health.
 */
export const player = { yaw: 0, pitch: -0.25, onGround: false, jumpBuf: 0, wet: 0, breath: BREATH };

/* ---------- swimming ---------- */
/** Heights above the feet that count for being in water */
const FEET = 0.1, WAIST = 0.9;
/** Speed in water (× walking or running): swimming, and wading with just the feet in */
const SWIM_SPEED = 0.55, WADE_SPEED = 0.8;
/** Vertical speed swimming up (JUMP held), and sinking without */
const SWIM_UP = 3, SINK = -1;
/** Speed a swimmer pushing into a ledge with JUMP held is lifted at (enough to clear a block above the water) */
const CLIMB = 9.5;
/** Fastest fall with the feet in water: it brakes you, and hard once you're in */
const WADE_FALL = -4;
/** How fast flowing water carries you along */
const CURRENT = 1.2;
/** How quickly the player's speed follows the controls (1/s): on the ground, on slippery ground (ice), in the air, swimming */
const GRIP = 14, ICE_GRIP = 1.6, AIR_GRIP = 5, SWIM_GRIP = 4;
/** Told when the player hits the water fast: where (on the surface) and how fast (blocks a second) */
export const playerEvents = { splash: (_x: number, _y: number, _z: number, _speed: number) => {} };

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

/** How deep in water the player is: 0 dry, 1 feet, 2 waist, 3 head under */
function wetness(): number {
  if (inWater(P[0], P[1] + EYE, P[2])) return 3;
  if (inWater(P[0], P[1] + WAIST, P[2])) return 2;
  return inWater(P[0], P[1] + FEET, P[2]) ? 1 : 0;
}

/**
 * Advance player physics by dt seconds. On land: walking, jumping, gravity, auto-jump up 1-block
 * steps. In water up to the waist or deeper: swimming — slower, JUMP swims up and without it you
 * slowly sink, falls are braked, no auto-jump; pushing into a ledge with JUMP held lifts you out.
 * Flowing water carries you along.
 */
export function update(dt: number, ctl: Controls): void {
  for (let g = 0; g < H && collides(P[0], P[1], P[2]); g++) { P[1] = Math.floor(P[1]) + 1; V[1] = 0; } // never stay stuck

  const wasWet = player.wet;
  player.wet = wetness();
  const swim = player.wet >= 2;
  player.breath = player.wet === 3 ? Math.max(0, player.breath - dt) : Math.min(BREATH, player.breath + dt * 4);

  const ix = ctl.x, iz = ctl.z;
  const sp = (ctl.run ? RUN : WALK) * (swim ? SWIM_SPEED : player.wet ? WADE_SPEED : 1);
  const s = Math.sin(player.yaw), c = Math.cos(player.yaw), f = -iz;
  let tx = (-s * f + c * ix) * sp, tz = (-c * f - s * ix) * sp;
  if (player.wet) {
    // the current carries you along
    const fl = waterFlow(Math.floor(P[0]), Math.floor(P[1] + (swim ? WAIST : FEET)), Math.floor(P[2]));
    tx += fl[0] * CURRENT; tz += fl[1] * CURRENT;
  }
  // on ice the feet barely grip: slow to get going, slow to stop
  const ground = player.onGround ? (SLIPPERY[world.getBlock(Math.floor(P[0]), Math.floor(P[1] - 0.05), Math.floor(P[2]))] ? ICE_GRIP : GRIP) : AIR_GRIP;
  const k = 1 - Math.exp(-(swim ? SWIM_GRIP : ground) * dt);
  V[0] += (tx - V[0]) * k;
  V[2] += (tz - V[2]) * k;

  player.jumpBuf -= dt;
  const vy0 = V[1];
  if (swim) {
    // JUMP swims up, without it you slowly sink; the water brakes a fall hard
    const want = ctl.jump ? SWIM_UP : SINK;
    V[1] += (want - V[1]) * (1 - Math.exp(-(V[1] < want - 2 ? 14 : 5) * dt));
    player.jumpBuf = 0;
  } else {
    if ((ctl.jump || player.jumpBuf > 0) && player.onGround) { V[1] = JUMP; player.onGround = false; player.jumpBuf = 0; }
    V[1] = Math.max(V[1] - GRAV * dt, -48);
    if (player.wet && V[1] < WADE_FALL) V[1] += (WADE_FALL - V[1]) * (1 - Math.exp(-14 * dt));
  }
  let vy = (vy0 + V[1]) / 2; // average velocity over the frame → same jump height at any frame rate
  if (!wasWet && player.wet && vy0 < -6) playerEvents.splash(P[0], P[1] + FEET, P[2], -vy0);

  const n = Math.max(1, Math.ceil((Math.max(Math.abs(V[0]), Math.abs(vy), Math.abs(V[2])) * dt) / 0.3));
  const h = dt / n;
  let bx = false, bz = false;
  player.onGround = false;
  for (let i = 0; i < n; i++) {
    if (moveAxis(0, V[0] * h)) { V[0] = 0; bx = true; }
    if (moveAxis(2, V[2] * h)) { V[2] = 0; bz = true; }
    if (moveAxis(1, vy * h)) { if (vy < 0) player.onGround = true; V[1] = 0; vy = 0; }
  }
  const pushing = (bx && Math.abs(tx) > sp * 0.3) || (bz && Math.abs(tz) > sp * 0.3);
  if (player.wet && pushing && ctl.jump) {
    // climbing out: pushing into a ledge with JUMP held lifts you until your feet are out of the water
    V[1] = Math.max(V[1], CLIMB);
  } else if (!swim && player.onGround && pushing) {
    // auto-jump (not while swimming): walking into a 1-block step hops onto it
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
