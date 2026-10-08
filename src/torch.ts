/* ============================ TORCH ============================ */
// Torch block state: 0 = standing on the block below; 1–4 = on a wall, leaning out of it, with the
// supporting block at −x, +x, −z, +z. Pure helpers (shared by the mesher in workers, the raycast and
// the break/place logic).

export const TORCH_FLOOR = 0;

/** Offset from a torch to the block holding it up, per state. */
export const TORCH_SUPPORT: [number, number, number][] = [[0, -1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]];

/**
 * State for a torch placed against the block face with normal (nx, ny, nz) — the torch goes in the
 * cell that normal points into. -1 when torches can't go there (the underside of a block).
 */
export function torchStateFor(nx: number, ny: number, nz: number): number {
  if (ny === 1) return TORCH_FLOOR;
  if (nx) return nx > 0 ? 1 : 2;
  if (nz) return nz > 0 ? 3 : 4;
  return -1;
}

// Rotation about the vertical axis that turns a torch leaning toward +x (state 1) into each wall state
const TURN = [0, 0, Math.PI, -Math.PI / 2, Math.PI / 2];
const rotY = (x: number, z: number, a: number): [number, number] => {
  const c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));   // quarter turns only: exact
  return [x * c + z * s, -x * s + z * c];
};

/** Hit box, in block units [x0, y0, z0, x1, y1, z1], a little larger than the stick so it's easy to tap. */
export function torchBox(state: number): number[] {
  if (state === TORCH_FLOOR || state > 4) return [0.36, 0, 0.36, 0.64, 0.78, 0.64];
  // the wall torch leaning toward +x, turned to face the right way
  const [ax, az] = rotY(0 - 0.5, 0.32 - 0.5, TURN[state]), [bx, bz] = rotY(0.58 - 0.5, 0.68 - 0.5, TURN[state]);
  return [Math.min(ax, bx) + 0.5, 0.12, Math.min(az, bz) + 0.5, Math.max(ax, bx) + 0.5, 1, Math.max(az, bz) + 0.5];
}

/* ---------- model ---------- */
// Built in texels (1/32 block, matching the 32×32 torch tile, so uv = position), then tilted and
// turned per state. Each quad: 4 corners [x, y, z] (CCW seen from its front), their uvs, and
// whether it glows (drawn full-bright, no face shading).
export interface TorchQuad { p: number[][]; uv: number[][]; shade: number; glow: boolean }

const STICK0 = 14, STICK1 = 18, STICK_TOP = 20;            // the stick: 4×20 texels
const FLAME0 = 11, FLAME1 = 21, FLAME_BOT = 18, FLAME_TOP = 30;
const TILT = (22.5 * Math.PI) / 180;
/** A wall torch's foot (centre of the stick's end): texels out from the wall, and up from the floor */
const FOOT_X = 2, FOOT_Y = 5;

function floorModel(): TorchQuad[] {
  const q: TorchQuad[] = [], a = STICK0, b = STICK1, t = STICK_TOP;
  // stick sides (uv = the side view in the tile) and its glowing tip on top
  q.push({ p: [[a, 0, a], [a, t, a], [b, t, a], [b, 0, a]], uv: [[a, 0], [a, t], [b, t], [b, 0]], shade: 0.76, glow: false });  // −z
  q.push({ p: [[b, 0, b], [b, t, b], [a, t, b], [a, 0, b]], uv: [[b, 0], [b, t], [a, t], [a, 0]], shade: 0.68, glow: false });  // +z
  q.push({ p: [[a, 0, b], [a, t, b], [a, t, a], [a, 0, a]], uv: [[b, 0], [b, t], [a, t], [a, 0]], shade: 0.62, glow: false });  // −x
  q.push({ p: [[b, 0, a], [b, t, a], [b, t, b], [b, 0, b]], uv: [[a, 0], [a, t], [b, t], [b, 0]], shade: 0.84, glow: false });  // +x
  q.push({ p: [[a, t, b], [b, t, b], [b, t, a], [a, t, a]], uv: [[a, 16], [b, 16], [b, 20], [a, 20]], shade: 1, glow: true });   // top
  // the flame: two crossed quads, seen from both sides
  const f0 = FLAME0, f1 = FLAME1, lo = FLAME_BOT, hi = FLAME_TOP, m = 16;
  const flames: number[][][] = [
    [[f0, lo, m], [f0, hi, m], [f1, hi, m], [f1, lo, m]],
    [[m, lo, f1], [m, hi, f1], [m, hi, f0], [m, lo, f0]],
  ];
  for (const p of flames) {
    const uv = [[f0, lo], [f0, hi], [f1, hi], [f1, lo]];
    q.push({ p, uv, shade: 1, glow: true });
    q.push({ p: [p[3], p[2], p[1], p[0]], uv: [uv[3], uv[2], uv[1], uv[0]], shade: 1, glow: true });
  }
  return q;
}

/** Torch model per state, positions in texels relative to the block (may poke slightly past it). */
export const TORCH_MODELS: TorchQuad[][] = [0, 1, 2, 3, 4].map((state) => {
  const base = floorModel();
  if (state === TORCH_FLOOR) return base;
  const c = Math.cos(TILT), s = Math.sin(TILT);
  return base.map((quad) => ({
    ...quad,
    p: quad.p.map(([x, y, z]) => {
      // lean toward +x around the foot of the stick, set the foot against the −x wall, then turn
      const dx = x - 16, dy = y, lx = dx * c + dy * s, ly = -dx * s + dy * c;
      const [rx, rz] = rotY(lx + FOOT_X - 16, z - 16, TURN[state]);
      return [rx + 16, ly + FOOT_Y, rz + 16];
    }),
  }));
});
