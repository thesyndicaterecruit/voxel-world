import { test, expect, devices, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { openGame, play, ticks, until, settle } from './game';

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

/** Face the way with the most of the biome the player is in ahead (8 directions, 8–40 blocks out). */
const faceBiome = (page: Page) => page.evaluate(() => {
  const v = window.__voxel, here = v.biome(), [x, , z] = v.P;
  let best = 0, score = -1;
  for (let k = 0; k < 8; k++) {
    const yaw = (k / 8) * Math.PI * 2, dx = -Math.sin(yaw), dz = -Math.cos(yaw);   // yaw 0 looks toward −z
    let n = 0;
    for (let d = 8; d <= 40; d += 4) if (v.biomeAt(x + dx * d, z + dz * d) === here) n++;
    if (n > score) { score = n; best = yaw; }
  }
  return best;
});

test('the menu teleports to every biome; a picture of each', async ({ page }) => {
  test.setTimeout(420_000);
  const errors = await openGame(page, '?seed=4242');
  await play(page);
  const names = await page.evaluate(() => window.__voxel.biomes);
  expect(names.length).toBe(14);

  // by touch, through the menu: Menu → Teleport → Desert Dunes
  await page.tap('#menuBtn');
  await page.tap('[data-act="tp"]');
  await expect(page.locator('#tpList .sbtn')).toHaveCount(14);
  const desert = names.indexOf('Desert Dunes');
  await page.tap(`[data-act="tp:${desert}"]`);
  await expect(page.locator('#menu')).toBeHidden();
  await until(page, () => page.evaluate(() => window.__voxel.biome() === 'Desert Dunes'), 10);
  await expect(page.locator('#toast')).toContainText('Desert Dunes');

  // then every biome in turn: there, standing on its ground (or on its sea), the view from a little above
  const sea = await page.evaluate(() => window.__voxel.seaLevel);
  for (let id = 0; id < names.length; id++) {
    const d = await page.evaluate((id) => window.__voxel.teleport(id), id);
    expect(d, names[id]).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => window.__voxel.biome())).toBe(names[id]);
    const [x, y, z] = await page.evaluate(() => window.__voxel.P.slice());
    expect(y, `${names[id]}: on its ground or its sea`).toBeGreaterThanOrEqual(sea);
    await settle(page);
    const yaw = await faceBiome(page);
    // hold the camera a few blocks up while the picture is taken
    await page.evaluate(([x, y, z, yaw]) => {
      const v = window.__voxel;
      v.P[0] = x; v.P[1] = y + 5; v.P[2] = z; v.V.fill(0);
      v.look(yaw, -0.2);
    }, [x, Math.max(y, sea), z, yaw]);
    await screenshot(page, `${String(id).padStart(2, '0')}-${names[id].toLowerCase().replace(/ /g, '-')}`);
    await page.evaluate(([x, y, z]) => { const v = window.__voxel; v.P[0] = x; v.P[1] = y; v.P[2] = z; v.V.fill(0); }, [x, y, z]);
  }
  const s = await page.evaluate(() => window.__voxel.stream());
  test.info().annotations.push({ type: 'chunk generation in the worker', description: `${s.generated} chunks: ${s.genMs} ms on average, ${s.genMax} ms at most` });
  console.log(`chunk generation: ${s.generated} chunks, ${s.genMs} ms on average, ${s.genMax} ms at most`);
  expect(errors).toEqual([]);
});
