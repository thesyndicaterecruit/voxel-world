import { PR, PH, EYE, GRAV, JUMP, WALK, RUN, REACH, EPS } from './config';
import { world, raycast, inWater, waterFlow, type Hit } from './world';
import { B, SLIPPERY } from './blocks';
import { boxCollides, moveBody, unstick, TERMINAL } from './physics';

/* ============================ PLAYER ============================ */
/** Feet position (x, y, z). Mutated in place — never reassign. */
export const P = [0, 0, 0];
/** Velocity (x, y, z). Mutated in place — never reassign. */
export const V = [0, 0, 0];
/** Seconds of air a player holds under water (for drowning, once there is health) */
export const BREATH = 15;
/**
 * The player is a body (physics.ts: `p` is P, `v` is V, half-width PR, height PH, `onGround`).
 * `wet`: how deep in water the player is — 0 dry, 1 feet, 2 waist (swimming), 3 head under.
 * `breath`: seconds of air left; it runs down with the head under water and comes back above it.
 * Nothing uses it yet: drowning comes with health.
 */
export const player = { p: P, v: V, r: PR, h: PH, yaw: 0, pitch: -0.25, onGround: false, jumpBuf: 0, wet: 0, breath: BREATH };

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
/** How often (s) touching something that hurts tells playerEvents.touch again */
const TOUCH_EVERY = 0.5;
/**
 * `splash`: the player hits the water fast: where (on the surface) and how fast (blocks a second).
 * `touch`: the player is touching block `id`, which would hurt (a cactus): the hook for damage, once
 * there is health; told every TOUCH_EVERY seconds while it lasts.
 */
export const playerEvents = { splash: (_x: number, _y: number, _z: number, _speed: number) => {}, touch: (_id: number) => {} };
let touchT = 0;

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

export const collides = (px: number, py: number, pz: number) => boxCollides(px, py, pz, PR, PH);
export const overlapsPlayer = (x: number, y: number, z: number) =>
  x < P[0] + PR - EPS && x + 1 > P[0] - PR + EPS &&
  y < P[1] + PH - EPS && y + 1 > P[1] + EPS &&
  z < P[2] + PR - EPS && z + 1 > P[2] - PR + EPS;

/**
 * The blocks round the player: returns how much what they're in slows them (× speed, the slowest
 * block's), and tells playerEvents.touch about a block they touch that would hurt.
 */
function surroundings(dt: number): number {
  const m = 0.05, x0 = Math.floor(P[0] - PR - m), x1 = Math.floor(P[0] + PR + m), z0 = Math.floor(P[2] - PR - m), z1 = Math.floor(P[2] + PR + m);
  const y0 = Math.floor(P[1] - m), y1 = Math.floor(P[1] + PH + m);
  let slow = 1, hurt = 0;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const b = B[world.getBlock(x, y, z)];
    if (b.hurts) hurt = b.id;
    // slowed only by what the player is inside, not what they brush past
    if (b.slow < slow && x + 1 > P[0] - PR && x < P[0] + PR && z + 1 > P[2] - PR && z < P[2] + PR && y + 1 > P[1] && y < P[1] + PH) slow = b.slow;
  }
  touchT -= dt;
  if (hurt && touchT <= 0) { touchT = TOUCH_EVERY; playerEvents.touch(hurt); }
  return slow;
}

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
  unstick(player);

  const wasWet = player.wet;
  player.wet = wetness();
  const swim = player.wet >= 2;
  player.breath = player.wet === 3 ? Math.max(0, player.breath - dt) : Math.min(BREATH, player.breath + dt * 4);

  // what the player is in (thick plants slow them down) and touching (something that hurts: the hook)
  const slow = surroundings(dt);
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
    V[1] = Math.max(V[1] - GRAV * dt, -TERMINAL);
    if (player.wet && V[1] < WADE_FALL) V[1] += (WADE_FALL - V[1]) * (1 - Math.exp(-14 * dt));
  }
  const vy = (vy0 + V[1]) / 2; // average velocity over the frame → same jump height at any frame rate
  if (!wasWet && player.wet && vy0 < -6) playerEvents.splash(P[0], P[1] + FEET, P[2], -vy0);

  const hit = moveBody(player, dt, vy, slow), bx = (hit & 1) > 0, bz = (hit & 2) > 0;
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

/** The block under the crosshair, within reach; `water`: water counts too (to put a lily pad on it). */
export function aim(water = false): Hit | null {
  const cp = Math.cos(player.pitch);
  return raycast(P[0], P[1] + EYE, P[2], -Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp, REACH, water);
}
