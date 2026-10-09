import { test, expect, devices } from '@playwright/test';
import { CS, OLD_H, CI } from '../src/config';
import { rleEncode } from '../src/rle';
import { SAVE_VERSION } from '../src/saves';
import { generateChunk } from '../src/gen1';
import { openGame, play, ticks, block, waitReady } from './game';

test.use({ ...devices['Pixel 7 landscape'] });

const STONE = 3, GRASS = 1, BRICK = 8, TORCH = 12;

/** Read every record of a store of the save database. */
const dump = (store: string) => `new Promise((res) => { const r = indexedDB.open('voxel-island'); r.onsuccess = () => {
  const tx = r.result.transaction('${store}'), s = tx.objectStore('${store}'), k = s.getAllKeys(), v = s.getAll();
  tx.oncomplete = () => { r.result.close(); res(k.result.map((key, i) => [key, v.result[i]])); }; }; })`;

test('a world saved by save version 1 still loads, keeps its generator, and is saved in the current version with block state', async ({ page }) => {
  const errors = await openGame(page, '?seed=777');           // creates the database

  // what version 1 stored: a world record and one edited chunk (block ids only, run-length encoded, in
  // the 64-high world of then) — a flat platform with a brick pillar
  const data = new Uint8Array(CS * CS * OLD_H);
  for (let y = 0; y <= 20; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) data[CI(x, y, z)] = y < 20 ? STONE : GRASS;
  for (let y = 21; y <= 24; y++) data[CI(4, y, 6)] = BRICK;
  const world = {
    id: 'v1world', name: 'Old island', seed: 777, createdAt: 1757000000000, lastPlayed: Date.now() + 1e6, saveVersion: 1,
    player: { x: 262.5, y: 21, z: 264.5, yaw: 0.4, pitch: -0.2 }, slot: 7, mode: 'place',
  };
  await page.evaluate(([world, rle]) => new Promise<void>((res, rej) => {
    const r = indexedDB.open('voxel-island');
    r.onsuccess = () => {
      const tx = r.result.transaction(['worlds', 'chunks'], 'readwrite');
      tx.objectStore('worlds').put(world);
      tx.objectStore('chunks').put({ v: 1, rle: Uint8Array.from(rle) }, 'v1world:16,16');
      tx.oncomplete = () => { r.result.close(); res(); };
      tx.onerror = () => rej(tx.error);
    };
  }), [world, [...rleEncode(data)]] as const);

  await page.goto('?world=v1world');
  await waitReady(page);
  await expect(page.locator('.wrow.sel')).toContainText('Old island');
  await play(page);
  const P = await page.evaluate(() => window.__voxel.P.slice());
  expect([P[0], P[2]]).toEqual([262.5, 264.5]);
  for (let y = 21; y <= 24; y++) expect(await block(page, [260, y, 262])).toEqual([BRICK, 0]);
  await expect(page.locator('.slot').nth(7)).toHaveClass(/sel/);
  expect(await page.evaluate(() => window.__voxel.mode)).toBe('place');
  // it was made by the first generator, and its unexplored chunks still come from it: the sea at 20,
  // the same ground next to the saved chunk as ever, air above the old top of the world
  expect(await page.evaluate(() => [window.__voxel.generator, window.__voxel.seaLevel])).toEqual([1, 20]);
  const next = generateChunk(777, 17, 16);
  for (const [x, y, z] of [[3, 0, 3], [5, 18, 9], [8, 19, 2], [12, 22, 12], [0, 30, 15], [7, 70, 7]]) {
    expect(await block(page, [17 * CS + x, y, 16 * CS + z]), `block ${x},${y},${z} of chunk 17,16`).toEqual([next[CI(x, y, z)], 0]);
  }

  // a torch on the pillar (facing +x), then save: the records are rewritten in the current version, with block state
  await page.evaluate(() => window.__voxel.setBlock(261, 23, 262, 12, 1));
  await page.evaluate(() => window.__voxel.save());
  const worlds = await page.evaluate(dump('worlds')) as [string, { saveVersion: number; generatorVersion: number }][];
  const chunks = await page.evaluate(dump('chunks')) as [string, { v: number; srle?: unknown }][];
  const rec = worlds.find(([k]) => k === 'v1world')![1];
  expect([rec.saveVersion, rec.generatorVersion]).toEqual([SAVE_VERSION, 1]);
  const saved = chunks.find(([k]) => k === 'v1world:16,16')![1];
  expect(saved.v).toBe(SAVE_VERSION);
  expect(saved.srle).toBeTruthy();

  await page.reload();
  await waitReady(page);
  await play(page);
  expect(await block(page, [261, 23, 262])).toEqual([TORCH, 1]);
  expect(await block(page, [260, 24, 262])).toEqual([BRICK, 0]);
  await ticks(page, 5);
  expect(errors).toEqual([]);
});
