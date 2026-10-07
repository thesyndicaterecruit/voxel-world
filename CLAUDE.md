# Voxel Island

A small, mobile-first voxel sandbox (think pocket Minecraft) built with Three.js, TypeScript and Vite.
A 32×32×40 island is generated from a seed; you walk around with an on-screen joystick, look by
dragging, and break/place 8 block types. All textures are painted procedurally at startup — there
are no image assets and no runtime network requests.

Every push is built and deployed to GitHub Pages by `.github/workflows/deploy.yml`:
https://thesyndicaterecruit.github.io/voxel-world/

## Commands

```sh
npm install
npm run dev        # dev server on the LAN (--host) — open the printed Network URL on a phone
npm run build      # tsc --noEmit + vite build → dist/
npm run preview    # serve dist/
npm run typecheck
```

There is no test suite yet. Verify changes by running the game (desktop: WASD/arrows, Shift sprint,
Space jump, mouse drag on the right half to look, click/F to act, Q/E switch mode, 1–8 pick block).

## Structure

```
index.html           Markup for the HUD and start screen; loads src/style.css and src/main.ts
src/
  main.ts            Boot: renderer, scene, camera, wiring of all modules, resize, frame loop, window.__voxel
  config.ts          World size, chunk size, sea level, player dimensions & physics constants, sky colours
  blocks.ts          Block ids, texture tile ids, block definitions (B), HOTBAR, rotatable tiles
  noise.ts           SEED (from ?seed=), hash2/hash3, mulberry PRNG, shared world `rand`, value noise, fbm
  textures.ts        Procedural 32×32 pixel-art tile painters → canvases, CanvasTextures, materials
  world.ts           Voxel storage (vox, I, get, solid, topY), setBlock + change listener, generateWorld, raycast
  meshing.ts         Per-chunk mesh building with face culling, baked face light, ambient occlusion; boxesGeometry
  environment.ts     Sky dome, sun, ocean, drifting clouds
  effects.ts         Target outline, placement ghost, block-break particles
  player.ts          Player state (P, V, yaw/pitch), AABB collision, movement physics, auto-jump, aim()
  interact.ts        Break/place logic (act) and target highlighting (updateTarget)
  input.ts           Touch joystick / look / buttons, mouse + keyboard fallback, gesture blocking
  ui.ts              HUD DOM: toast, mode button, hotbar, fullscreen, start screen, error display
  style.css          All styles
.github/workflows/deploy.yml   Build + deploy to GitHub Pages on every push
```

Data flow per frame (`main.ts` → `frame`): `readControls()` → `player.update()` → camera →
`mesher.flush()` (rebuild chunks dirtied by `setBlock`) → `updateTarget` → particles → environment → render.

## Conventions

- **Three.js is pinned to exactly `0.128.0`** (with `@types/three@0.128.0`). That's the version the
  original single-file game loaded from a CDN. Newer releases change colour management and lighting
  defaults (r152+), which would visibly change every colour. Upgrading is a deliberate roadmap item,
  not a drive-by bump.
- **Determinism matters.** With the same `?seed=` the world, trees and clouds must come out identical.
  `rand` in `noise.ts` is shared and consumed in a fixed order: `generateWorld()` (trees) first, then
  `createEnvironment()` (clouds). Texture painters share `trand` (fixed seed), so `TILE_PAINTERS`
  order in `textures.ts` must match the `T_*` ids in `blocks.ts`. Don't reorder these calls, and don't
  add `rand()`/`trand()` calls in the middle without accepting that every world/texture changes.
- **Creation order in `boot()`** (textures → world → chunks → environment → effects) is intentional.
  Keep it unless you have a reason.
- **Module style:** plain functions and module-level state. Modules that need the scene or
  renderer expose a `createX(deps)` factory returning a small interface (`ChunkMesher`, `Environment`,
  `Effects`, `Interaction`). Don't add classes or a framework unless it really pays off.
  `P` and `V` are arrays mutated in place, so never reassign them.
- **Coordinates:** `vox[I(x, y, z)]`, x fastest, then z, then y. Block (x, y, z) occupies
  [x, x+1)×[y, y+1)×[z, z+1). Player `P` is the feet position; the eye is at `P[1] + EYE`.
  `yaw = 0` looks toward −Z.
- **Mobile first.** Every feature must work on a touchscreen with no keyboard. Keep the gesture
  blocking in `input.ts` (no scroll, zoom, pull-to-refresh or long-press menus), respect
  `env(safe-area-inset-*)` in CSS, and keep the frame budget in mind (adaptive pixel ratio in `main.ts`).
- **No external runtime requests.** Everything ships in the bundle, so the game works from Pages on a
  flaky mobile connection once loaded.
- **TypeScript strict** (`noUnusedLocals`/`Parameters` on). `npm run build` must pass, since CI runs it.
  Match the existing terse style: short local names in hot loops, a one-line comment where intent
  isn't obvious, section banners (`/* ==== NAME ==== */`) for big blocks.
- **Debugging:** `window.__voxel` exposes `P, V, get, setBlock, act, collides, step, SEED`, `yaw`,
  `pitch`, `mode`, `onGround`, `pixelRatio`, `count()`. Keep it working. Headless tests can use it.
- `vite.config.ts` uses `base: './'` so the build works under the Pages sub-path. Keep asset
  references relative.

## Roadmap

Ideas, roughly in priority order. Nothing here is committed to.

1. **Save/load:** persist edits (diff against the seeded world) and the player position in
   `localStorage`, plus a "new island" button on the start card.
2. **Automated checks:** a Playwright smoke test driving `window.__voxel` (fixed `?seed=`), run in CI
   before deploying.
3. **PWA:** web app manifest + service worker for home-screen install and offline play.
4. **Water:** translucent water blocks below `SEA` inside the island, with swimming physics.
5. **Bigger worlds:** larger or streamed chunks, greedy meshing, meshing in a Web Worker.
6. **Day/night cycle:** animated sky colours, sun movement, fog colour tied to time of day.
7. **More content:** more block types (glass, water, flowers, ores), a block-picker inventory beyond 8 slots.
8. **Audio:** break/place/footstep sounds generated with Web Audio (keeps the no-assets approach).
9. **Settings:** look sensitivity, invert-Y, FOV, render-quality toggle.
10. **Three.js upgrade:** move to a current release and retune colours (`outputColorSpace`, texture
    `colorSpace`) so the look matches the r128 version.
