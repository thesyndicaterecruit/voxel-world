import { test, expect, devices, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { openGame, play, ticks, until, settle, aimAt, capture, changed } from './game';

// block ids (src/blocks.ts)
const TORCH = 12;
// times of day (0 midnight, 0.5 noon)
const NOON = 0.5, MIDNIGHT = 0;

test.use({ ...devices['Pixel 7 landscape'] });

/** Save the 3D view (HUD hidden) as test-results/…/<name>.png, also in the report. */
async function screenshot(page: Page, name: string): Promise<void> {
  await page.addStyleTag({ content: '#ui{visibility:hidden}' });
  await ticks(page, 1);
  const png = await page.screenshot();
  await page.addStyleTag({ content: '#ui{visibility:visible}' });
  writeFileSync(test.info().outputPath(`${name}.png`), png);
  await test.info().attach(name, { body: png, contentType: 'image/png' });
}

const bentley = (page: Page) => page.evaluate(() => { const b = window.__voxel.bentley; return b && { ...b, p: b.p.slice() }; });

/**
 * Stand the player `d` blocks from Bentley, `angle` degrees round from straight in front of him, and look
 * at him (his middle): a picture of him from three quarters front at 35°.
 */
async function lookAtHim(page: Page, angle = 35, d = 2.2): Promise<void> {
  const b = (await bentley(page))!, r = b.yaw + (angle * Math.PI) / 180;
  await page.evaluate(([x, y, z]) => { const v = window.__voxel; v.P[0] = x; v.P[1] = y; v.P[2] = z; v.V.fill(0); },
    [b.p[0] - Math.sin(r) * d, b.p[1], b.p[2] - Math.cos(r) * d]);
  await ticks(page, 2, 10);
  await aimAt(page, [b.p[0], b.p[1] + 0.35, b.p[2]]);
}

/** Share of a capture's pixels that are Bentley's fawn, and that are black (his mask, muzzle and ears) */
const colours = (page: Page, name: string) => page.evaluate((name) => {
  const A = window.__shots[name];
  let fawn = 0, black = 0;
  for (let i = 0; i < A.length; i += 4) {
    const r = A[i], g = A[i + 1], b = A[i + 2];
    if (r > 105 && r > g && g > b && r - b > 45) fawn++;
    if (Math.max(r, g, b) < 45) black++;
  }
  return [fawn / (A.length / 4), black / (A.length / 4)];
}, name);

/** Mean colour of the pixels Bentley covers in the view's middle now: captured with him, and with him moved away */
async function hisColour(page: Page, name: string): Promise<number[]> {
  await capture(page, name);
  const at = await page.evaluate(() => { const p = window.__voxel.bentley!.p, at = p.slice(); p[0] += 40; return at; });
  await capture(page, `${name}-without`);
  await page.evaluate((at) => { const b = window.__voxel.bentley!, v = window.__voxel; b.p[0] = at[0]; b.p[1] = at[1]; b.p[2] = at[2]; v.V.fill(0); }, at);
  await ticks(page, 2);
  return page.evaluate((name) => {
    const A = window.__shots[name], B = window.__shots[`${name}-without`], sum = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < A.length; i += 4) {
      if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) <= 24) continue;
      sum[0] += A[i]; sum[1] += A[i + 1]; sum[2] += A[i + 2];
      n++;
    }
    return [...sum.map((v) => v / Math.max(1, n)), n];
  }, name);
}
const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

test('Bentley: spawned from the menu by touch, his poses cycled with the Pose button, a picture of each; lit like where he stands', async ({ page }) => {
  test.setTimeout(480_000);
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  await page.evaluate((t) => window.__voxel.setTime(t), NOON);
  await settle(page);
  expect(await bentley(page)).toBeNull();
  await expect(page.locator('#pose')).toBeHidden();
  const before = (await page.evaluate(() => window.__voxel.stream())).calls;
  const me = await page.evaluate(() => [...window.__voxel.P, window.__voxel.yaw]);

  // Menu → Bentley → SPAWN: the menu closes, and he's in front of the player, facing them
  await page.tap('#menuBtn');
  await page.tap('[data-act="bentley"]');
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#pose')).toBeVisible();
  await until(page, async () => !!(await bentley(page))?.onGround, 120);
  const b = (await bentley(page))!;
  expect(b).toMatchObject({ state: 'idle', frozen: false, states: ['idle', 'walk', 'sit', 'sleep', 'wag'] });
  const ahead = (b.p[0] - me[0]) * -Math.sin(me[3]) + (b.p[2] - me[2]) * -Math.cos(me[3]);
  expect(ahead).toBeGreaterThan(0.9);
  expect(ahead).toBeLessThan(2.6);
  expect(Math.cos(b.yaw - (me[3] + Math.PI))).toBeGreaterThan(0.999);
  // one more draw call for him, at most two
  const after = (await page.evaluate(() => window.__voxel.stream())).calls;
  expect(after - before).toBeGreaterThanOrEqual(1);
  expect(after - before).toBeLessThanOrEqual(2);

  // the Pose button goes through what he can do, saying which
  for (const [state, name] of [['walk', 'waddling'], ['sit', 'sitting'], ['sleep', 'asleep'], ['wag', 'wagging'], ['idle', 'standing about']]) {
    await page.tap('#pose');
    expect((await bentley(page))!.state).toBe(state);
    await expect(page.locator('#toast')).toHaveText(`Bentley: ${name}`);
    await ticks(page, 2);
  }

  // a picture of each, from three quarters front (asleep: from his belly's side): a fawn pug with a
  // black face, whatever he's doing
  await page.evaluate(() => window.__voxel.showTarget(false));
  for (const state of ['idle', 'walk', 'sit', 'wag', 'sleep']) {
    await page.evaluate((s) => { window.__voxel.bentley!.state = s; }, state);
    await ticks(page, state === 'sleep' ? 80 : 30);                 // eased in (asleep long enough for a Z)
    await lookAtHim(page, state === 'sleep' ? -20 : 35);
    await capture(page, state);
    const [fawn, black] = await colours(page, state);
    expect(fawn, state).toBeGreaterThan(0.04);
    expect(black, state).toBeGreaterThan(0.005);
    await screenshot(page, `bentley-${state}`);
  }
  // each looks different
  for (const [a, c] of [['idle', 'sit'], ['idle', 'sleep'], ['sit', 'sleep'], ['idle', 'walk']]) expect(await changed(page, a, c), `${a} / ${c}`).toBeGreaterThan(0.02);

  // asleep, Zs rise from him
  expect((await bentley(page))!.zzz).toBeGreaterThanOrEqual(1);
  // walking, he goes round in a circle
  await page.evaluate(() => { window.__voxel.bentley!.state = 'walk'; });
  const from = (await bentley(page))!.p;
  await ticks(page, 30);
  const to = (await bentley(page))!.p;
  expect(Math.hypot(to[0] - from[0], to[2] - from[2])).toBeGreaterThan(0.3);

  // lit like the block he stands in: darker at night, warm by a torch
  await page.evaluate(() => { window.__voxel.bentley!.state = 'sit'; });
  await ticks(page, 30);
  await lookAtHim(page, 20, 2.4);
  const noon = await hisColour(page, 'noon');
  expect(noon[3]).toBeGreaterThan(400);                             // pixels of him
  await page.evaluate((t) => window.__voxel.setTime(t), MIDNIGHT);
  await ticks(page, 3);
  const night = await hisColour(page, 'night');
  expect(luma(night)).toBeLessThan(luma(noon) * 0.6);
  await screenshot(page, 'bentley-night');
  // a torch on the ground just behind him (seen from here)
  const at = (await bentley(page))!.p, eye = await page.evaluate(() => window.__voxel.P.slice());
  const away = Math.hypot(at[0] - eye[0], at[2] - eye[2]), ty = Math.floor(at[1]);
  const tx = Math.floor(at[0] + ((at[0] - eye[0]) / away) * 1.2), tz = Math.floor(at[2] + ((at[2] - eye[2]) / away) * 1.2);
  await page.evaluate(([x, y, z, id]) => window.__voxel.setBlock(x, y, z, id), [tx, ty, tz, TORCH]);
  await until(page, () => page.evaluate(([x, y, z]) => window.__voxel.light(x, y, z)[1] >= 11, [Math.floor(at[0]), ty, Math.floor(at[2])]), 60);
  await ticks(page, 10);
  const torch = await hisColour(page, 'torch');
  expect(luma(torch)).toBeGreaterThan(luma(night) * 1.3);
  expect(torch[0] / torch[2]).toBeGreaterThan(night[0] / night[2]);   // warmer
  await screenshot(page, 'bentley-torch');
  expect(errors).toEqual([]);
});

