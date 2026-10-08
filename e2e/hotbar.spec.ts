import { test, expect, devices } from '@playwright/test';
import { openGame, play, ticks, until, waitReady } from './game';

// A phone held upright: the hotbar doesn't fit and scrolls
test.use({ ...devices['Pixel 7'] });

test('the hotbar scrolls with a swipe, without moving or turning the player', async ({ page }) => {
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  const bar = page.locator('#hotbar'), slots = page.locator('.slot');
  const box = (await bar.boundingBox())!, vw = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  for (const s of await slots.all()) expect(Math.min((await s.boundingBox())!.width, (await s.boundingBox())!.height)).toBeGreaterThanOrEqual(36);
  expect(await bar.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  await expect(bar).toHaveClass(/fade-r/);

  const view = () => page.evaluate(() => { const v = window.__voxel; return [v.P[0], v.P[2], v.yaw, v.pitch]; });
  const before = await view();
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: number[][]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const y = box.y + box.height / 2;
  await touch('touchStart', [[box.x + box.width - 40, y, 1]]);
  for (let k = 1; k <= 10; k++) { await touch('touchMove', [[box.x + box.width - 40 - k * 20, y, 1]]); await ticks(page, 1); }
  await touch('touchEnd', []);
  await ticks(page, 3);
  expect(await bar.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  await expect(bar).toHaveClass(/fade-l/);
  await expect(slots.nth(0)).toHaveClass(/sel/);       // a swipe is not a tap
  expect(await view()).toEqual(before);

  // the torch slot is now in view: a tap picks it
  await slots.nth(9).tap();
  await ticks(page, 2);
  await expect(slots.nth(9)).toHaveClass(/sel/);
  expect(await page.evaluate(() => window.__voxel.mode)).toBe('place');
  expect(errors).toEqual([]);
});

test('the Fancy leaves setting is in the menu and is remembered', async ({ page }) => {
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  const cutoutMeshes = () => page.evaluate(() => window.__voxel.stream().passes[1]);
  await until(page, async () => (await cutoutMeshes()) > 0);   // trees nearby
  await page.locator('#menuBtn').tap();
  const btn = page.locator('#leavesBtn');
  await expect(btn).toHaveText('ON');
  await btn.tap();
  await expect(btn).toHaveText('OFF');
  await until(page, async () => (await cutoutMeshes()) === 0);
  await page.reload();
  await waitReady(page);
  await expect(btn).toHaveText('OFF');
  await play(page);
  await ticks(page, 30, 10);
  expect(await cutoutMeshes()).toBe(0);
  expect(errors).toEqual([]);
});
