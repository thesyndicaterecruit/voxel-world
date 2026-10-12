import { mulberry, hash2 } from './noise';
import { boxModel, partIndex, newSkin, paintFace, put, turn, shift, scale, F_FRONT, F_PX, F_NX, F_BACK, F_TOP, F_BOTTOM,
  type PartDef, type RGB, type Skin } from './boxmodel';
import type { Creature, EntityFx, EntityKind } from './entities';

/* ============================ BENTLEY ============================ */
// Gabby's pug: a blocky fawn pug with a black mask and muzzle, black floppy ears, big dark eyes, short
// chunky legs and a tight curly tail on top. His model (texels: 32 a block, the front toward −z),
// his skin (painted here with its own PRNG, not one of the tiles), his poses and what he does.

/** What Bentley can be doing (his animation states), in the order the Pose button cycles them */
export const BENTLEY_STATES = ['idle', 'walk', 'sit', 'sleep', 'wag'] as const;
export type BentleyState = (typeof BENTLEY_STATES)[number];

// his parts: [name, parent, pivot, box from, box size, uv]. 0.9 of a block long, 0.6 high at the
// shoulder, 0.8 to the top of his head: bigger than a real pug, so he reads on a phone
const PARTS: PartDef[] = [
  ['body', '', [0, 13, 0], [-6.5, -6, -9], [13, 12, 18], [0, 0]],
  ['head', 'body', [0, 6, -8], [-7, -7, -9], [14, 13, 10], [72, 0]],
  ['muzzle', 'head', [0, -2, -9], [-4, -5, -3], [8, 5, 3], [20, 34]],
  ['tongue', 'muzzle', [0, -5, -2.5], [-1.5, -3, -0.5], [3, 3, 1], [64, 34]],
  ['eyeL', 'head', [-4, 0, -9], [-2, -2, -1], [4, 4, 1], [54, 34]],
  ['eyeR', 'head', [4, 0, -9], [-2, -2, -1], [4, 4, 1], [54, 34]],
  ['earL', 'head', [-6, 6, -6], [-3, -4, -1.5], [3, 4, 3], [42, 34]],
  ['earR', 'head', [6, 6, -6], [0, -4, -1.5], [3, 4, 3], [42, 34]],
  ['legFL', 'body', [-4, -6, -5.5], [-2.5, -7, -2.5], [5, 7, 5], [0, 34]],
  ['legFR', 'body', [4, -6, -5.5], [-2.5, -7, -2.5], [5, 7, 5], [0, 34]],
  ['legBL', 'body', [-4, -6, 6], [-2.5, -7, -2.5], [5, 7, 5], [0, 34]],
  ['legBR', 'body', [4, -6, 6], [-2.5, -7, -2.5], [5, 7, 5], [0, 34]],
  ['tail', 'body', [0, 6, 7], [-2, -1, -1], [4, 5, 4], [72, 23]],
  ['tailTip', 'tail', [0, 4, 1], [-1.5, -2, -5], [3, 3, 5], [88, 23]],
];
export const BENTLEY_MODEL = boxModel(PARTS, 128, 64);
const part = (n: string) => partIndex(BENTLEY_MODEL, n);
const BODY = part('body'), HEAD = part('head'), TONGUE = part('tongue'), EYE_L = part('eyeL'), EYE_R = part('eyeR');
const EAR_L = part('earL'), EAR_R = part('earR'), LEG_FL = part('legFL'), LEG_FR = part('legFR'), LEG_BL = part('legBL'), LEG_BR = part('legBR');
const TAIL = part('tail'), TAIL_TIP = part('tailTip');

/* ---------- his skin ---------- */
const hx = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
/** His fawn, and the black of his mask, muzzle and ears */
export const FAWN = hx(0xc8a15a), MASK = hx(0x1d1815);
// the darker fawn of his back and the stripe down it, his belly, nose, wrinkles, eyes, tongue, ...
const BACK = hx(0xa8813f), BELLY = hx(0xdcc08a), NOSE = hx(0x0c0a09), WRINKLE = hx(0x6a4a24), EYE = hx(0x24150c), TONGUE_PINK = hx(0xe8788c);
const TRACE = hx(0x8e6b33), ROLL = hx(0x3a312b), PAD = hx(0x3b2f27), IRIS_RIM = hx(0x4a2f1c), GLINT = hx(0xffffff), LID = hx(0x5c4b3e);
/** The skin's own seed (the tiles' painters have theirs: textures.ts) */
const SKIN_SEED = 0x9b6;

/** Paint Bentley's skin (BENTLEY_MODEL's unwrap), the same every time. */
export function paintBentley(): Skin {
  const s = newSkin(BENTLEY_MODEL.skinW, BENTLEY_MODEL.skinH), rnd = mulberry(SKIN_SEED), m = BENTLEY_MODEL.parts;
  /** c with its fur's grain: a little brighter or darker texel to texel */
  const fur = (c: RGB, a = 0.07): RGB => { const k = 1 + (rnd() - 0.5) * 2 * a; return [c[0] * k, c[1] * k, c[2] * k]; };
  const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // fawn everywhere first, so nothing between the faces shows dark when the skin is filtered
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) put(s, x, y, FAWN);
  /** Paint every face of part p: f(face, x, y, w, h) gives each texel's colour (see paintFace) */
  const all = (p: number, f: (face: number, x: number, y: number, w: number, h: number) => RGB | null) =>
    [F_FRONT, F_PX, F_NX, F_BACK, F_TOP, F_BOTTOM].forEach((face) => paintFace(s, m[p], face, (x, y, w, h) => f(face, x, y, w, h)));

  // body: a darker back with a darker stripe down the spine, fawn sides fading to a pale belly
  all(BODY, (f, x, y, w, h) => {
    if (f === F_TOP) return fur(Math.abs(x - (w - 1) / 2) < 2 ? TRACE : mix(BACK, FAWN, Math.abs(x - (w - 1) / 2) / w));
    if (f === F_BOTTOM) return fur(BELLY, 0.04);
    if (f === F_FRONT) return fur(mix(FAWN, BELLY, y / h));
    if (f === F_BACK) return fur(y < 2 ? BACK : FAWN);
    return fur(y < 3 ? mix(BACK, FAWN, y / 3) : y >= h - 2 ? BELLY : FAWN);
  });
  // head: fawn, the black mask over the lower face and round the eyes, wrinkles and the thumbprint on the forehead
  all(HEAD, (f, x, y, w, h) => {
    if (f === F_FRONT) {
      const mid = Math.abs(x - (w - 1) / 2);
      const eye = x >= 1 && x <= 4 ? x - 1 : x >= 9 && x <= 12 ? x - 9 : -1;                   // under an eye box: 0–3 across it
      if (eye >= 0 && (y === 6 || (y === 5 && (eye === 0 || eye === 3)))) return LID;             // shut eyes, seen while he sleeps
      if (y >= 4) return fur(y >= 5 && y <= 7 && mid < 1 ? ROLL : MASK, 0.05);                  // the mask, a crease between the eyes
      if (y === 3) return fur(mid < 3 || hash2(SKIN_SEED, x, y) < 0.55 ? MASK : WRINKLE, 0.05);  // its ragged top edge
      if (y === 1 && mid < 3.5) return fur(WRINKLE, 0.05);                                       // a wrinkle across the forehead
      if (y === 2 && (mid < 1 || (mid > 3 && mid < 5.5))) return fur(WRINKLE, 0.05);              // the thumbprint, the wrinkle's ends
      return fur(FAWN);
    }
    if (f === F_TOP) {
      // the front rows (the image's bottom) carry the wrinkles on up from the forehead
      const mid = Math.abs(x - (w - 1) / 2), front = h - 1 - y;
      if ((front === 1 && mid < 4) || (front === 3 && mid < 2.5) || (front === 0 && mid < 1)) return fur(WRINKLE, 0.05);
      return fur(mix(FAWN, BACK, y / h * 0.8));
    }
    if (f === F_PX || f === F_NX) {
      // the mask wraps round the face's edge
      const front = f === F_PX ? w - 1 - x : x;
      if (front === 0 && y >= 4) return fur(MASK, 0.05);
      if (front === 1 && y >= 6) return fur(hash2(SKIN_SEED + 1, x, y) < 0.6 ? MASK : FAWN, 0.05);
      return fur(y < 3 ? mix(BACK, FAWN, y / 3) : FAWN);
    }
    if (f === F_BOTTOM) return fur(y < 3 ? MASK : BELLY, 0.05);
    return fur(y < 4 ? mix(BACK, FAWN, y / 4) : FAWN);
  });
  // muzzle: black, the nose at the top of its front, the roll of a wrinkle over it, the mouth below
  all(part('muzzle'), (f, x, y, w, h) => {
    if (f === F_FRONT) {
      const mid = Math.abs(x - (w - 1) / 2);
      if (y <= 1 && mid < 2) return y === 0 && mid < 1 ? hx(0x3a3434) : y === 1 && mid > 1 ? hx(0x050404) : NOSE;   // shine, nostrils
      if (y === h - 2 && mid < 2.5) return hx(0x0f0c0b);                                        // the mouth
      return fur(MASK, 0.05);
    }
    if (f === F_TOP) return fur(y === 0 ? hx(0x4a3f38) : ROLL, 0.05);
    return fur(MASK, 0.05);
  });
  all(TONGUE, (f, x, _y, w) => fur(f === F_FRONT && Math.abs(x - (w - 1) / 2) < 0.5 ? hx(0xc95a6e) : TONGUE_PINK, 0.04));
  // eyes: big and dark, round (corners in the mask's black), a glint top left
  all(EYE_L, (f, x, y, w, h) => {
    if (f !== F_FRONT) return fur(MASK, 0.05);
    const cx = Math.abs(x - (w - 1) / 2), cy = Math.abs(y - (h - 1) / 2);
    if (cx > 1 && cy > 1) return MASK;
    if (x === 1 && y === 1) return GLINT;
    return y === h - 1 || x === w - 1 ? IRIS_RIM : EYE;
  });
  // ears: black flaps, a little browner inside
  all(EAR_L, (f) => fur(f === F_PX || f === F_NX ? hx(0x221c18) : MASK, 0.06));
  // legs: fawn, toes marked at the bottom, dark pads underneath
  all(LEG_FL, (f, x, y, _w, h) => {
    if (f === F_BOTTOM) return fur(PAD, 0.05);
    if (f === F_TOP) return fur(FAWN);
    if (y === h - 1 && (x === 1 || x === 3)) return fur(TRACE, 0.05);
    return fur(y >= h - 2 ? mix(FAWN, BELLY, 0.4) : FAWN);
  });
  // the curly tail: a hook of darker fawn rising off his rump and curling forward over it, the curl's
  // inside darker
  all(TAIL, (f, _x, y) => fur(f === F_FRONT || (f !== F_BACK && y === 0) ? TRACE : BACK, 0.05));
  all(TAIL_TIP, (f, x, y, w) => fur(f === F_BOTTOM || f === F_FRONT || (f === F_TOP && x === (w >> 1) && y > 0) ? TRACE : mix(BACK, FAWN, 0.3), 0.05));
  return s;
}

/* ---------- his poses ---------- */
/** How long a snort-shake takes (s), and how often one comes when he stands about (every SNORT_EVERY s, give or take a second) */
const SNORT = 0.8, SNORT_EVERY = 6;
/** Walking: speed (blocks a second), how fast he turns (radians a second: round a small circle), his steps (radians a second) */
export const WALK_SPEED = 1.1, WALK_TURN = 0.7, STEP = 10;
/** How hard he hops up a step he walks into (blocks a second: up 1.1 blocks) */
const HOP = 8.5;
/** Asleep, a "Z" rises every ZZZ_EVERY seconds */
export const ZZZ_EVERY = 1.5;
/** The sitting lean (radians: the front up) */
const SIT = 0.62;
/** The tail leans back off his rump, and its tip curls forward and down over it */
const TAIL_LEAN = 0.15, TAIL_CURL = -0.5;
/** Asleep on his side: how far he's lowered (texels), how his head lies (radians about its long axis) */
const SLEEP_Y = -4.5, SLEEP_HEAD = -0.12;

/** How far into a snort-shake he is at age a (seconds alive): 0–1, or −1 when he isn't shaking */
export function snortAt(a: number): number {
  const n = Math.floor(a / SNORT_EVERY), at = n * SNORT_EVERY + 2 + hash2(SKIN_SEED, n, 7) * 2;
  return a >= at && a < at + SNORT ? (a - at) / SNORT : -1;
}

/**
 * Bentley's pose in `state` at `age` seconds alive (the clock his breathing, steps and snorts run
 * on), into `out` (a rest pose: see boxmodel.ts). A new state eases in (entities.ts).
 */
export function bentleyPose(state: BentleyState, age: number, out: Float32Array): void {
  const breath = Math.sin(age * 2.4);
  const pant = state === 'walk' || state === 'wag';
  scale(out, BODY, 1 + 0.02 * breath, 1 + 0.015 * breath, 1);
  if (!pant) scale(out, TONGUE, 0);
  else turn(out, TONGUE, 0.15 + 0.15 * Math.sin(age * 12));
  // ears hang a little out and forward
  turn(out, EAR_L, 0.3, 0, -0.35);
  turn(out, EAR_R, 0.3, 0, 0.35);
  turn(out, TAIL, TAIL_LEAN);
  turn(out, TAIL_TIP, TAIL_CURL);

  if (state === 'idle') {
    // looks about, and every few seconds shakes his head with a snort, ears flapping
    const lx = 0.05 * Math.sin(age * 0.9), ly = 0.15 * Math.sin(age * 0.4);
    turn(out, HEAD, lx, ly);
    turn(out, TAIL, TAIL_LEAN, 0.15 * Math.sin(age * 3));
    const s = snortAt(age);
    if (s >= 0) {
      const k = Math.sin(s * Math.PI), w = Math.sin(s * Math.PI * 7);
      turn(out, HEAD, lx - 0.1 * k, ly + 0.45 * k * w, 0.2 * k * w);
      turn(out, EAR_L, 0.3, 0, -0.35 - 0.6 * k * Math.max(0, w));
      turn(out, EAR_R, 0.3, 0, 0.35 + 0.6 * k * Math.max(0, -w));
      turn(out, BODY, 0, 0, 0.04 * k * w);
    }
  } else if (state === 'walk') {
    // a waddle: diagonal legs together, his body rolling side to side and bobbing, his head nodding
    const a = Math.sin(age * STEP), b = Math.sin(age * STEP * 2);
    turn(out, LEG_FL, 0.55 * a); turn(out, LEG_BR, 0.55 * a);
    turn(out, LEG_FR, -0.55 * a); turn(out, LEG_BL, -0.55 * a);
    turn(out, BODY, 0, 0.05 * a, 0.09 * a);
    shift(out, BODY, 0, 0.6 * Math.abs(a));
    turn(out, HEAD, 0.06 * b, 0, -0.07 * a);
    turn(out, TAIL, TAIL_LEAN, 0.35 * b);
    turn(out, EAR_L, 0.3 + 0.1 * b, 0, -0.35 - 0.12 * b);
    turn(out, EAR_R, 0.3 + 0.1 * b, 0, 0.35 + 0.12 * b);
  } else if (state === 'sit') {
    // the front up, his rear on the ground, front legs straight, back legs folded forward beside him, head up
    turn(out, BODY, SIT);
    shift(out, BODY, 0, -2.9);
    for (const l of [LEG_FL, LEG_FR]) { turn(out, l, -SIT); scale(out, l, 1, 1.2, 1); }
    turn(out, LEG_BL, Math.PI / 2 - SIT - 0.05, 0.3);
    turn(out, LEG_BR, Math.PI / 2 - SIT - 0.05, -0.3);
    shift(out, LEG_BL, -0.5, 1); shift(out, LEG_BR, 0.5, 1);
    shift(out, HEAD, 0, 1.5, 0.5);
    turn(out, HEAD, -SIT + 0.05 * Math.sin(age * 0.7), 0, 0.18 * Math.sin(age * 0.5) * Math.max(0, Math.sin(age * 0.23)));
    turn(out, TAIL, TAIL_LEAN - SIT);
  } else if (state === 'sleep') {
    // flopped over on his side, legs out, breathing slow and deep, eyes shut (the mask shows)
    const slow = Math.sin(age * 1.6);
    turn(out, BODY, 0, 0, Math.PI / 2);
    shift(out, BODY, 0, SLEEP_Y);
    scale(out, BODY, 1 + 0.035 * slow, 1 + 0.01 * slow, 1);
    turn(out, LEG_FL, -0.35, 0, -0.2); turn(out, LEG_FR, -0.5, 0, 0.35);
    turn(out, LEG_BL, 0.35, 0, -0.2); turn(out, LEG_BR, 0.55, 0, 0.35);
    turn(out, HEAD, 0.1, 0.1, SLEEP_HEAD);
    scale(out, EYE_L, 0); scale(out, EYE_R, 0);
    turn(out, EAR_L, 0.6, 0, -0.3); turn(out, EAR_R, 0.6, 0, 0.6);
    turn(out, TAIL, TAIL_LEAN + 0.15);
  } else {
    // wagging: tail going, his rear wiggling with it, head up, panting
    const w = Math.sin(age * 22);
    turn(out, TAIL, TAIL_LEAN, 0.6 * w, 0.8 * w);
    turn(out, BODY, 0, -0.06 * w, 0.03 * w);       // his rear swings the same way as the tail
    scale(out, BODY, 1 + 0.03 * Math.sin(age * 12), 1 + 0.02 * Math.sin(age * 12), 1);
    turn(out, HEAD, -0.12 + 0.04 * Math.sin(age * 12), -0.06 * w);
    turn(out, EAR_L, 0.15, 0, -0.25); turn(out, EAR_R, 0.15, 0, 0.25);
  }
}

/* ---------- what he does ---------- */
/** Where a sleeping Bentley's head is (blocks from his feet, his front toward −z: he lies with it off to his left) */
const ASLEEP_HEAD = [-0.2, 0.6, -0.4];
/** Where the Zs rise from: over his head, turned with him */
export function zzzFrom(c: Creature): number[] {
  const [x, y, z] = ASLEEP_HEAD, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), p = c.body.p;
  return [p[0] + x * cy + z * sy, p[1] + y, p[2] - x * sy + z * cy];
}

/** Bentley as an entity (entities.ts): his model, skin, size, poses and behaviour. */
export const BENTLEY: EntityKind = {
  name: 'bentley',
  model: BENTLEY_MODEL,
  paint: paintBentley,
  r: 0.3,
  h: 0.85,
  states: BENTLEY_STATES,
  think(c: Creature, dt: number, fx: EntityFx) {
    const v = c.body.v, k = 1 - Math.exp(-10 * dt);
    let tx = 0, tz = 0;
    if (c.state === 'walk') {
      // round a small circle (for now: Milestone 4 has him follow), hopping up a step he walks into
      c.yaw += WALK_TURN * dt;
      tx = -Math.sin(c.yaw) * WALK_SPEED; tz = -Math.cos(c.yaw) * WALK_SPEED;
      if (c.bumped && c.body.onGround) v[1] = HOP;
    }
    v[0] += (tx - v[0]) * k;
    v[2] += (tz - v[2]) * k;
    // asleep: a Z rises from his head now and then, the first soon after he drops off
    if (c.state === 'sleep' && Math.floor((c.t - 0.6) / ZZZ_EVERY) !== Math.floor((c.t - 0.6 - dt) / ZZZ_EVERY)) {
      const [x, y, z] = zzzFrom(c);
      fx.zzz(x, y, z);
    }
  },
  pose(c: Creature, out: Float32Array) { bentleyPose(c.state as BentleyState, c.age, out); },
};
