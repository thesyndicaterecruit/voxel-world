import { test, expect, devices, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { openGame, waitReady, play, ticks, until, settle, airY, stand, capture, changed, frameMs } from './game';

// block ids (src/blocks.ts)
const STONE = 3, GLASS = 11;
// times of day (0 midnight, 0.5 noon)
const DAY = 0.42, MIDNIGHT = 0;

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

const snow = (page: Page) => page.evaluate(() => window.__voxel.snow());
const biome = (page: Page, name: string) => page.evaluate((name) => window.__voxel.biomes.indexOf(name), name);
/** Run frames until the snowfall has eased to `amount` (it takes 2 s to set in or stop) */
const snowTo = (page: Page, amount: number) => until(page, () => page.evaluate((a) => window.__voxel.snow().amount === a, amount), 300);

/** Capture `box` of the view with the snow drawn and without it, at the same moment: the share of pixels the flakes change */
async function flakes(page: Page, name: string, box: number[], place: () => Promise<unknown>): Promise<number> {
  await page.evaluate(() => window.__voxel.showSnow(false));
  await place();
  await capture(page, `${name}-without`, box);
  await page.evaluate(() => window.__voxel.showSnow(true));
  await place();
  await capture(page, name, box);
  return changed(page, name, `${name}-without`);
}

/** Mean brightness (0–255) of the pixels the flakes change: how bright the snow is */
const flakeLuma = (page: Page, name: string) => page.evaluate((name) => {
  const A = window.__shots[name], B = window.__shots[`${name}-without`];
  let sum = 0, n = 0;
  for (let i = 0; i < A.length; i += 4) {
    if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) <= 24) continue;
    sum += 0.2126 * A[i] + 0.7152 * A[i + 1] + 0.0722 * A[i + 2];
    n++;
  }
  return n ? sum / n : 0;
}, name);

test('the menu sets the snow: Auto snows in snowy biomes only; the setting is kept', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  // Auto by default, and the start island (meadow and forest) has no snow
  expect(await snow(page)).toMatchObject({ setting: 'auto', here: 0, amount: 0, flakes: 0, visible: false });

  // by touch: Menu → Snow: − Off, + + On; it snows on the start island too
  await page.tap('#menuBtn');
  await expect(page.locator('#snow')).toHaveText('AUTO');
  await page.tap('[data-act="sn-"]');
  await expect(page.locator('#snow')).toHaveText('OFF');
  expect(await page.evaluate(() => localStorage.getItem('voxel-island.snow'))).toBe('off');
  await page.tap('[data-act="sn+"]');
  await page.tap('[data-act="sn+"]');
  await expect(page.locator('#snow')).toHaveText('ON');
  await page.tap('[data-act="resume"]');
  await expect(page.locator('#menu')).toBeHidden();
  await snowTo(page, 1);
  expect(await snow(page)).toMatchObject({ setting: 'on', flakes: 2400, visible: true });

  // back to Auto: snow in the Snowy Peaks, lighter in the Taiga, none in the desert
  await page.tap('#menuBtn');
  await page.tap('[data-act="sn-"]');
  await expect(page.locator('#snow')).toHaveText('AUTO');
  await page.tap('[data-act="resume"]');
  for (const [name, lo, hi] of [['Snowy Peaks', 0.99, 1], ['Taiga', 0.6, 0.75], ['Desert Dunes', 0, 0]] as const) {
    await page.evaluate((id) => window.__voxel.teleport(id), await biome(page, name));
    expect(await page.evaluate(() => window.__voxel.biome())).toBe(name);
    // how hard it snows here (worked out every few frames), and the snowfall eased to it
    await until(page, async () => { const s = await snow(page); return s.here >= lo && s.here <= hi && s.amount === s.here; }, 300);
    expect((await snow(page)).visible, name).toBe(hi > 0);
  }

  // the setting is kept: after a reload it's still what was chosen
  await page.tap('#menuBtn');
  await page.tap('[data-act="sn+"]');
  await page.reload();
  await waitReady(page);
  await expect(page.locator('#snow')).toHaveText('ON');
  expect((await snow(page)).setting).toBe('on');
  expect(errors).toEqual([]);
});

test('snow falls outdoors by day and at night, not under a glass roof or under water, and costs little', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  await page.evaluate(() => window.__voxel.setSnow('on'));

  // up in the air: a stone floor, a stone wall 8 blocks west, and a glass roof over it all; the player
  // stands under it looking at the wall, so everything in the middle of the view is under the roof
  const Y = await airY(page);
  const [sx, sz] = await page.evaluate(([Y, STONE, GLASS]) => {
    const v = window.__voxel, sx = Math.floor(v.P[0]), sz = Math.floor(v.P[2]);
    for (let x = sx - 8; x <= sx + 8; x++) for (let z = sz - 13; z <= sz + 13; z++) {
      v.setBlock(x, Y - 1, z, STONE);
      v.setBlock(x, Y + 4, z, GLASS);
      if (x === sx - 8) for (let y = Y; y < Y + 4; y++) v.setBlock(x, y, z, STONE);
    }
    return [sx, sz];
  }, [Y, STONE, GLASS]);
  await stand(page, sx + 0.5, Y, sz + 0.5);
  await until(page, () => page.evaluate(() => window.__voxel.stream().edits === 0));
  await snowTo(page, 1);
  const atWall = () => page.evaluate(([sx, Y, sz]) => {
    const v = window.__voxel;
    v.P[0] = sx + 0.5; v.P[1] = Y; v.P[2] = sz + 0.5; v.V.fill(0);
    v.look(Math.PI / 2, 0);
  }, [sx, Y, sz]);
  // the middle of the view: the wall and the floor (the glass roof above, and the sky through it, left out)
  const middle = [0.25, 0.32, 0.75, 0.9];
  expect(await page.evaluate(([sx, sz]) => window.__voxel.cover(sx, sz), [sx, sz])).toBe(Y + 5);   // on the glass
  expect(await flakes(page, 'glass-roof', middle, atWall), 'no snow under the glass roof').toBe(0);
  await screenshot(page, 'under-a-glass-roof');
  // without the roof it snows there
  await page.evaluate(([sx, Y, sz]) => {
    for (let x = sx - 8; x <= sx + 8; x++) for (let z = sz - 13; z <= sz + 13; z++) window.__voxel.setBlock(x, Y + 4, z, 0);
  }, [sx, Y, sz]);
  await until(page, () => page.evaluate(() => window.__voxel.stream().edits === 0));
  expect(await page.evaluate(([sx, sz]) => window.__voxel.cover(sx, sz), [sx, sz])).toBe(Y);       // on the floor
  expect(await flakes(page, 'no-roof', middle, atWall), 'snow once the roof is gone').toBeGreaterThan(0.0004);
  await screenshot(page, 'roof-taken-off');

  // under water: no snow; back out, it snows again
  await page.evaluate((id) => window.__voxel.teleport(id), await biome(page, 'Deep Ocean'));
  const sea = await page.evaluate(() => window.__voxel.seaLevel);
  const [ox, , oz] = await page.evaluate(() => window.__voxel.P.slice());
  await stand(page, ox, sea - 6, oz);
  expect(await snow(page)).toMatchObject({ amount: 1, visible: false, flakes: 0 });
  await stand(page, ox, sea + 3, oz);
  expect((await snow(page)).visible).toBe(true);

  // in the Snowy Peaks, from the air: snow by day and at night, lit by the time of day
  await page.evaluate((id) => window.__voxel.teleport(id), await biome(page, 'Snowy Peaks'));
  const [px, py, pz] = await page.evaluate(() => window.__voxel.P.slice());
  const view = () => page.evaluate(([x, y, z]) => {
    const v = window.__voxel, yaw = 0.8, bx = x + Math.sin(yaw) * 10, bz = z + Math.cos(yaw) * 10;
    v.P[0] = bx; v.P[1] = Math.max(y, v.world.topY(Math.floor(bx), Math.floor(bz)) + 1) + 6; v.P[2] = bz; v.V.fill(0);
    v.look(yaw, -0.25);
  }, [px, py, pz]);
  await view();
  await settle(page);
  const whole = [0, 0, 1, 1], seen: Record<string, number> = {};
  for (const [name, t] of [['day', DAY], ['night', MIDNIGHT]] as const) {
    await page.evaluate((t) => window.__voxel.setTime(t), t);
    await view();
    await ticks(page, 2);
    expect(await flakes(page, name, whole, view), `snow shows by ${name}`).toBeGreaterThan(0.0004);
    seen[name] = await flakeLuma(page, name);
    await view();
    await screenshot(page, `snow-${name}`);
  }
  // white by day, dimmer (moonlit) at night
  expect(seen.day).toBeGreaterThan(seen.night * 1.5);
  expect(seen.night).toBeGreaterThan(30);

  // at night: a frame takes about as long with the snow as without it (taking turns, in this run)
  const timed = async (on: boolean, n: number) => {
    await page.evaluate((on) => window.__voxel.showSnow(on), on);
    await view();
    return frameMs(page, n);
  };
  await timed(true, 10);                                      // warm up
  await timed(false, 10);
  const withSnow: number[] = [], without: number[] = [];
  for (let i = 0; i < 3; i++) {
    withSnow.push(await timed(true, 20));
    without.push(await timed(false, 20));
  }
  const median = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
  const on = median(withSnow), off = median(without);
  test.info().annotations.push({ type: 'frame time at night', description: `snow ${on.toFixed(2)} ms, no snow ${off.toFixed(2)} ms` });
  console.log(`frame time at night: snow ${withSnow.map((v) => v.toFixed(2))} ms, no snow ${without.map((v) => v.toFixed(2))} ms`);
  expect(on).toBeLessThan(off * 1.3 + 2);
  expect(errors).toEqual([]);
});
