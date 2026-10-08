# Voxel Island

A small, mobile-first voxel sandbox (think pocket Minecraft) built with Three.js, TypeScript and Vite.
The world is a 512×512×64-block archipelago generated from a seed, stored as 32×32 chunks of 16×16
columns (full height). Chunks stream in and out around the player; generation and meshing run in
Web Workers, and each chunk draws in one call. You walk around with an on-screen joystick, look by
dragging, and break/place 8 block types. Mid-range Android phones in Chrome are the target. All
textures are painted procedurally at startup — there are no image assets and no runtime network
requests. WebGL 2 is required (texture arrays).

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
  main.ts            Boot: renderer, scene, camera, wiring of all modules, view distance, resize, frame loop, window.__voxel
  config.ts          Chunk size, world size (chunks/blocks), height, sea level, player & physics constants, sky colours
  blocks.ts          Block ids, texture tile ids, block definitions (B), HOTBAR, rotatable tiles
  noise.ts           Seeded hash2/hash3, mulberry PRNG, value noise, fbm (all take the seed); urlSeed()
  textures.ts        Procedural 32×32 pixel-art tile painters → canvases, CanvasTextures, tile texture array, chunk material
  fog.ts             Radial-fog shader patch for built-in materials
  gen.ts             Pure world generation: columnHeight, layering, trees, generateChunk(seed, cx, cz), findSpawn
  worker.ts          Web Worker entry: runs generateChunk and meshChunk off the main thread
  workers.ts         Worker pool (least-busy dispatch, transferable typed arrays) + message types
  streaming.ts       Chunk streaming: load/mesh/unload regions, job priorities, upload budget, edit re-meshes
  world.ts           Chunk storage + World class (getBlock/setBlock/isSolid/topY in world coords, seed), raycast
  mesher.ts          Pure chunk mesher: padded chunk data → typed arrays (face culling, baked face light, AO, tile layer)
  meshing.ts         paddedCopy (chunk + 1-block border), mesher output → BufferGeometry; boxesGeometry
  environment.ts     Sky dome, sun, water surface, clouds around the camera, fog + underwater look
  effects.ts         Target outline, placement ghost, block-break particles
  player.ts          Player state (P, V, yaw/pitch), AABB collision, movement physics, auto-jump, aim()
  interact.ts        Break/place logic (act) and target highlighting (updateTarget)
  input.ts           Touch joystick / look / buttons, mouse + keyboard fallback, gesture blocking
  ui.ts              HUD DOM: toast, mode button, hotbar, fullscreen, start screen, error display
  style.css          All styles
.github/workflows/deploy.yml   Build + deploy to GitHub Pages on every push
```

Data flow per frame (`main.ts` → `frame`): `readControls()` → `player.update()` (only once the chunks
under the player are loaded) → camera → `streamer.update()` (apply finished meshes, unload, start
worker jobs) → `updateTarget` → particles → environment → render. Edits go `world.setBlock` →
`world.onChange` → `streamer.markDirty`, which re-meshes the touched chunks (and neighbours, for
borders) ahead of everything else.

## Conventions

- **Three.js is pinned to exactly `0.128.0`** (with `@types/three@0.128.0`). That's the version the
  original single-file game loaded from a CDN. Newer releases change colour management and lighting
  defaults (r152+), which would visibly change every colour. Upgrading is a deliberate roadmap item,
  not a drive-by bump.
- **Generation is a pure function of (seed, chunkX, chunkZ).** Every block in `gen.ts` comes from
  hashes/noise of the seed and *world* coordinates — no `Math.random`, no shared PRNG state, no
  trig (engines may round it differently) — so a chunk is identical whichever order chunks are
  generated in, on any thread. Trees use one candidate per 6×6 cell; a chunk stamps every tree whose
  canopy reaches into it, including trees rooted in neighbouring chunks. Any change to `gen.ts`
  changes the terrain of every world for that seed.
- **Other determinism:** clouds come from `mulberry(seed ^ …)`, so the same seed gives the same sky.
  Texture painters share `trand` (fixed seed), so `TILE_PAINTERS` order in `textures.ts` must match
  the `T_*` ids in `blocks.ts`; don't add `trand()` calls in the middle without accepting that every
  texture changes.
- **Water (for now):** there are no water blocks. Water is a single translucent surface at `WATER_Y`
  (just under `SEA_LEVEL`) covering the whole world — it follows the camera — and the view turns
  blue (fog, clear colour, `body.under` CSS tint) when the camera is below it. The player walks on
  the seabed as if it were dry. Proper water blocks (and swimming) come in a later milestone.
- **Module style:** plain functions and module-level state. Modules that need the scene or
  renderer expose a `createX(deps)` factory returning a small interface (`ChunkMesher`, `Environment`,
  `Effects`, `Interaction`). Don't add classes or a framework unless it really pays off — `World`
  (the exported `world` singleton) is the one deliberate class. `P` and `V` are arrays mutated in
  place, so never reassign them.
- **Block access goes through `world`.** `getBlock` reads air outside the world and in unloaded
  chunks; `isSolid` (collision) reads *solid* there, so the world edge is an invisible wall and the
  player can never fall into terrain that isn't loaded. Raycasts, particles and placing all use
  `world`, so they work across chunk borders.
- **Coordinates:** world (x, y, z) lives in chunk (x >> CB, z >> CB) at `data[CI(x & 15, y, z & 15)]`
  — x fastest, then z, then y. Block (x, y, z) occupies [x, x+1)×[y, y+1)×[z, z+1). Player `P` is
  the feet position; the eye is at `P[1] + EYE`. `yaw = 0` looks toward −Z.
- **Workers only run pure code.** `gen.ts`, `mesher.ts`, `noise.ts`, `blocks.ts`, `config.ts` are
  imported by `worker.ts`: no three.js, no DOM, no `world`. `meshChunk` only sees a padded copy of
  the chunk (one block of each neighbour, see `paddedCopy`). Per-block hashes use world coordinates.
- **Streaming regions** (`streaming.ts`), measured from the player to each chunk's nearest point:
  meshed within `R·16` blocks (R = view distance, 3–10, default 6, saved in localStorage), loaded
  within `R·16 + 24` (so a meshed chunk always has its 8 neighbours), unloaded beyond `R·16 + 48`.
  Fog ends exactly at `R·16`, and is *radial* (`fog.ts`), so chunks fade in instead of popping.
  Every fogged material needs `radialFog()` (or `radialFogVertex` in its own `onBeforeCompile`).
- **Budgets:** at most 2 new chunk meshes are added per frame (a new mesh skips frustum culling for
  its first frame, so its GPU upload happens then), and at most 8 normal worker jobs start per
  frame. Edit re-meshes skip both limits. Loads go nearest-first, favouring chunks in view.
- **One draw call per chunk:** every tile is a layer of `tileArray` (a `DataTexture2DArray`, r128's
  name for `DataArrayTexture`), the tile is a per-vertex `layer` attribute, and `chunkMaterial` is a
  `MeshBasicMaterial` patched in `onBeforeCompile` to sample the array. Vertex data is Uint8
  (positions relative to the chunk, normalized colours). Dispose geometries when meshes go away.
- **Edited chunks** (`chunk.edited`) are kept in memory when they stream out, and come back from
  there instead of being regenerated.
- **Mobile first.** Every feature must work on a touchscreen with no keyboard. Keep the gesture
  blocking in `input.ts` (no scroll, zoom, pull-to-refresh or long-press menus), respect
  `env(safe-area-inset-*)` in CSS, and keep the frame budget in mind (adaptive pixel ratio in `main.ts`).
- **No external runtime requests.** Everything ships in the bundle, so the game works from Pages on a
  flaky mobile connection once loaded.
- **TypeScript strict** (`noUnusedLocals`/`Parameters` on). `npm run build` must pass, since CI runs it.
  Match the existing terse style: short local names in hot loops, a one-line comment where intent
  isn't obvious, section banners (`/* ==== NAME ==== */`) for big blocks.
- **Debugging:** `window.__voxel` exposes `P, V, world, get, setBlock, act, collides, step, SEED`,
  `yaw`, `pitch`, `mode`, `onGround`, `pixelRatio`, `ready` (world loaded, play enabled), `count()`
  (non-air blocks in loaded chunks), `stream()` (loaded/meshed/visible counts, draw calls),
  `chunk(cx, cz)` (one chunk's streaming state) and `setRenderDistance(r)`. Keep it working.
  Headless tests can use it. `?seed=123` in the URL fixes the seed.
- `vite.config.ts` uses `base: './'` so the build works under the Pages sub-path. Keep asset
  references relative.

## Roadmap

Ideas, roughly in priority order. Nothing here is committed to.

1. **Save/load:** persist edits (diff against the seeded world) and the player position in
   `localStorage`, plus a "new island" button on the start card.
2. **Automated checks:** a Playwright smoke test driving `window.__voxel` (fixed `?seed=`), run in CI
   before deploying.
3. **PWA:** web app manifest + service worker for home-screen install and offline play.
4. **Water:** real water blocks below `SEA_LEVEL` (replacing the single surface), with swimming physics.
5. **Faster meshing:** greedy meshing (fewer vertices), smarter job cancellation when the player
   moves fast.
6. **Day/night cycle:** animated sky colours, sun movement, fog colour tied to time of day.
7. **More content:** more block types (glass, water, flowers, ores), a block-picker inventory beyond 8 slots.
8. **Audio:** break/place/footstep sounds generated with Web Audio (keeps the no-assets approach).
9. **Settings:** look sensitivity, invert-Y, FOV, render-quality toggle.
10. **Three.js upgrade:** move to a current release and retune colours (`outputColorSpace`, texture
    `colorSpace`) so the look matches the r128 version.
