import { expect, type Page } from '@playwright/test';

/* ======================= DRIVING THE GAME IN A TEST ======================= */
// The page's clock, frames and Math.random are replaced (before any game code runs) so that the game
// only moves on when the test calls ticks(): runs are repeatable however slow the GPU is. Worker
// jobs (generation, meshing) still run for real, so ticks() leaves gaps for their results.

/** Init script: deterministic performance.now / requestAnimationFrame / Math.random. */
function deterministic(): void {
  let t = 1000, seed = 42;
  const q: FrameRequestCallback[] = [];
  (window as unknown as { __realNow: () => number }).__realNow = performance.now.bind(performance);   // for timing
  Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  performance.now = () => t;
  window.requestAnimationFrame = (f) => { q.push(f); return q.length; };
  (window as unknown as { __tick: (n: number) => void }).__tick = (n) => {
    for (let i = 0; i < n; i++) { t += 16; q.splice(0).forEach((f) => f(t)); }
  };
}

/** The debug handle (window.__voxel, see main.ts), as far as the tests use it. */
export interface Voxel {
  P: number[]; V: number[]; ready: boolean; mode: string; yaw: number; pitch: number;
  get(x: number, y: number, z: number): number;
  getState(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, id: number, state?: number): void;
  look(yaw: number, pitch: number): void;
  /** The block in each hotbar slot, the selected slot, and putting a block in it (the block picker's tap) */
  hotbar(): number[];
  sel(): number;
  pick(id: number): void;
  target(): { x: number; y: number; z: number; nx: number; ny: number; nz: number; id: number } | null;
  count(): number;
  chunk(cx: number, cz: number): { tris: number[]; meshed: number };
  setFancyLeaves(on: boolean): void;
  save(): Promise<void>;
  worldId: string;
  light(x: number, y: number, z: number): number[];
  verifyLight(cx: number, cz: number): number;
  /** World clock in days; setTime(t) sets today's time of day (0 midnight, 0.5 noon) */
  time: number;
  setTime(t: number): void;
  /** How deep in water the player is (0 dry, 1 feet, 2 waist, 3 head), and seconds of air left */
  wet: number;
  breath: number;
  onGround: boolean;
  water(): { pending: number; ticks: number; changed: number; ms: number };
  /** Draw the water blocks or not (to time what drawing them costs) */
  showWater(on: boolean): void;
  /** The world's sea level and generator version (gen.ts) */
  seaLevel: number;
  generator: number;
  world: { topY(x: number, z: number): number };
  /** Biomes (generator 2 on): their names, the one at the player or at column (x, z), and the teleport to the nearest of one (distance; −1 none) */
  biomes: string[];
  biome(): string | null;
  biomeAt(x: number, z: number): string | null;
  teleport(id: number): number;
  stream(): { loaded: number; lit: number; meshed: number; passes: number[]; queued: number; edits: number; genMs: number; genMax: number;
    generated: number };
}
declare global {
  interface Window { __voxel: Voxel; __tick(n: number): void; __realNow(): number; __shots: Record<string, Uint8ClampedArray> }
}

/**
 * Open the game at `query` with the deterministic clock, wait until it can be played, and return
 * the list that collects console errors and warnings (expected to stay empty).
 */
export async function openGame(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // SwiftShader warns when a canvas is read back; that's the test reading pixels, not the game
    if (m.type() === 'error' || (m.type() === 'warning' && !m.text().includes('GPU stall'))) errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.addInitScript(deterministic);
  await page.goto(query);
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important}' });
  await waitReady(page);
  return errors;
}

export async function waitReady(page: Page): Promise<void> {
  for (let i = 0; i < 4000; i++) {
    await page.evaluate(() => window.__tick(1));
    if (await page.evaluate(() => !!window.__voxel?.ready)) return;
    await page.waitForTimeout(5);
  }
  throw new Error('the game never became ready');
}

/** Run n frames, letting worker results arrive for gapMs between frames. */
export async function ticks(page: Page, n: number, gapMs = 4): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => window.__tick(1));
    if (gapMs) await page.waitForTimeout(gapMs);
  }
}

/** Run frames until `done()` holds, at most `max` of them; returns how many it took. */
export async function until(page: Page, done: () => Promise<boolean>, max = 600): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await ticks(page, 1, 15);
    if (await done()) return i;
  }
  throw new Error(`still waiting after ${max} frames`);
}

/**
 * A height to build in the air at, around the player: 8 blocks above the highest block within `r`
 * blocks (at least the sea level), below the top of the world.
 */
export function airY(page: Page, r = 16): Promise<number> {
  return page.evaluate((r) => {
    const v = window.__voxel, x0 = Math.floor(v.P[0]), z0 = Math.floor(v.P[2]);
    let top = v.seaLevel;
    for (let z = z0 - r; z <= z0 + r; z++) for (let x = x0 - r; x <= x0 + r; x++) top = Math.max(top, v.world.topY(x, z));
    return Math.min(top + 8, 116);
  }, r);
}

/** Run frames until streaming has settled: the same chunk counts 10 frames running. */
export async function settle(page: Page, max = 1000): Promise<void> {
  let last = '', same = 0;
  await until(page, async () => {
    const s = await page.evaluate(() => { const s = window.__voxel.stream(); return [s.loaded, s.lit, s.meshed, s.queued].join(); });
    same = s === last ? same + 1 : 0;
    last = s;
    return same >= 10;
  }, max);
}

/** Tap PLAY on the start card. */
export async function play(page: Page): Promise<void> {
  await page.tap('#play');
  await ticks(page, 10, 10);
  await expect(page.locator('body')).toHaveClass(/playing/);
}

/** Put the player's feet at (x, y, z), standing still. */
export async function stand(page: Page, x: number, y: number, z: number): Promise<void> {
  await page.evaluate(([x, y, z]) => { const v = window.__voxel; v.P[0] = x; v.P[1] = y; v.P[2] = z; v.V.fill(0); }, [x, y, z]);
  await ticks(page, 3, 10);
}

/** Turn the camera so the crosshair points at `pt`; returns what it is on ([x, y, z, nx, ny, nz, id]). */
export function aimAt(page: Page, pt: number[]): Promise<number[] | null> {
  return page.evaluate((pt) => {
    const v = window.__voxel, dx = pt[0] - v.P[0], dy = pt[1] - (v.P[1] + 1.62), dz = pt[2] - v.P[2];
    v.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    const h = v.target();
    return h && [h.x, h.y, h.z, h.nx, h.ny, h.nz, h.id];
  }, pt);
}

/** A short tap on the look side of the screen: breaks or places at the crosshair. */
export async function tapToAct(page: Page): Promise<void> {
  const { width, height } = page.viewportSize()!;
  await page.touchscreen.tap(width * 0.72, height * 0.62);
  await ticks(page, 4, 20);
}

/** [block id, block state] at (x, y, z) */
export const block = (page: Page, [x, y, z]: number[]) =>
  page.evaluate(([x, y, z]) => [window.__voxel.get(x, y, z), window.__voxel.getState(x, y, z)], [x, y, z]);

/**
 * Render a frame and keep the pixels of part of the 3D view (no HUD) under `name`: by default the
 * middle; `box` is [left, top, right, bottom] as fractions of the view.
 */
export function capture(page: Page, name: string, box = [0.36, 0.3, 0.64, 0.7]): Promise<void> {
  return page.evaluate(([name, box]) => {
    window.__tick(1);                                   // read back in the same task as the render
    const c = document.querySelector('canvas')!, x = Math.floor(c.width * box[0]), y = Math.floor(c.height * box[1]);
    const w = Math.floor(c.width * box[2]) - x, h = Math.floor(c.height * box[3]) - y;
    const t = document.createElement('canvas');
    t.width = w; t.height = h;
    const g = t.getContext('2d')!;
    g.drawImage(c, x, y, w, h, 0, 0, w, h);
    window.__shots = { ...window.__shots, [name]: g.getImageData(0, 0, w, h).data };
  }, [name, box] as const);
}

/** Average colour (0–255 per channel) of a capture. */
export function meanColor(page: Page, name: string): Promise<number[]> {
  return page.evaluate((name) => {
    const A = window.__shots[name], sum = [0, 0, 0];
    for (let i = 0; i < A.length; i += 4) { sum[0] += A[i]; sum[1] += A[i + 1]; sum[2] += A[i + 2]; }
    return sum.map((v) => v / (A.length / 4));
  }, name);
}

/**
 * Hold the joystick pushed `dx`, `dy` px from where the thumb went down (negative dy: forward), with
 * a real touch; returns a function that lets go.
 */
export async function holdJoystick(page: Page, dx: number, dy: number): Promise<() => Promise<void>> {
  const { height } = page.viewportSize()!, cdp = await page.context().newCDPSession(page);
  const x = 110, y = height - 110;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 7 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy, id: 7 }] });
  return async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };
}

/**
 * Fingers on the touchscreen, several at once (CDP touch events): down / move / up by finger id.
 * close() lifts any still down.
 */
export async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page), on = new Map<number, number[]>();
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd') => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...on].map(([id, [x, y]]) => ({ id, x, y })) });
  return {
    async down(id: number, x: number, y: number) { on.set(id, [x, y]); await send('touchStart'); },
    async move(id: number, x: number, y: number) { on.set(id, [x, y]); await send('touchMove'); },
    async up(id: number) { on.delete(id); await send('touchEnd'); },
    async close() { if (on.size) { on.clear(); await send('touchEnd'); } await cdp.detach(); },
  };
}

/**
 * Run n frames, timing each with the real clock (ms), drawing included (reading a pixel back waits
 * for the GPU to finish the frame); returns the median.
 */
export function frameMs(page: Page, n: number): Promise<number> {
  return page.evaluate(async (n) => {
    const t: number[] = [], gl = document.querySelector('canvas')!.getContext('webgl2')!, px = new Uint8Array(4);
    for (let i = 0; i < n; i++) {
      const a = window.__realNow();
      window.__tick(1);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      t.push(window.__realNow() - a);
      await new Promise((r) => setTimeout(r, 4));       // let worker results in
    }
    t.sort((a, b) => a - b);
    return t[t.length >> 1];
  }, n);
}

/** Share of pixels that differ clearly between two captures. */
export function changed(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(([a, b]) => {
    const A = window.__shots[a], B = window.__shots[b];
    let n = 0;
    for (let i = 0; i < A.length; i += 4) {
      if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) > 24) n++;
    }
    return n / (A.length / 4);
  }, [a, b]);
}
