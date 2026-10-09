import { test, expect, devices, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { openGame, waitReady, play, stand, aimAt, tapToAct, block, ticks, until, settle, capture, meanColor, fingers, frameMs } from './game';

// block ids (src/blocks.ts)
const STONE = 3, SAND = 4, WATER = 10;

test.use({ ...devices['Pixel 7 landscape'] });

/** Save the whole screen as the player sees it (HUD and underwater tint included) as test-results/…/<name>.png, also in the report. */
async function screenshot(page: Page, name: string): Promise<void> {
  await ticks(page, 1);
  const png = await page.screenshot();
  writeFileSync(test.info().outputPath(`${name}.png`), png);
  await test.info().attach(name, { body: png, contentType: 'image/png' });
}
const luma = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The water at each cell: 'S' a source, 'F' falling, a level 1–7, '.' none */
const waterAt = (page: Page, cells: number[][]) => page.evaluate((cells) => cells.map(([x, y, z]) => {
  const v = window.__voxel;
  if (v.get(x, y, z) !== 10) return '.';
  const s = v.getState(x, y, z);
  return s & 8 ? 'F' : s & 7 || 'S';
}), cells);

/**
 * The flat beach by the sea nearest the player: sea at (x, z) (water at y 18 and 19), and sand at sea
 * level with nothing on it for 6 blocks inland (direction ax, az) and 3 to each side.
 */
const findShore = (page: Page) => page.evaluate(([WATER, SAND]) => {
  const v = window.__voxel, sx = Math.floor(v.P[0]), sz = Math.floor(v.P[2]);
  const beach = (x: number, z: number) => v.get(x, 19, z) === SAND && v.get(x, 20, z) === 0;
  for (let r = 1; r < 80; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const x = sx + dx, z = sz + dz;
    if (v.get(x, 19, z) !== WATER || v.get(x, 18, z) !== WATER) continue;
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let ok = true;
      for (let i = 1; i <= 6 && ok; i++) for (let s = -3; s <= 3 && ok; s++) ok = beach(x + ax * i + az * s, z + az * i + ax * s);
      if (ok) return { x, z, ax, az };
    }
  }
  return null;
}, [WATER, SAND]);

test('a channel dug from the sea fills with water', async ({ page }) => {
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  const shore = await findShore(page);
  expect(shore).not.toBeNull();
  const { x, z, ax, az } = shore!;
  /** Block i along the channel (0: the sea), `side` blocks off it */
  const cell = (i: number, side = 0) => [x + ax * i + az * side, 19, z + az * i + ax * side];

  // on the beach beside where the channel goes, in break mode: dig its 5 blocks with taps, from the sea inland
  const at = cell(3, 2);
  await stand(page, at[0] + 0.5, 20, at[2] + 0.5);
  await settle(page);
  expect(await page.evaluate(() => window.__voxel.mode)).toBe('break');
  for (let i = 1; i <= 5; i++) {
    const c = cell(i);
    expect((await aimAt(page, [c[0] + 0.5, 19.9, c[2] + 0.5]))?.slice(0, 3), `aiming at channel block ${i}`).toEqual(c);
    await tapToAct(page);
    expect((await block(page, c))[0]).not.toBe(SAND);
  }
  // the sea runs in, one level weaker per block from it, and stops where the digging stopped
  const channel = [1, 2, 3, 4, 5].map((i) => cell(i));
  await until(page, async () => (await waterAt(page, channel)).join() === '1,2,3,4,5', 400);
  expect(await waterAt(page, [cell(0), cell(6), cell(3, 1)])).toEqual(['S', '.', '.']);
  await aimAt(page, cell(0).map((v) => v + 0.5));                 // look along it to the sea
  await screenshot(page, 'channel');
  expect(errors).toEqual([]);
});

test('swims across a lake and climbs out, with nothing but touches', async ({ page }) => {
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  // a lake 10 long, 5 wide and 3 deep in a stone platform up in the air, its surface a block below the ground
  const [sx, Y, sz] = await page.evaluate(([STONE, WATER]) => {
    const v = window.__voxel, sx = Math.floor(v.P[0]), sz = Math.floor(v.P[2]), Y = 44;
    for (let x = sx - 4; x <= sx + 20; x++) for (let z = sz - 4; z <= sz + 4; z++) for (let y = Y - 5; y < Y; y++) v.setBlock(x, y, z, STONE);
    for (let x = sx + 3; x <= sx + 12; x++) for (let z = sz - 2; z <= sz + 2; z++) {
      v.setBlock(x, Y - 1, z, 0);
      for (let y = Y - 4; y <= Y - 2; y++) v.setBlock(x, y, z, WATER);
    }
    return [sx, Y, sz];
  }, [STONE, WATER]);
  await stand(page, sx + 0.5, Y, sz + 0.5);
  await page.evaluate(() => window.__voxel.look(-Math.PI / 2, -0.15));      // facing the lake (+x)
  await until(page, () => page.evaluate(() => window.__voxel.stream().edits === 0));

  const f = await fingers(page), { height } = page.viewportSize()!, jump = (await page.locator('#jump').boundingBox())!;
  // walk in: the joystick pushed forward
  await f.down(1, 110, height - 110);
  await f.move(1, 110, height - 166);
  await until(page, async () => (await page.evaluate(() => window.__voxel.wet)) >= 2, 300);
  // swim across with JUMP held too (the head stays above water), and climb out on the far side
  await f.down(2, jump.x + jump.width / 2, jump.y + jump.height / 2);
  let swimming = 0, headUnder = 0;
  await until(page, async () => {
    const [px, wet] = await page.evaluate(() => [window.__voxel.P[0], window.__voxel.wet]);
    if (wet >= 2) swimming++;
    if (wet === 3) headUnder++;
    return px > sx + 13.5 && wet === 0;
  }, 900);
  await f.close();
  await ticks(page, 60, 10);
  const [px, py, onGround] = await page.evaluate(() => [window.__voxel.P[0], window.__voxel.P[1], window.__voxel.onGround]);
  expect(px).toBeGreaterThan(sx + 13.3);
  expect(py).toBeCloseTo(Y, 2);
  expect(onGround).toBe(true);
  expect(swimming).toBeGreaterThan(60);                      // a crossing, not a hop
  expect(headUnder).toBeLessThan(swimming / 2);
  expect(errors).toEqual([]);
});

test('under water: blue, the surface bright overhead, darker deep down and at night', async ({ page }) => {
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  // deep sea near the spawn
  const sea = await page.evaluate((WATER) => {
    const v = window.__voxel, sx = Math.floor(v.P[0]), sz = Math.floor(v.P[2]);
    for (let r = 1; r < 90; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      let bed = 19;
      while (bed > 0 && v.get(sx + dx, bed, sz + dz) === WATER) bed--;
      if (bed <= 8 && v.get(sx + dx, 19, sz + dz) === WATER) return [sx + dx, bed, sz + dz];
    }
    return null;
  }, WATER);
  expect(sea).not.toBeNull();
  const [x, bed, z] = sea!;
  const view = async (y: number, t: number, name: string) => {
    await page.evaluate((t) => window.__voxel.setTime(t), t);
    await stand(page, x + 0.5, y, z + 0.5);
    await page.evaluate(() => window.__voxel.look(0.4, 0.55));          // looking up, toward the surface
    await capture(page, name + '-top', [0, 0, 1, 0.35]);
    await capture(page, name + '-low', [0, 0.65, 1, 1]);
    const top = await meanColor(page, name + '-top'), low = await meanColor(page, name + '-low');
    await screenshot(page, name);
    return { top, low, all: top.map((v, i) => (v + low[i]) / 2) };
  };
  await stand(page, x + 0.5, 15, z + 0.5);
  await settle(page);
  const day = await view(15, 0.5, 'underwater-day');
  const deep = await view(bed + 1, 0.5, 'underwater-deep');
  const night = await view(15, 0, 'underwater-night');
  expect(await page.evaluate(() => window.__voxel.wet)).toBe(3);
  expect(day.all[2]).toBeGreaterThan(day.all[0] + 40);       // blue
  expect(luma(day.top)).toBeGreaterThan(luma(day.low) * 1.3); // the surface, lit, overhead
  expect(luma(deep.all)).toBeLessThan(luma(day.all) * 0.8);
  expect(luma(night.all)).toBeLessThan(luma(day.all) * 0.5);
  expect(errors).toEqual([]);
});

test('a big sea in view: drawing the water costs a fraction of the frame', async ({ page }) => {
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  const shore = await findShore(page);
  expect(shore).not.toBeNull();
  const { x, z, ax, az } = shore!;
  // on the beach, looking out to sea
  await stand(page, x + ax * 2 + 0.5, 20, z + az * 2 + 0.5);
  await page.evaluate(([ax, az]) => window.__voxel.look(Math.atan2(ax, az), -0.12), [ax, az]);
  await settle(page);
  const passes = await page.evaluate(() => window.__voxel.stream().passes);
  expect(passes[2]).toBeGreaterThan(20);                     // chunks with water
  /** Median frame time (ms) with the water drawn or not */
  const time = async (on: boolean) => {
    await page.evaluate((on) => window.__voxel.showWater(on), on);
    return frameMs(page, 20);
  };
  await time(true); await time(false);                       // warm up
  const withWater: number[] = [], without: number[] = [];
  for (let i = 0; i < 3; i++) {                              // taking turns evens out any drift
    withWater.push(await time(true));
    without.push(await time(false));
  }
  await page.evaluate(() => window.__voxel.showWater(true));
  const median = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
  const w = median(withWater), n = median(without);
  test.info().annotations.push({ type: 'frame time looking out to sea', description: `water drawn ${w.toFixed(1)} ms, not drawn ${n.toFixed(1)} ms` });
  console.log(`frame time looking out to sea: water drawn ${withWater.map((v) => v.toFixed(1))} ms, not drawn ${without.map((v) => v.toFixed(1))} ms`);
  expect(w).toBeLessThan(n * 1.35 + 3);
  await screenshot(page, 'sea');
  expect(errors).toEqual([]);
});

test('water left flowing keeps flowing after the world is saved and loaded again', async ({ page }) => {
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  // a flat stone platform up in the air with a source in the middle
  const [sx, Y, sz] = await page.evaluate(([STONE, WATER]) => {
    const v = window.__voxel, sx = Math.floor(v.P[0]), sz = Math.floor(v.P[2]), Y = 44;
    for (let x = sx - 10; x <= sx + 10; x++) for (let z = sz - 10; z <= sz + 10; z++) v.setBlock(x, Y - 1, z, STONE);
    v.P[0] = sx + 0.5; v.P[1] = Y; v.P[2] = sz - 8.5; v.V.fill(0);
    v.setBlock(sx, Y, sz, WATER);
    return [sx, Y, sz];
  }, [STONE, WATER]);
  const ring = (d: number) => [[sx + d, Y, sz], [sx - d, Y, sz], [sx, Y, sz + d]];
  // two ticks in, it has spread 2 blocks: save right then
  await until(page, async () => (await waterAt(page, ring(2))).join() === '2,2,2', 200);
  expect(await waterAt(page, ring(3))).toEqual(['.', '.', '.']);
  expect((await page.evaluate(() => window.__voxel.water())).pending).toBeGreaterThan(0);
  await page.evaluate(() => window.__voxel.save());
  await page.reload();
  await waitReady(page);
  await play(page);
  // it carries on spreading where it left off, out to its full 7 blocks
  await until(page, async () => (await waterAt(page, ring(7))).join() === '7,7,7', 400);
  expect(await waterAt(page, ring(8))).toEqual(['.', '.', '.']);
  expect(errors).toEqual([]);
});
