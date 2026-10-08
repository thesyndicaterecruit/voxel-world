import { test, expect, devices, type Page } from '@playwright/test';
import { openGame, play, stand, aimAt, tapToAct, block, ticks, until, capture, changed } from './game';

// block ids (src/blocks.ts)
const STONE = 3, PLANKS = 6, LEAVES = 7, BRICK = 8, GLASS = 11, TORCH = 12;

test.use({ ...devices['Pixel 7 landscape'] });

/**
 * Clear a stage in front of the spawn point: a stone floor, a brick wall 7 blocks ahead, a row of
 * glass (left) and of leaves (right) 4 blocks ahead, a stone block 2 ahead. Returns the spawn block.
 */
async function buildStage(page: Page): Promise<number[]> {
  return page.evaluate(([STONE, BRICK, GLASS, LEAVES]) => {
    const v = window.__voxel, sx = Math.floor(v.P[0]), sy = Math.floor(v.P[1]), sz = Math.floor(v.P[2]);
    for (let x = sx - 5; x <= sx + 5; x++) for (let z = sz - 8; z <= sz + 2; z++) {
      v.setBlock(x, sy - 1, z, STONE);
      for (let y = sy; y < sy + 9; y++) v.setBlock(x, y, z, 0);
    }
    for (let x = sx - 5; x <= sx + 5; x++) for (let y = sy; y < sy + 7; y++) v.setBlock(x, y, sz - 7, BRICK);
    for (let x = sx - 4; x <= sx - 1; x++) for (let y = sy; y < sy + 3; y++) v.setBlock(x, y, sz - 4, GLASS);
    for (let x = sx + 1; x <= sx + 3; x++) for (let y = sy; y < sy + 3; y++) v.setBlock(x, y, sz - 4, LEAVES);
    v.setBlock(sx, sy, sz - 2, STONE);
    return [sx, sy, sz];
  }, [STONE, BRICK, GLASS, LEAVES]);
}

test('glass and leaves show what is behind them; with Fancy leaves off, leaves are solid', async ({ page }) => {
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  const [sx, sy, sz] = await buildStage(page);
  /** Share of the view that changes when the wall behind turns from brick to planks */
  const seeThrough = async () => {
    for (const [name, id] of [['brick', BRICK], ['planks', PLANKS], ['', BRICK]] as const) {
      await page.evaluate(([sx, sy, sz, id]) => {
        for (let x = sx - 5; x <= sx + 5; x++) for (let y = sy; y < sy + 7; y++) window.__voxel.setBlock(x, y, sz - 7, id);
      }, [sx, sy, sz, id]);
      await ticks(page, 8, 20);
      if (name) await capture(page, name);
    }
    return changed(page, 'brick', 'planks');
  };

  // face the glass from 1.3 blocks away: most of what's behind shows through
  await stand(page, sx - 2, sy, sz - 1.7);
  await aimAt(page, [sx - 2, sy + 1.62, sz - 3.5]);
  expect(await seeThrough()).toBeGreaterThan(0.4);

  // leaves: the wall shows through the gaps
  await stand(page, sx + 2.5, sy, sz - 1.7);
  await aimAt(page, [sx + 2.5, sy + 1.62, sz - 3.5]);
  expect(await seeThrough()).toBeGreaterThan(0.1);

  // Fancy leaves off: leaves become opaque cubes in the opaque pass
  const tris = () => page.evaluate(([cx, cz]) => window.__voxel.chunk(cx, cz).tris, [(sx + 2) >> 4, (sz - 4) >> 4]);
  const fancy = await tris();
  await page.evaluate(() => window.__voxel.setFancyLeaves(false));
  await until(page, async () => (await tris())[1] < fancy[1]);
  expect(await seeThrough()).toBeLessThan(0.01);
  expect(errors).toEqual([]);
});

test('torches stand on blocks and lean out of their sides, and pop off when their support breaks', async ({ page }) => {
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  const [sx, sy, sz] = await buildStage(page);
  await page.evaluate(([x, y, z]) => { window.__voxel.setBlock(x, y, z, 6); }, [sx - 3, sy + 2, sz]);   // planks to look up at

  // pick the torch from the hotbar with a tap: place mode
  await page.locator('.slot').nth(9).tap();
  await ticks(page, 2);
  await expect(page.locator('.slot').nth(9)).toHaveClass(/sel/);
  expect(await page.evaluate(() => window.__voxel.mode)).toBe('place');

  const X = sx, Y = sy, Z = sz - 2;                    // the stone block
  const place = async (from: number[], at: number[], cell: number[], want: number[]) => {
    await stand(page, from[0], sy, from[1]);
    await aimAt(page, at);
    await tapToAct(page);
    expect(await block(page, cell), `torch at ${cell}`).toEqual(want);
  };
  await place([sx + 0.5, sz + 1.5], [X + 0.5, Y + 1, Z + 0.5], [X, Y + 1, Z], [TORCH, 0]);   // on top
  await place([sx + 2.5, sz - 1.5], [X + 1, Y + 0.5, Z + 0.5], [X + 1, Y, Z], [TORCH, 1]);   // east side
  await place([sx - 1.5, sz - 1.5], [X, Y + 0.5, Z + 0.5], [X - 1, Y, Z], [TORCH, 2]);       // west side
  await place([sx + 0.5, sz + 1.5], [X + 0.5, Y + 0.3, Z + 1], [X, Y, Z + 1], [TORCH, 3]);   // south side
  await place([sx + 0.5, sz - 3.5], [X + 0.5, Y + 0.5, Z], [X, Y, Z - 1], [TORCH, 4]);       // north side
  // two on the brick wall, next to each other
  await place([sx - 1.5, sz - 4.5], [sx - 1.5, sy + 4.5, sz - 6], [sx - 2, sy + 4, sz - 6], [TORCH, 3]);
  await place([sx - 1.5, sz - 4.5], [sx - 2.5, sy + 3.5, sz - 6], [sx - 3, sy + 3, sz - 6], [TORCH, 3]);

  // not under a block (with a hint), and nothing builds against a torch
  await stand(page, sx - 2.5, sy, sz + 1.5);
  await aimAt(page, [sx - 2.5, sy + 2, sz + 0.5]);
  await tapToAct(page);
  expect(await block(page, [sx - 3, sy + 1, sz])).toEqual([0, 0]);
  await expect(page.locator('#toast')).toHaveText(/top of blocks or on walls/);
  const nearTorch = () => page.evaluate(([x, y, z]) => {
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) out.push(window.__voxel.get(x + dx, y + dy, z + dz));
    return out;
  }, [X, Y + 1, Z]);
  const before = await nearTorch();
  await stand(page, sx + 0.5, sy, sz + 1.5);
  expect((await aimAt(page, [X + 0.5, Y + 1.4, Z + 0.5]))?.[6]).toBe(TORCH);
  await tapToAct(page);
  expect(await nearTorch()).toEqual(before);
  // a torch is a small target: a ray just past its stick reaches what's behind
  expect((await aimAt(page, [X + 0.1, Y + 1.5, Z + 0.1]))?.[6]).not.toBe(TORCH);

  // break mode: the stone takes its five torches with it
  await page.locator('#mode').tap();
  await ticks(page, 2);
  expect(await page.evaluate(() => window.__voxel.mode)).toBe('break');
  await stand(page, sx + 2.5, sy, sz + 1.5);
  expect(await aimAt(page, [X + 1, Y + 0.85, Z + 0.95])).toEqual([X, Y, Z, 1, 0, 0, STONE]);
  await tapToAct(page);
  for (const c of [[X, Y, Z], [X, Y + 1, Z], [X + 1, Y, Z], [X - 1, Y, Z], [X, Y, Z + 1], [X, Y, Z - 1]]) {
    expect(await block(page, c), `${c} after breaking the stone`).toEqual([0, 0]);
  }
  // breaking a brick drops the torch on it, not the one on the next brick
  await stand(page, sx - 1.5, sy, sz - 4.5);
  expect(await aimAt(page, [sx - 1.9, sy + 4.9, sz - 6])).toEqual([sx - 2, sy + 4, sz - 7, 0, 0, 1, BRICK]);
  await tapToAct(page);
  expect(await block(page, [sx - 2, sy + 4, sz - 6])).toEqual([0, 0]);
  expect(await block(page, [sx - 3, sy + 3, sz - 6])).toEqual([TORCH, 3]);
  expect(errors).toEqual([]);
});
