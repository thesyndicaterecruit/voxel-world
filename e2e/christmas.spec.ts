import { test, expect, devices, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { openGame, play, stand, aimAt, tapToAct, block, ticks, until, capture, meanColor, changed, airY } from './game';

// block ids (src/blocks.ts)
const STONE = 3, PLANKS = 6, BRICK = 8, GLASS = 11, TORCH = 12;
const PRESENT = 42, CANDY_CANE = 46, PINK_CANDY_CANE = 47, GINGERBREAD = 48, ICING = 49, ICED_GINGERBREAD = 50, SNOW_BRICKS = 51,
  FROSTED_GLASS = 52, PUZZLE_ICE = 53;
const CHRISTMAS = [PRESENT, PRESENT + 1, PRESENT + 2, PRESENT + 3, CANDY_CANE, PINK_CANDY_CANE, GINGERBREAD, ICING, ICED_GINGERBREAD,
  SNOW_BRICKS, FROSTED_GLASS, PUZZLE_ICE];
const NAMES = ['Red Present', 'Green Present', 'Gold Present', 'Pink Present', 'Candy Cane Block', 'Pink Candy Cane Block', 'Gingerbread',
  'Icing', 'Gingerbread with Icing', 'Snow Bricks', 'Frosted Glass', 'Puzzle Ice'];
// times of day (0 midnight, 0.5 noon, 0.75 sunset)
const NOON = 0.5, SUNSET = 0.745, MIDNIGHT = 0;

test.use({ ...devices['Pixel 7 landscape'] });

/** Save the whole page (HUD included) as test-results/…/<name>.png, also shown in the HTML report. */
async function pageShot(page: Page, name: string): Promise<void> {
  const png = await page.screenshot();
  writeFileSync(test.info().outputPath(`${name}.png`), png);
  await test.info().attach(name, { body: png, contentType: 'image/png' });
}
/** Render a frame and save the 3D view alone. */
async function viewShot(page: Page, name: string): Promise<void> {
  const url = await page.evaluate(() => { window.__tick(1); return document.querySelector('canvas')!.toDataURL('image/png'); });
  const png = Buffer.from(url.split(',')[1], 'base64');
  writeFileSync(test.info().outputPath(`${name}.png`), png);
  await test.info().attach(name, { body: png, contentType: 'image/png' });
}
const luma = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Wait until every edit has been relit and re-meshed */
const edited = async (page: Page) => { await until(page, () => page.evaluate(() => window.__voxel.stream().edits === 0)); await ticks(page, 4, 15); };

test('the Christmas tab: every Christmas block, picked by touch, placed and broken', async ({ page }) => {
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  await page.locator('#pickBtn').tap();
  await expect(page.locator('.ptab')).toHaveText(['NATURAL', 'STONE', 'WOOD', 'PLANTS', 'LIGHT', 'LIQUIDS', 'CHRISTMAS']);
  await page.locator('[data-act="cat:6"]').tap();
  await expect(page.locator('.ptab.on')).toHaveText('CHRISTMAS');
  await expect(page.locator('.pitem:visible span')).toHaveText(NAMES);
  for (const it of await page.locator('.pitem:visible').all()) {           // big touch targets
    const b = (await it.boundingBox())!;
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(64);
  }
  await ticks(page, 2);
  await pageShot(page, 'picker-christmas');

  // fill the hotbar with them, a slot then a block each time
  for (let i = 0; i < 11; i++) {
    await page.locator('.slot').nth(i).tap();
    await page.locator(`.pitem[data-id="${CHRISTMAS[i]}"]`).tap();
  }
  await ticks(page, 2);
  expect(await page.evaluate(() => window.__voxel.hotbar())).toEqual(CHRISTMAS.slice(0, 11));
  await expect(page.locator('.slot').nth(3)).toHaveAttribute('title', 'Pink Present');

  // search: the presents, then the candy canes; a tab clears it
  await page.locator('#psearch').tap();
  await page.keyboard.type('present');
  await expect(page.locator('.pitem:visible span')).toHaveText(NAMES.slice(0, 4));
  await page.locator('#psearch').fill('candy');
  await expect(page.locator('.pitem:visible span')).toHaveText(['Candy Cane Block', 'Pink Candy Cane Block']);
  await page.locator('[data-act="cat:6"]').tap();
  await expect(page.locator('.pitem:visible')).toHaveCount(12);

  // in portrait the tabs wrap, and the Christmas tab is still a big target
  await page.setViewportSize({ width: 412, height: 915 });
  await ticks(page, 4);
  const tab = (await page.locator('[data-act="cat:6"]').boundingBox())!;
  expect(tab.height).toBeGreaterThanOrEqual(40);
  expect(tab.x + tab.width).toBeLessThanOrEqual(412);
  await expect(page.locator('.pitem:visible')).toHaveCount(12);
  await pageShot(page, 'picker-christmas-portrait');
  await page.setViewportSize(devices['Pixel 7 landscape'].viewport);
  await ticks(page, 4);

  // the Pink Present (slot 4) into the world with a tap, then broken with a tap
  await page.locator('.slot').nth(3).tap();
  await page.locator('[data-act="pclose"]').tap();
  await expect(page.locator('#picker')).toBeHidden();
  expect(await page.evaluate(() => window.__voxel.mode)).toBe('place');
  const [sx, sy, sz] = await page.evaluate((STONE) => {
    const v = window.__voxel, sx = Math.floor(v.P[0]), sy = Math.floor(v.P[1]), sz = Math.floor(v.P[2]);
    for (let x = sx - 3; x <= sx + 3; x++) for (let z = sz - 5; z <= sz + 2; z++) {
      v.setBlock(x, sy - 1, z, STONE);
      for (let y = sy; y < sy + 5; y++) v.setBlock(x, y, z, 0);
    }
    return [sx, sy, sz];
  }, STONE);
  await stand(page, sx + 0.5, sy, sz + 0.5);
  await aimAt(page, [sx + 0.5, sy - 0.02, sz - 1.5]);
  await tapToAct(page);
  expect(await block(page, [sx, sy, sz - 2])).toEqual([PRESENT + 3, 0]);
  await pageShot(page, 'hotbar-christmas');
  // frosted glass (slot 11) on top of it
  await page.locator('.slot').nth(10).tap();
  await ticks(page, 2);
  expect((await aimAt(page, [sx + 0.5, sy + 1, sz - 1.5]))?.slice(0, 4)).toEqual([sx, sy, sz - 2, 0]);
  await tapToAct(page);
  expect(await block(page, [sx, sy + 1, sz - 2])).toEqual([FROSTED_GLASS, 0]);
  // break mode: both go
  await page.locator('#mode').tap();
  await ticks(page, 2);
  expect(await page.evaluate(() => window.__voxel.mode)).toBe('break');
  for (const y of [sy + 1, sy]) {
    expect((await aimAt(page, [sx + 0.5, y + 0.5, sz - 1]))?.slice(0, 3)).toEqual([sx, y, sz - 2]);
    await tapToAct(page);
    expect(await block(page, [sx, y, sz - 2])).toEqual([0, 0]);
  }
  expect(errors).toEqual([]);
});

/**
 * A stone platform up in the air: the Christmas blocks in a row along z (the first on the left as
 * seen from the east), presents and candy canes stacked on the first six, frosted glass and snow
 * bricks three high, a glass column to the right to compare, a brick wall behind, a puzzle-ice floor
 * in front, and two torches on top of the row. Returns [sx, Y, sz]: the spawn column and the height
 * of the platform's top. Block i of the row is at (sx − 3, Y, sz + 6 − i).
 */
async function buildDisplay(page: Page): Promise<number[]> {
  const Y = await airY(page);
  const s = await page.evaluate(([CHRISTMAS, STONE, BRICK, GLASS, TORCH, PUZZLE_ICE, Y]) => {
    const v = window.__voxel, sx = Math.floor(v.P[0]), sz = Math.floor(v.P[2]), row = CHRISTMAS as number[];
    for (let x = sx - 7; x <= sx + 5; x++) for (let z = sz - 9; z <= sz + 9; z++) {
      v.setBlock(x, Y - 1, z, STONE);
      for (let y = Y; y < Y + 6; y++) v.setBlock(x, y, z, 0);
    }
    for (let z = sz - 9; z <= sz + 9; z++) for (let y = Y; y < Y + 4; y++) v.setBlock(sx - 5, y, z, BRICK);
    row.forEach((id, i) => v.setBlock(sx - 3, Y, sz + 6 - i, id));
    [row[3], row[1], row[0], row[2], row[5], row[4]].forEach((id, i) => v.setBlock(sx - 3, Y + 1, sz + 6 - i, id));
    v.setBlock(sx - 3, Y + 2, sz + 6, row[8]);                // gingerbread with icing on the stack
    for (let y = Y + 1; y <= Y + 2; y++) { v.setBlock(sx - 3, y, sz - 3, row[9]); v.setBlock(sx - 3, y, sz - 4, row[10]); }
    for (let y = Y; y <= Y + 2; y++) v.setBlock(sx - 3, y, sz - 7, GLASS);   // to compare with the frosted glass
    for (let x = sx - 2; x <= sx; x++) for (let z = sz - 6; z <= sz + 6; z++) v.setBlock(x, Y - 1, z, PUZZLE_ICE);
    v.setBlock(sx - 3, Y + 1, sz, TORCH, 0);                  // on the gingerbread
    v.setBlock(sx - 3, Y + 1, sz - 5, TORCH, 0);              // on the puzzle ice
    return [sx, Y, sz];
  }, [CHRISTMAS, STONE, BRICK, GLASS, TORCH, PUZZLE_ICE, Y] as const);
  await edited(page);
  return s;
}

test('the Christmas blocks by day, at sunset and at night: each looks like itself, frosted glass half see-through', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  const [sx, Y, sz] = await buildDisplay(page);
  /** Look at the whole display from the east */
  const overview = async () => {
    await stand(page, sx + 3.5, Y, sz + 0.5);
    await page.evaluate(() => window.__voxel.look(Math.PI / 2, -0.28));
    await ticks(page, 2);
  };
  await overview();
  for (const [name, t] of [['noon', NOON], ['sunset', SUNSET], ['midnight', MIDNIGHT]] as const) {
    await page.evaluate((t) => window.__voxel.setTime(t), t);
    await ticks(page, 2);
    await viewShot(page, `christmas-${name}`);
    await capture(page, name, [0.1, 0.2, 0.9, 0.8]);
  }
  const noon = await meanColor(page, 'noon'), night = await meanColor(page, 'midnight');
  expect(luma(noon)).toBeGreaterThan(luma(night) * 1.5);

  // at noon, close up, each block's face (toward the player) is the colour it should be
  await page.evaluate((t) => window.__voxel.setTime(t), NOON);
  const face: Record<number, number[]> = {};
  for (const [i, id] of CHRISTMAS.entries()) {
    // a spot off the middle (a present's paper, not its ribbon); near the top of the iced gingerbread (its icing)
    const z = sz + 6 - i, y = id === ICED_GINGERBREAD ? Y + 0.93 : Y + 0.5;
    await stand(page, sx - 0.5, Y, z + 0.5);
    expect((await aimAt(page, [sx - 2, y, z + 0.22]))?.slice(0, 4)).toEqual([sx - 3, Y, z, 1]);
    await capture(page, `face${id}`, [0.48, 0.46, 0.52, 0.54]);
    face[id] = await meanColor(page, `face${id}`);
  }
  const [red, green, gold, pink] = [0, 1, 2, 3].map((i) => face[PRESENT + i]);
  expect(red[0]).toBeGreaterThan(red[1] + 60);
  expect(green[1]).toBeGreaterThan(green[0] + 30);
  expect(gold[0]).toBeGreaterThan(gold[2] + 60);
  expect(gold[1]).toBeGreaterThan(gold[2] + 30);
  expect(pink[0]).toBeGreaterThan(pink[1] + 40);
  expect(pink[2]).toBeGreaterThan(pink[1]);
  expect(face[CANDY_CANE][0]).toBeGreaterThan(face[CANDY_CANE][1] + 40);
  expect(face[PINK_CANDY_CANE][2]).toBeGreaterThan(face[CANDY_CANE][2] + 20);
  const gb = face[GINGERBREAD];
  expect(gb[0] > gb[1] && gb[1] > gb[2]).toBe(true);
  expect(Math.min(...face[ICING])).toBeGreaterThan(Math.max(...gb));
  expect(luma(face[ICED_GINGERBREAD])).toBeGreaterThan(luma(gb) + 30);    // icing along its top
  expect(Math.min(...face[SNOW_BRICKS])).toBeGreaterThan(150);
  expect(face[PUZZLE_ICE][1]).toBeGreaterThan(face[PUZZLE_ICE][0] + 20);    // pale turquoise

  // frosted glass shows the wall behind it in part: less than glass does, more than a solid block
  const seeThrough = async (z: number) => {
    await stand(page, sx - 1.3, Y, z + 0.5);
    await aimAt(page, [sx - 3, Y + 1.62, z + 0.5]);
    for (const [name, id] of [['brick', BRICK], ['planks', PLANKS], ['', BRICK]] as const) {
      await page.evaluate(([sx, Y, sz, id]) => {
        for (let z = sz - 9; z <= sz + 9; z++) for (let y = Y; y < Y + 4; y++) window.__voxel.setBlock(sx - 5, y, z, id);
      }, [sx, Y, sz, id]);
      await edited(page);
      if (name) await capture(page, name);
    }
    return changed(page, 'brick', 'planks');
  };
  const frosted = await seeThrough(sz - 4), glass = await seeThrough(sz - 7);
  expect(frosted).toBeGreaterThan(0.15);
  expect(frosted).toBeLessThan(glass - 0.1);
  expect(await seeThrough(sz - 3)).toBeLessThan(0.01);      // snow bricks
  await stand(page, sx - 0.2, Y, sz - 3.5);
  await aimAt(page, [sx - 3, Y + 1.2, sz - 3.5]);
  await viewShot(page, 'frosted-glass');

  // at midnight the torches light the blocks round them, warm
  await page.evaluate((t) => window.__voxel.setTime(t), MIDNIGHT);
  await overview();
  await capture(page, 'torches', [0.1, 0.2, 0.9, 0.8]);
  await page.evaluate(([x, y, z]) => { window.__voxel.setBlock(x, y, z, 0); window.__voxel.setBlock(x, y, z - 5, 0); }, [sx - 3, Y + 1, sz]);
  await edited(page);
  await viewShot(page, 'christmas-midnight-no-torches');
  await capture(page, 'moonlight', [0.1, 0.2, 0.9, 0.8]);
  const lit = await meanColor(page, 'torches'), dark = await meanColor(page, 'moonlight');
  expect(luma(lit)).toBeGreaterThan(luma(dark) * 1.2);
  expect(lit[0] / lit[2]).toBeGreaterThan(dark[0] / dark[2]);
  expect(errors).toEqual([]);
});
