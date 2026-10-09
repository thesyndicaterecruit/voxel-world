import { test, expect, devices, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { openGame, play, stand, ticks, until, capture, meanColor, holdJoystick, frameMs } from './game';

// block ids (src/blocks.ts)
const STONE = 3, PLANKS = 6, GLASS = 11, TORCH = 12;
// times of day (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset)
const MIDDAY = 0.5, SUNSET = 0.745, MIDNIGHT = 0;

test.use({ ...devices['Pixel 7 landscape'] });

/**
 * A stone platform up in the air at the spawn point with a planks hut on it, open toward +x, two
 * torches on its back wall and one standing outside. The player stands east of it, facing west (where
 * the sun sets), with the hut in the middle of the view. Returns [sx, Y, sz]: the spawn column and
 * the height of the platform's top.
 */
async function buildHut(page: Page): Promise<number[]> {
  const s = await page.evaluate(([STONE, PLANKS, GLASS, TORCH]) => {
    const v = window.__voxel, sx = Math.floor(v.P[0]), sz = Math.floor(v.P[2]), Y = 42;
    for (let x = sx - 11; x <= sx + 3; x++) for (let z = sz - 6; z <= sz + 6; z++) v.setBlock(x, Y - 1, z, STONE);
    for (let x = sx - 10; x <= sx - 6; x++) for (let z = sz - 3; z <= sz + 3; z++) for (let y = Y; y <= Y + 4; y++) {
      if (x === sx - 10 || z === sz - 3 || z === sz + 3 || y === Y + 4) v.setBlock(x, y, z, PLANKS);
    }
    v.setBlock(sx - 10, Y + 2, sz, GLASS);                    // a window in the back wall
    v.setBlock(sx - 9, Y + 2, sz - 2, TORCH, 1);              // on the back wall
    v.setBlock(sx - 9, Y + 2, sz + 2, TORCH, 1);
    v.setBlock(sx - 3, Y, sz + 4, TORCH, 0);                  // outside, left of the view
    return [sx, Y, sz];
  }, [STONE, PLANKS, GLASS, TORCH]);
  await goToStart(page, s);
  // every edit is relit and re-meshed
  await until(page, () => page.evaluate(() => window.__voxel.stream().edits === 0));
  await ticks(page, 4, 15);
  return s;
}

/** Stand east of the hut, facing it. */
async function goToStart(page: Page, [sx, Y, sz]: number[]): Promise<void> {
  await stand(page, sx + 2.5, Y, sz + 0.5);
  await page.evaluate(() => window.__voxel.look(Math.PI / 2, -0.2));
}

/** Render a frame and save the whole 3D view as test-results/…/<name>.png, also shown in the HTML report. */
async function screenshot(page: Page, name: string): Promise<void> {
  const url = await page.evaluate(() => { window.__tick(1); return document.querySelector('canvas')!.toDataURL('image/png'); });
  const png = Buffer.from(url.split(',')[1], 'base64');
  writeFileSync(test.info().outputPath(`${name}.png`), png);
  await test.info().attach(name, { body: png, contentType: 'image/png' });
}

const luma = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('the light follows the time of day, and torches light up the night', async ({ page }) => {
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  const [sx, Y, sz] = await buildHut(page);
  // the edits were lit incrementally; a fresh lighting of the chunks around gives the same
  expect(await page.evaluate(([sx, sz]) => {
    let bad = 0;
    for (let cz = (sz - 7) >> 4; cz <= (sz + 7) >> 4; cz++) for (let cx = (sx - 12) >> 4; cx <= (sx + 4) >> 4; cx++) bad += window.__voxel.verifyLight(cx, cz);
    return bad;
  }, [sx, sz])).toBe(0);
  expect(await page.evaluate(([x, y, z]) => window.__voxel.light(x, y, z)[1], [sx - 9, Y + 2, sz - 2])).toBe(14);

  // midday, sunset, midnight: darker each time, the sunset warmest
  const color: Record<string, number[]> = {};
  for (const [name, t] of [['midday', MIDDAY], ['sunset', SUNSET], ['midnight', MIDNIGHT]] as const) {
    await page.evaluate((t) => window.__voxel.setTime(t), t);
    await ticks(page, 2);
    await screenshot(page, name);
    await capture(page, name, [0, 0, 1, 1]);
    color[name] = await meanColor(page, name);
  }
  expect(luma(color.midday)).toBeGreaterThan(luma(color.sunset) * 1.2);
  expect(luma(color.sunset)).toBeGreaterThan(luma(color.midnight) * 1.2);
  expect(color.sunset[0] - color.sunset[2]).toBeGreaterThan(color.midday[0] - color.midday[2] + 20);

  // at midnight the torches light the inside of the hut, warm; without them it's dim moonlight
  const inside = [0.42, 0.2, 0.58, 0.45];
  await capture(page, 'torches', inside);
  await page.evaluate(([sx, y, sz]) => { window.__voxel.setBlock(sx - 9, y, sz - 2, 0); window.__voxel.setBlock(sx - 9, y, sz + 2, 0); }, [sx, Y + 2, sz]);
  await until(page, () => page.evaluate(() => window.__voxel.stream().edits === 0));
  await ticks(page, 2);
  await screenshot(page, 'midnight-no-torches');
  await capture(page, 'moonlight', inside);
  const lit = await meanColor(page, 'torches'), dark = await meanColor(page, 'moonlight');
  expect(luma(lit)).toBeGreaterThan(luma(dark) * 1.5);
  expect(lit[0] / lit[2]).toBeGreaterThan((dark[0] / dark[2]) * 1.4);
  expect(await page.evaluate(([x, y, z]) => window.__voxel.light(x, y, z)[1], [sx - 9, Y + 2, sz - 2])).toBe(0);
  expect(errors).toEqual([]);
});

test('walking at night takes no longer a frame than by day, and nothing is re-meshed', async ({ page }) => {
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  const start = await buildHut(page);
  const [sx, , sz] = start;
  // the rest of the view distance streams in first: the same chunk counts 10 frames running
  let last = '', same = 0;
  await until(page, async () => {
    const s = await page.evaluate(() => { const s = window.__voxel.stream(); return [s.loaded, s.lit, s.meshed, s.queued].join(); });
    same = s === last ? same + 1 : 0;
    last = s;
    return same >= 10;
  }, 1000);
  const versions = () => page.evaluate(([sx, sz]) => {
    const out: number[] = [];
    for (let cz = (sz >> 4) - 1; cz <= (sz >> 4) + 1; cz++) for (let cx = (sx >> 4) - 1; cx <= (sx >> 4) + 1; cx++) out.push(window.__voxel.chunk(cx, cz).meshed);
    return out;
  }, [sx, sz]);
  const before = await versions();

  /** Walk toward the hut for n frames at time of day t; the median real time of a frame, in ms */
  const walk = async (t: number, n: number) => {
    await goToStart(page, start);
    await page.evaluate((t) => window.__voxel.setTime(t), t);
    const release = await holdJoystick(page, 0, -56);
    const ms = await frameMs(page, n);
    await release();
    expect(await page.evaluate(() => window.__voxel.P[0]), 'walked toward the hut').toBeLessThan(sx + 2.2);
    return ms;
  };
  await walk(MIDDAY, 10);                                     // warm up
  await walk(MIDNIGHT, 10);
  const day: number[] = [], night: number[] = [];
  for (let i = 0; i < 3; i++) {                              // taking turns evens out any drift
    day.push(await walk(MIDDAY, 20));
    night.push(await walk(MIDNIGHT, 20));
  }
  const median = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
  const d = median(day), n = median(night);
  test.info().annotations.push({ type: 'frame time while walking', description: `day ${d.toFixed(2)} ms, night ${n.toFixed(2)} ms` });
  console.log(`frame time while walking: day ${day.map((v) => v.toFixed(2))} ms, night ${night.map((v) => v.toFixed(2))} ms`);
  expect(n).toBeLessThan(d * 1.3 + 2);
  // the time of day is uniforms only: no chunk was meshed again
  expect(await versions()).toEqual(before);
  expect(errors).toEqual([]);
});
