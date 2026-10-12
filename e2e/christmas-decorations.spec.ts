import { test, expect, devices, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { openGame, play, stand, aimAt, tapToAct, block, ticks, until, capture, meanColor, airY } from './game';

// block ids (src/blocks.ts)
const STONE = 3, LOG = 5, LEAVES = 7, SNOW = 13, PRESENT = 42;
const PAW_PRINTS = 54, BAUBLE = 55, FAIRY_LIGHTS = 58, WREATH = 59, STOCKING = 60, STAR = 61;
/** The decorations in the Christmas tab's order, and their names */
const DECOR = [STAR, BAUBLE, BAUBLE + 1, BAUBLE + 2, FAIRY_LIGHTS, WREATH, STOCKING, PAW_PRINTS];
const DECOR_NAMES = ['Star', 'Pink Bauble', 'Red Bauble', 'Gold Bauble', 'Fairy Lights', 'Wreath', 'Stocking', 'Paw Prints'];
/** A flat block on the floor turned 0–3 (toward −z, −x, +z, +x) has state 5 + the turn (src/plants.ts) */
const FLAT_TURNED = 5;
const NOON = 0.5, MIDNIGHT = 0;

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
/** The brightest channel anywhere in a capture */
const brightest = (page: Page, name: string) => page.evaluate((name) => {
  const A = window.__shots[name];
  let m = 0;
  for (let i = 0; i < A.length; i += 4) m = Math.max(m, A[i], A[i + 1], A[i + 2]);
  return m;
}, name);

/**
 * A stone platform up in the air round the spawn point (its top at Y), relative to the spawn column
 * (sx, sz): a small tree (a log at sx − 3, sz − 3; leaves 5 × 5 at Y + 2 and 3 × 3 at Y + 3), a stone
 * wall facing +x at x = sx − 6 (z sz + 1 … sz + 5, 4 high), a patch of snow (x sx − 1 … sx + 3,
 * z sz + 2 … sz + 6), and a stone pillar 3 high at (sx + 1, sz − 3) to stand on and reach the top of
 * the tree. Returns [sx, Y, sz].
 */
async function buildScene(page: Page): Promise<number[]> {
  const Y = await airY(page);
  const s = await page.evaluate(([STONE, LOG, LEAVES, SNOW, Y]) => {
    const v = window.__voxel, sx = Math.floor(v.P[0]), sz = Math.floor(v.P[2]);
    for (let x = sx - 9; x <= sx + 7; x++) for (let z = sz - 8; z <= sz + 9; z++) {
      v.setBlock(x, Y - 1, z, STONE);
      for (let y = Y; y < Y + 7; y++) v.setBlock(x, y, z, 0);
    }
    for (let y = Y; y <= Y + 1; y++) v.setBlock(sx - 3, y, sz - 3, LOG);
    for (let x = sx - 5; x <= sx - 1; x++) for (let z = sz - 5; z <= sz - 1; z++) v.setBlock(x, Y + 2, z, LEAVES);
    for (let x = sx - 4; x <= sx - 2; x++) for (let z = sz - 4; z <= sz - 2; z++) v.setBlock(x, Y + 3, z, LEAVES);
    for (let z = sz + 1; z <= sz + 5; z++) for (let y = Y; y <= Y + 3; y++) v.setBlock(sx - 6, y, z, STONE);
    for (let x = sx - 1; x <= sx + 3; x++) for (let z = sz + 2; z <= sz + 6; z++) v.setBlock(x, Y - 1, z, SNOW);
    for (let y = Y; y <= Y + 2; y++) v.setBlock(sx + 1, y, sz - 3, STONE);
    return [sx, Y, sz];
  }, [STONE, LOG, LEAVES, SNOW, Y] as const);
  await edited(page);
  return s;
}

test('the decorations by touch: a bauble under leaves, the star on a tree, paw prints the way you look, things on a wall; broken with a tap, and popping off with what holds them', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  const [sx, Y, sz] = await buildScene(page);

  // the picker's Christmas tab, then the 8 decorations into the first 8 slots, a slot then a block each time
  await page.locator('#pickBtn').tap();
  await page.locator('[data-act="cat:6"]').tap();
  await expect(page.locator('.pitem:visible')).toHaveCount(20);
  expect((await page.locator('.pitem:visible span').allTextContents()).slice(12)).toEqual(DECOR_NAMES);   // after the cubes
  for (const [i, id] of DECOR.entries()) {
    await page.locator('.slot').nth(i).tap();
    await page.locator(`.pitem[data-id="${id}"]`).tap();
  }
  await ticks(page, 2);
  expect((await page.evaluate(() => window.__voxel.hotbar())).slice(0, 8)).toEqual(DECOR);
  await page.locator(`.pitem[data-id="${STAR}"]`).scrollIntoViewIfNeeded();
  await pageShot(page, 'picker-decorations');
  await page.locator('[data-act="pclose"]').tap();
  await expect(page.locator('#picker')).toBeHidden();
  expect(await page.evaluate(() => window.__voxel.mode)).toBe('place');
  const slot = async (id: number) => { await page.locator('.slot').nth(DECOR.indexOf(id)).tap(); await ticks(page, 2); };
  /** Stand at `from` (feet), aim at `at`, check what the crosshair is on (block and face), tap, check what's there now */
  const place = async (from: number[], at: number[], hit: number[], cell: number[], want: number[]) => {
    await stand(page, from[0], from[1], from[2]);
    expect((await aimAt(page, at))?.slice(0, 6), `aiming for ${cell}`).toEqual(hit);
    await tapToAct(page);
    expect(await block(page, cell), `placed at ${cell}`).toEqual(want);
  };

  // a bauble: a tap on the underside of the leaves hangs it there
  await slot(BAUBLE);
  await place([sx + 0.5, Y, sz - 0.5], [sx - 0.5, Y + 2, sz - 0.5], [sx - 1, Y + 2, sz - 1, 0, -1, 0], [sx - 1, Y + 1, sz - 1], [BAUBLE, 0]);
  // …not where there is nothing above to hang from: a tap on the side of the wall, low down, says so
  await place([sx - 3.5, Y, sz + 3.5], [sx - 5, Y + 1.5, sz + 3.5], [sx - 6, Y + 1, sz + 3, 1, 0, 0], [sx - 5, Y + 1, sz + 3], [0, 0]);
  await expect(page.locator('#toast')).toHaveText('Hangs under a block');
  await slot(BAUBLE + 2);                                          // a gold one next to the pink
  await place([sx + 0.5, Y, sz - 0.5], [sx - 0.5, Y + 2, sz - 1.5], [sx - 1, Y + 2, sz - 2, 0, -1, 0], [sx - 1, Y + 1, sz - 2], [BAUBLE + 2, 0]);

  // the star: from the top of the pillar, on top of the tree
  await slot(STAR);
  await place([sx + 1.5, Y + 3, sz - 2.5], [sx - 2.5, Y + 4, sz - 2.5], [sx - 3, Y + 3, sz - 3, 0, 1, 0], [sx - 3, Y + 4, sz - 3], [STAR, 0]);

  // paw prints on the snow, pointing the way the player looks: −z, +z, −x, +x (the last two from a negative yaw)
  await slot(PAW_PRINTS);
  const P = [sx + 1.5, Y, sz + 4.5];
  for (const [dx, dz, turn] of [[0, -1, 0], [0, 1, 2], [-1, 0, 1], [1, 0, 3]]) {
    const cx = sx + 1 + dx, cz = sz + 4 + dz;
    await place(P, [cx + 0.5, Y, cz + 0.5], [cx, Y - 1, cz, 0, 1, 0], [cx, Y, cz], [PAW_PRINTS, FLAT_TURNED + turn]);
  }

  // on the wall: fairy lights, a wreath, a stocking (state 1: the wall is at −x)
  for (const [id, y, z] of [[FAIRY_LIGHTS, Y + 3, sz + 3], [WREATH, Y + 2, sz + 2], [STOCKING, Y + 1, sz + 4]]) {
    await slot(id);
    await place([sx - 3.5, Y, sz + 3.5], [sx - 5, y + 0.5, z + 0.5], [sx - 6, y, z, 1, 0, 0], [sx - 5, y, z], [id, 1]);
  }
  await edited(page);
  // they glow: the star gives off 15 (14 next to it), the fairy lights 8
  expect(await page.evaluate(([x, y, z]) => [window.__voxel.light(x, y, z)[1], window.__voxel.light(x + 1, y, z)[1]], [sx - 3, Y + 4, sz - 3])).toEqual([15, 14]);
  expect(await page.evaluate(([x, y, z]) => window.__voxel.light(x, y, z)[1], [sx - 5, Y + 3, sz + 3])).toBe(8);
  await pageShot(page, 'hotbar-decorations');

  // break mode: each one goes with a tap on its own small hit box
  await page.locator('#mode').tap();
  await ticks(page, 2);
  expect(await page.evaluate(() => window.__voxel.mode)).toBe('break');
  const breakAt = async (from: number[], at: number[], cell: number[], id: number) => {
    await stand(page, from[0], from[1], from[2]);
    expect((await aimAt(page, at))?.[6], `aiming at ${id}`).toBe(id);
    await tapToAct(page);
    expect(await block(page, cell)).toEqual([0, 0]);
  };
  // a tap just under the bauble's ball doesn't hit it
  await stand(page, sx + 0.5, Y, sz - 0.5);
  expect((await aimAt(page, [sx - 0.5, Y + 0.9, sz - 0.5]))?.[6]).not.toBe(BAUBLE);
  await breakAt([sx + 0.5, Y, sz - 0.5], [sx - 0.5, Y + 1.55, sz - 0.5], [sx - 1, Y + 1, sz - 1], BAUBLE);
  await breakAt([sx + 1.5, Y + 3, sz - 2.5], [sx - 2.5, Y + 4.45, sz - 2.5], [sx - 3, Y + 4, sz - 3], STAR);
  await breakAt(P, [sx + 1.5, Y + 0.05, sz + 3.5], [sx + 1, Y, sz + 3], PAW_PRINTS);
  for (const [id, y, z] of [[FAIRY_LIGHTS, Y + 3, sz + 3], [WREATH, Y + 2, sz + 2], [STOCKING, Y + 1, sz + 4]]) {
    await breakAt([sx - 3.5, Y, sz + 3.5], [sx - 4.95, y + 0.5, z + 0.5], [sx - 5, y, z], id);
  }

  // what holds them goes, and they pop off: the leaves over the gold bauble broken with a tap, the rest from here
  await breakAt([sx + 0.5, Y, sz - 0.5], [sx - 0.1, Y + 2, sz - 1.1], [sx - 1, Y + 2, sz - 2], LEAVES);   // a corner well clear of the bauble
  expect(await block(page, [sx - 1, Y + 1, sz - 2])).toEqual([0, 0]);
  await page.evaluate(([sx, Y, sz, STAR, STOCKING, PAW_PRINTS, FAIRY_LIGHTS]) => {
    const v = window.__voxel;
    v.setBlock(sx - 3, Y + 4, sz - 3, STAR);
    v.setBlock(sx - 5, Y + 1, sz + 1, STOCKING, 1);
    v.setBlock(sx - 5, Y + 2, sz + 1, FAIRY_LIGHTS, 1);
    v.setBlock(sx + 1, Y, sz + 4, PAW_PRINTS, 7);
  }, [sx, Y, sz, STAR, STOCKING, PAW_PRINTS, FAIRY_LIGHTS]);
  await ticks(page, 2);
  for (const [c, id] of [[[sx - 3, Y + 4, sz - 3], STAR], [[sx - 5, Y + 1, sz + 1], STOCKING], [[sx + 1, Y, sz + 4], PAW_PRINTS]] as const) {
    expect((await block(page, [...c]))[0]).toBe(id);
  }
  await page.evaluate(([sx, Y, sz]) => {
    const v = window.__voxel;
    v.setBlock(sx - 3, Y + 3, sz - 3, 0);                         // the leaves under the star
    v.setBlock(sx - 6, Y + 1, sz + 1, 0); v.setBlock(sx - 6, Y + 2, sz + 1, 0);   // the wall behind the stocking and the lights
    v.setBlock(sx + 1, Y - 1, sz + 4, 0);                         // the snow under the paw prints
  }, [sx, Y, sz]);
  await ticks(page, 2);
  for (const c of [[sx - 3, Y + 4, sz - 3], [sx - 5, Y + 1, sz + 1], [sx - 5, Y + 2, sz + 1], [sx + 1, Y, sz + 4]]) expect(await block(page, c), `${c}`).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

test('a decorated tree by day and at night: baubles, the star and fairy lights glowing; a trail of paw prints in the snow', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  const [sx, Y, sz] = await buildScene(page);
  await page.evaluate(([sx, Y, sz, BAUBLE, STAR, FAIRY_LIGHTS, WREATH, STOCKING, PAW_PRINTS, PRESENT, SNOW]) => {
    const v = window.__voxel;
    // baubles round the canopy's underside, the star on top, presents under the tree
    const under = [[-5, -5], [-1, -5], [-5, -1], [-1, -1], [-3, -5], [-5, -3], [-1, -3], [-3, -1]];
    under.forEach(([dx, dz], i) => v.setBlock(sx + dx, Y + 1, sz + dz, BAUBLE + (i % 3)));
    v.setBlock(sx - 3, Y + 4, sz - 3, STAR);
    v.setBlock(sx - 2, Y, sz - 2, PRESENT + 3); v.setBlock(sx - 4, Y, sz - 2, PRESENT); v.setBlock(sx - 2, Y, sz - 4, PRESENT + 1);
    // fairy lights along the top of the wall, a wreath and stockings under them
    for (let z = sz + 1; z <= sz + 5; z++) v.setBlock(sx - 5, Y + 3, z, FAIRY_LIGHTS, 1);
    v.setBlock(sx - 5, Y + 2, sz + 3, WREATH, 1);
    v.setBlock(sx - 5, Y + 1, sz + 2, STOCKING, 1); v.setBlock(sx - 5, Y + 1, sz + 4, STOCKING, 1);
    // a trail of paw prints across the snow (and snow on under the tree), heading off toward −x
    for (let x = sx - 1; x <= sx + 3; x++) for (let z = sz - 1; z <= sz + 1; z++) v.setBlock(x, Y - 1, z, SNOW);
    for (let x = sx - 1; x <= sx + 3; x++) v.setBlock(x, Y, sz + 4, PAW_PRINTS, 6);
    for (let z = sz - 1; z <= sz + 3; z++) v.setBlock(sx + 3, Y, z, PAW_PRINTS, 7);
  }, [sx, Y, sz, BAUBLE, STAR, FAIRY_LIGHTS, WREATH, STOCKING, PAW_PRINTS, PRESENT, SNOW]);
  await edited(page);

  // the whole scene from the east, by day and at night
  const overview = async () => { await stand(page, sx + 5.5, Y, sz + 1.5); await page.evaluate(() => window.__voxel.look(Math.PI / 2 - 0.12, -0.08)); await ticks(page, 2); };
  await overview();
  for (const [name, t] of [['day', NOON], ['night', MIDNIGHT]] as const) {
    await page.evaluate((t) => window.__voxel.setTime(t), t);
    await ticks(page, 2);
    await viewShot(page, `decorations-${name}`);
  }
  // the paw-print trail, looking down at it
  await page.evaluate((t) => window.__voxel.setTime(t), NOON);
  await stand(page, sx + 4.5, Y, sz + 6.5);
  await aimAt(page, [sx + 1.5, Y, sz + 3.5]);
  await ticks(page, 2);
  await viewShot(page, 'paw-prints');

  // the star and the fairy lights stay bright at night; the snow round them doesn't
  const LIGHTS_BOX = [0.4, 0.45, 0.6, 0.65];
  const glow = async (name: string, from: number[], at: number[], box = [0.48, 0.45, 0.52, 0.55]) => {
    await stand(page, from[0], from[1], from[2]);
    await aimAt(page, at);
    await capture(page, name, box);
  };
  for (const t of [NOON, MIDNIGHT]) {
    await page.evaluate((t) => window.__voxel.setTime(t), t);
    await ticks(page, 2);
    await glow(`star${t}`, [sx + 1.5, Y + 3, sz - 2.5], [sx - 2.5, Y + 4.6, sz - 2.5], [0.49, 0.47, 0.51, 0.53]);
    // below the top of the wall: no night sky (and its stars) in the box
    await glow(`lights${t}`, [sx - 3.5, Y, sz + 3.5], [sx - 5, Y + 3.5, sz + 3.5], LIGHTS_BOX);
    await glow(`snow${t}`, [sx + 1.5, Y, sz + 0.5], [sx + 0.5, Y, sz + 0.5]);
  }
  const star = [luma(await meanColor(page, `star${NOON}`)), luma(await meanColor(page, `star${MIDNIGHT}`))];
  const snow = [luma(await meanColor(page, `snow${NOON}`)), luma(await meanColor(page, `snow${MIDNIGHT}`))];
  expect(star[1]).toBeGreaterThan(star[0] * 0.85);
  expect(snow[1]).toBeLessThan(snow[0] * 0.7);
  // the bulbs shine at full brightness at midnight; the same view without them has nothing as bright
  expect(await brightest(page, `lights${MIDNIGHT}`)).toBeGreaterThan(200);
  await page.evaluate(([x, y, z]) => { for (let k = z + 1; k <= z + 5; k++) window.__voxel.setBlock(x, y, k, 0); }, [sx - 5, Y + 3, sz]);
  await edited(page);
  await glow('bare', [sx - 3.5, Y, sz + 3.5], [sx - 5, Y + 3.5, sz + 3.5], LIGHTS_BOX);
  expect(await brightest(page, 'bare')).toBeLessThan(150);
  expect(errors).toEqual([]);
});
