import { test, expect, devices } from '@playwright/test';
import { openGame, play, stand, aimAt, tapToAct, block, ticks, waitReady } from './game';

// block ids (src/blocks.ts)
const STONE = 3, BASALT = 30;

test.use({ ...devices['Pixel 7 landscape'] });

test('the block picker: tabs, big targets, search; a tap puts a block in the selected slot, and the world keeps it', async ({ page }) => {
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  const view = () => page.evaluate(() => { const v = window.__voxel; return [v.P[0], v.P[2], v.yaw, v.pitch]; });
  const before = await view();

  // it opens from the button right beside the hotbar
  const btn = page.locator('#pickBtn'), bb = (await btn.boundingBox())!, hb = (await page.locator('#hotbar').boundingBox())!;
  expect(bb.x - (hb.x + hb.width)).toBeGreaterThanOrEqual(0);
  expect(bb.x - (hb.x + hb.width)).toBeLessThan(16);
  await btn.tap();
  await expect(page.locator('#picker')).toBeVisible();
  await expect(page.locator('.ptab')).toHaveText(['NATURAL', 'STONE', 'WOOD', 'PLANTS', 'LIGHT', 'LIQUIDS']);
  await expect(page.locator('.ptab.on')).toHaveText('NATURAL');
  const items = page.locator('.pitem:visible');
  await expect(items).toHaveCount(12);
  for (const it of await items.all()) {                     // big touch targets
    const b = (await it.boundingBox())!;
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(64);
  }

  // the hotbar stays above it: choose the 4th slot, then Stone → Basalt
  await page.locator('.slot').nth(3).tap();
  await page.locator('[data-act="cat:1"]').tap();
  await expect(page.locator('.ptab.on')).toHaveText('STONE');
  await page.locator(`.pitem[data-id="${BASALT}"]`).tap();
  await ticks(page, 2);
  expect(await page.evaluate(() => window.__voxel.hotbar()[3])).toBe(BASALT);
  await expect(page.locator('.slot').nth(3)).toHaveClass(/sel/);
  await expect(page.locator('.slot').nth(3)).toHaveAttribute('title', 'Basalt');
  await expect(page.locator(`.pitem[data-id="${BASALT}"]`)).toHaveClass(/cur/);
  expect(await page.evaluate(() => window.__voxel.mode)).toBe('place');

  // search: the ores; typing doesn't reach the game (E would switch the mode)
  await page.locator('#psearch').tap();
  await page.keyboard.type('ore');
  await expect(page.locator('.pitem:visible span')).toHaveText(['Coal Ore', 'Copper Ore', 'Iron Ore', 'Gold Ore']);
  await expect(page.locator('.ptab.on')).toHaveCount(0);
  expect(await page.evaluate(() => window.__voxel.mode)).toBe('place');
  await page.locator('[data-act="cat:4"]').tap();          // a tab clears the search
  await expect(page.locator('.pitem:visible span')).toHaveText(['Torch', 'Glow Crystal']);

  // on a small screen the grid scrolls with a swipe, and the swipe picks nothing
  await page.setViewportSize({ width: 640, height: 330 });
  await page.locator('[data-act="cat:1"]').tap();
  const grid = page.locator('#pgrid'), gb = (await grid.boundingBox())!;
  expect(await grid.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: number[][]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const x = gb.x + gb.width / 2, y = gb.y + gb.height - 20;
  await touch('touchStart', [[x, y, 1]]);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', [[x, y - k * 15, 1]]); await ticks(page, 1); }
  await touch('touchEnd', []);
  await ticks(page, 2);
  expect(await grid.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__voxel.hotbar()[3])).toBe(BASALT);
  await page.setViewportSize(devices['Pixel 7 landscape'].viewport);

  // nothing in the picker moved or turned the player; close it and build with basalt
  expect(await view()).toEqual(before);
  await page.locator('[data-act="pclose"]').tap();
  await expect(page.locator('#picker')).toBeHidden();
  const [sx, sy, sz] = await page.evaluate((STONE) => {
    const v = window.__voxel, sx = Math.floor(v.P[0]), sy = Math.floor(v.P[1]), sz = Math.floor(v.P[2]);
    for (let x = sx - 3; x <= sx + 3; x++) for (let z = sz - 5; z <= sz + 2; z++) {
      v.setBlock(x, sy - 1, z, STONE);
      for (let y = sy; y < sy + 5; y++) v.setBlock(x, y, z, 0);
    }
    return [sx, sy, sz];
  }, STONE);
  await stand(page, sx + 0.5, sy, sz + 0.5);
  expect((await aimAt(page, [sx + 0.5, sy - 0.02, sz - 1.5]))?.slice(0, 3)).toEqual([sx, sy - 1, sz - 2]);
  await tapToAct(page);
  expect((await block(page, [sx, sy, sz - 2]))[0]).toBe(BASALT);

  // the world keeps its hotbar
  await page.evaluate(() => window.__voxel.save());
  await page.reload();
  await waitReady(page);
  expect(await page.evaluate(() => window.__voxel.hotbar()[3])).toBe(BASALT);
  await expect(page.locator('.slot').nth(3)).toHaveAttribute('title', 'Basalt');
  await expect(page.locator('.slot').nth(3)).toHaveClass(/sel/);
  expect(errors).toEqual([]);
});
