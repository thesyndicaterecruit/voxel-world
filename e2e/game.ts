import { expect, type Page } from '@playwright/test';

/* ======================= DRIVING THE GAME IN A TEST ======================= */
// The page's clock, frames and Math.random are replaced (before any game code runs) so that the game
// only moves on when the test calls ticks(): runs are repeatable however slow the GPU is. Worker
// jobs (generation, meshing) still run for real, so ticks() leaves gaps for their results.

/** Init script: deterministic performance.now / requestAnimationFrame / Math.random. */
function deterministic(): void {
  let t = 1000, seed = 42;
  const q: FrameRequestCallback[] = [];
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
  target(): { x: number; y: number; z: number; nx: number; ny: number; nz: number; id: number } | null;
  count(): number;
  stream(): { passes: number[] };
  chunk(cx: number, cz: number): { tris: number[] };
  setFancyLeaves(on: boolean): void;
  save(): Promise<void>;
  worldId: string;
}
declare global {
  interface Window { __voxel: Voxel; __tick(n: number): void; __shots: Record<string, Uint8ClampedArray> }
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

/** Render a frame and keep the pixels of the middle of the 3D view (no HUD) under `name`. */
export function capture(page: Page, name: string): Promise<void> {
  return page.evaluate((name) => {
    window.__tick(1);                                   // read back in the same task as the render
    const c = document.querySelector('canvas')!, w = Math.floor(c.width * 0.28), h = Math.floor(c.height * 0.4);
    const t = document.createElement('canvas');
    t.width = w; t.height = h;
    const g = t.getContext('2d')!;
    g.drawImage(c, Math.floor(c.width * 0.36), Math.floor(c.height * 0.3), w, h, 0, 0, w, h);
    window.__shots = { ...window.__shots, [name]: g.getImageData(0, 0, w, h).data };
  }, name);
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
