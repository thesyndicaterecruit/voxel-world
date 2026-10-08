# Voxel Island

A small, mobile-first voxel sandbox (think pocket Minecraft) built with Three.js, TypeScript and
Vite. The world is a 512×512×64-block archipelago generated from a seed, stored as 32×32 chunks of
16×16 columns (full height). Chunks stream in and out around the player; generation and meshing run
in Web Workers, and each chunk draws in at most three calls (opaque, cutout, translucent). You walk
around with an on-screen joystick, look by dragging, and break/place 10 block types, glass and
torches among them. Worlds are save files in IndexedDB: edited chunks plus the player state, picked
from a list on the start card. Mid-range Android phones in Chrome are the target. All textures are
painted procedurally at startup — there are no image assets and no runtime network requests. WebGL 2
is required (texture arrays).

Every push is built and deployed to GitHub Pages by `.github/workflows/deploy.yml`:
https://thesyndicaterecruit.github.io/voxel-world/

## Commands

```sh
npm install
npm run dev        # dev server on the LAN (--host) — open the printed Network URL on a phone
npm run build      # tsc --noEmit + vite build → dist/
npm run preview    # serve dist/
npm run typecheck  # the game, the unit tests and the browser tests
npm test           # unit tests (Vitest, tests/), a second or two
npm run test:e2e   # build, then the browser tests (Playwright, e2e/), a few minutes;
                   # needs `npx playwright install chromium` once
```

Unit tests run in CI before every deploy (`deploy.yml`); the browser tests run in their own workflow
(`e2e.yml`) on every push and don't hold up the deploy. Still play the change to check it (desktop:
WASD/arrows, Shift sprint, Space jump, mouse drag on the right half to look, click/F to act, Q/E
switch mode, 1–9 and 0 pick a hotbar slot, mouse wheel over the hotbar scrolls it).

## Structure

```
index.html           Markup for the HUD and start screen; loads src/style.css and src/main.ts
src/
  main.ts            Boot: pick the world, renderer, scene, wiring of all modules, view distance, autosave triggers,
                     resize, frame loop, window.__voxel
  config.ts          Chunk size, world size (chunks/blocks), height, sea level, player & physics constants, sky colours
  blocks.ts          Block registry (B): ids, tiles, solid/opaque/renderPass/light/model flags, lookup tables,
                     faceHidden() culling rule, HOTBAR, rotatable tiles
  noise.ts           Seeded hash2/hash3, mulberry PRNG, value noise, fbm (all take the seed); urlSeed()
  textures.ts        Procedural 32×32 pixel-art tile painters → canvases, CanvasTextures, RGBA tile texture array,
                     chunk materials per render pass
  torch.ts           Torch facing (block state), support offsets, hit boxes, the stick-and-flame model (pure)
  mipmaps.ts         Coverage-preserving mip levels + colour bleeding for cutout tiles (pure)
  fog.ts             Radial-fog shader patch for built-in materials
  gen.ts             Pure world generation: columnHeight, layering, trees, generateChunk(seed, cx, cz), findSpawn
  worker.ts          Web Worker entry: runs generateChunk and meshChunk off the main thread
  workers.ts         Worker pool (least-busy dispatch, transferable typed arrays) + message types
  streaming.ts       Chunk streaming: load/mesh/unload regions, job priorities, upload budget, edit re-meshes
  world.ts           Chunk storage (block ids + lazy per-block state) + World class (getBlock/getState/setBlock/
                     isSolid/topY in world coords, seed), raycast
  saves.ts           Save files: worlds list/create/delete, the open world's chunk source + autosave
  db.ts              Tiny promise wrapper over IndexedDB
  rle.ts             Run-length encoding of chunk data (varint run lengths)
  mesher.ts          Pure chunk mesher: padded chunk data → typed arrays per render pass (face culling, baked
                     face light, AO, tile layer; cube, torch and liquid models)
  meshing.ts         paddedCopy (chunk + 1-block border), mesher output → BufferGeometry; boxesGeometry
  environment.ts     Sky dome, sun, water surface, clouds around the camera, fog + underwater look
  effects.ts         Target outline (around a block or a torch's hit box), placement ghost, block-break particles
  player.ts          Player state (P, V, yaw/pitch), AABB collision, movement physics, auto-jump, aim()
  interact.ts        Break/place logic (act; torch facing, torches popping off) and target highlighting (updateTarget)
  input.ts           Touch joystick / look / buttons / hotbar swipes, mouse + keyboard fallback, gesture blocking
  ui.ts              HUD DOM: toast, mode button, hotbar (scrolls sideways), menu (view distance, Fancy leaves,
                     save & exit), fullscreen, start screen + world list, error display
  style.css          All styles
tests/               Unit tests of the pure modules (Vitest): registry + face culling, mesher, torch geometry,
                     save format + migration, RLE, mipmaps, generation determinism
e2e/                 Browser tests (Playwright, phone emulation): game.ts drives the game (deterministic clock,
                     aiming, taps, pixel captures); see-through blocks, torches, hotbar, Fancy leaves, old saves
vitest.config.ts, playwright.config.ts
.github/workflows/deploy.yml   Unit tests + build + deploy to GitHub Pages on every push
.github/workflows/e2e.yml      Browser tests on every push
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
- **Water (for now):** the sea is a single translucent surface at `WATER_Y` (just under
  `SEA_LEVEL`) covering the whole world — it follows the camera — and the view turns blue (fog,
  clear colour, `body.under` CSS tint) when the camera is below it. The player walks on the seabed
  as if it were dry. A `WATER` block exists in the registry (translucent, liquid model, level in its
  block state) but the world doesn't generate it and it isn't in the hotbar yet (place it with
  `__voxel.setBlock`); real water and swimming come in a later milestone.
- **Module style:** plain functions and module-level state. Modules that need the scene or
  renderer expose a `createX(deps)` factory returning a small interface (`Streamer`, `WorkerPool`,
  `Environment`, `Effects`, `Interaction`). Don't add classes or a framework unless it really pays off — `World`
  (the exported `world` singleton) is the one deliberate class. `P` and `V` are arrays mutated in
  place, so never reassign them.
- **Block registry** (`blocks.ts`): every block type has an id (stored in chunks and saves, so ids
  never change; new blocks get new ids), a name, a tile per face kind, `solid` (collides), `opaque`
  (blocks light, hides neighbouring faces), `renderPass` ('opaque' | 'cutout' | 'translucent'),
  `lightEmission` (0–15), `lightFilter` (skylight removed: 0 air/glass, 1 leaves, 2 water, 15
  opaque), `model` ('cube' | 'torch' | 'liquid'), `cullSame` (two of it hide their shared face:
  glass, water), `jit` (brightness variation), `icon` (hotbar tile), `particle` (tile of the bits
  that fly off when it breaks) and optional `fastTex` (tiles when meshed as an opaque cube: leaves
  with Fancy leaves off). `lightEmission` is groundwork that nothing reads until lighting lands;
  `lightFilter` already decides which cubes darken AO corners. Hot loops use the `Uint8Array` tables
  (`SOLID`, `OPAQUE`, `OCCLUDES`, `TARGETABLE`, …) instead of the objects. Face culling is
  `faceHidden(self, neighbour)`: an opaque neighbour hides a face, so does a same-type neighbour for
  `cullSame` blocks; leaves next to leaves still render unless leaves are meshed as opaque cubes. AO
  corners come from `OCCLUDES` (cubes that dim light: opaque blocks and leaves).
- **Torches** (`torch.ts`): block state 0 = standing on the block below, 1–4 = on a wall, leaning out
  of it, with the supporting block at −x, +x, −z, +z (`TORCH_SUPPORT`). The state comes from the face
  you build against (`torchStateFor`; never an underside), and the support must be a solid cube.
  Torches aren't solid, nothing builds against them, and the raycast only hits them inside their
  small `torchBox` (rays past the stick reach the block behind). Breaking a block pops the torches it
  holds (`popTorches` in `interact.ts`); that is the only way a support disappears today, so anything
  new that removes blocks must do the same. The model is built in texels (1/32 block, uv = position
  in the torch tile), tilted 22.5° and turned per state in `TORCH_MODELS`; the mesher copies it into
  the cutout pass (flame and tip full-bright), and the placement ghost uses it too.
- **Fancy leaves** (menu toggle, default on, saved in localStorage): on, leaves use the see-through
  `T_LEAVES_CUT` tile in the cutout pass; off, `streamer.setOpaqueLeaves(true)` meshes them as opaque
  cubes with the old solid tile (`fastTex`), culled like stone (`faceHidden(…, opaqueLeaves)`).
  Switching re-meshes the chunks with leaves and their neighbours as normal jobs.
- **Hotbar:** 10 slots of 36 px that scroll sideways when they don't fit (portrait phones). Touches
  that start on `#hotbar` belong to it (`input.ts`), never to the joystick or look zones: a swipe
  scrolls, a tap picks the nearest slot (gaps included). The end with more slots past it fades.
- **Per-block state:** each chunk can carry a second `Uint8Array` (`chunk.state`, same layout as
  the block ids) for things like torch facing and water level. It is `null` until some block gets a
  non-zero state — generated terrain never has any — and `world.setBlock(x, y, z, id, state)` sets
  both.
- **Block access goes through `world`.** `getBlock` reads air outside the world and in unloaded
  chunks; `isSolid` (collision) reads *solid* there, so the world edge is an invisible wall and the
  player can never fall into terrain that isn't loaded. Raycasts, particles and placing all use
  `world`, so they work across chunk borders.
- **Coordinates:** world (x, y, z) lives in chunk (x >> CB, z >> CB) at `data[CI(x & 15, y, z & 15)]`
  — x fastest, then z, then y. Block (x, y, z) occupies [x, x+1)×[y, y+1)×[z, z+1). Player `P` is
  the feet position; the eye is at `P[1] + EYE`. `yaw = 0` looks toward −Z.
- **Workers only run pure code.** `gen.ts`, `mesher.ts`, `torch.ts`, `noise.ts`, `blocks.ts`,
  `config.ts` are imported by `worker.ts`: no three.js, no DOM, no `world`. `meshChunk` only sees a
  padded copy of the chunk (one block of each neighbour, see `paddedCopy`). Per-block hashes use
  world coordinates.
- **Streaming regions** (`streaming.ts`), measured from the player to each chunk's nearest point:
  meshed within `R·16` blocks (R = view distance, 3–10, default 6, saved in localStorage), loaded
  within `R·16 + 24` (so a meshed chunk always has its 8 neighbours), unloaded beyond `R·16 + 48`.
  Fog ends exactly at `R·16`, and is *radial* (`fog.ts`), so chunks fade in instead of popping.
  Every fogged material needs `radialFog()` (or `radialFogVertex` in its own `onBeforeCompile`).
- **Budgets:** at most 2 chunks' new or re-built meshes are added per frame (a new mesh skips
  frustum culling for its first frame, so its GPU upload happens then), and at most 8 normal worker
  jobs start per frame. Edit re-meshes skip both limits. Loads go nearest-first, favouring chunks
  in view.
- **Render passes:** each chunk has up to three meshes, created only when non-empty — opaque,
  cutout (alpha-tested at 0.5, writes depth: leaves, glass, torches) and translucent (alpha-blended,
  no depth writes: water; drawn after everything else, and `streamer.sortTranslucent` orders the
  chunks back to front each frame through `renderOrder`). A block's faces go into its registry
  `renderPass` (leaves into the opaque one when meshed as opaque cubes).
- **One draw call per pass:** every tile is a layer of `tileArray` (an RGBA `DataTexture2DArray`,
  r128's name for `DataArrayTexture`), the tile is a per-vertex `layer` attribute, and the three
  `chunkMaterials` are `MeshBasicMaterial`s patched in `onBeforeCompile` to sample the array (the
  opaque one ignores alpha). Vertex positions are `Uint16` fixed point in 1/64 block relative to the
  chunk (`FP` in `mesher.ts`, fine enough for the tilted torch; meshes are scaled by 1/FP), uvs are
  `Uint8` texels (0–`TEX` = 32; the materials divide by 32), colours are normalized `Uint8`. Dispose
  geometries when meshes go away.
- **Cutout tiles** (tiles of cutout blocks with see-through texels) get colour bleeding into their
  clear texels and coverage-preserving mip levels (`mipmaps.ts`), uploaded over GL's generated
  mips in the texture's `onUpdate`, so leaves and glass frames don't fade out in the distance.
  Other tiles keep GL's mipmaps. New tiles go at the end of `TILE_PAINTERS`.
- **Save files** (`saves.ts`, IndexedDB `voxel-island`): store `worlds` holds one `WorldRecord` per
  world (id, name, seed, createdAt, lastPlayed, saveVersion, player position/yaw/pitch, hotbar slot,
  break/place mode); store `chunks` holds only *edited* chunks under `${worldId}:${cx},${cz}` as
  `{ v, rle, srle? }`: the block ids run-length encoded, plus the per-block state the same way when
  any of it is non-zero. Everything else regenerates from the seed — so changing `gen.ts` changes the
  unedited terrain of existing saves. `SAVE_VERSION` is 2; when the stored format changes, bump it,
  note it in the history at the top of `saves.ts`, add a fixture of the previous version to
  `tests/saves.test.ts`, and extend `migrateWorld` / `migrateChunk`, which bring any older record up
  to date every time one is read (a migrated record is written back the next time it is saved). New
  hotbar items go at the end, so saved slot numbers keep pointing at the same block. The save is the
  streamer's chunk source: a loaded chunk reads its saved data instead of being generated, and an
  edited chunk that streams out keeps an RLE snapshot in memory until it is written. Autosave runs
  within 5 s of the first unsaved change (edits, or the player moving/looking), and immediately on
  `visibilitychange → hidden`, `pagehide` and the menu's Save & exit. `navigator.storage.persist()`
  is requested once. Without IndexedDB (some private modes) the game still runs and keeps edits in
  memory for the session.
- **Switching worlds reloads the page** (`?world=<id>`, removed from the URL right away). The start
  card lists worlds by last played; `?seed=123` opens (or creates) the world "Seed 123".
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
  `chunk(cx, cz)` (one chunk's streaming state, triangles per pass), `setRenderDistance(r)`,
  `setFancyLeaves(on)` (same as the menu toggle), `getState`, `look(yaw, pitch)`, `target()` (the
  block under the crosshair, with the face hit and its id), `tiles` (the tile canvases), `worldId`
  and `save()`.
  Keep it working: the browser tests drive the game through it; `?seed=123` in the URL gives a
  fixed world.
- **Tests:** pure modules get unit tests in `tests/` (they run in Node: no DOM, no WebGL). Browser
  tests go through `e2e/game.ts`, which replaces the page's clock, `requestAnimationFrame` and
  `Math.random` so the game only advances when a test calls `ticks()`: wait for game state in frames
  (`until`), never in wall time, and read pixels with `capture` (the 3D view, without the HUD). Every
  browser test checks that the console stayed free of errors and warnings.
- `vite.config.ts` uses `base: './'` so the build works under the Pages sub-path. Keep asset
  references relative.

## Roadmap

Ideas, roughly in priority order. Nothing here is committed to.

1. **More automated checks:** trees across chunk borders, streaming and unloading while the player
   moves, autosave timing; screenshot comparisons to catch changes in the look.
2. **Saves:** rename worlds, export/import a world as a file, guard against two tabs writing the same
   world.
3. **PWA:** web app manifest + service worker for home-screen install and offline play.
4. **Water:** real water blocks below `SEA_LEVEL` (replacing the single surface), with swimming physics.
5. **Faster meshing:** greedy meshing (fewer vertices), smarter job cancellation when the player
   moves fast.
6. **Day/night cycle:** animated sky colours, sun movement, fog colour tied to time of day.
7. **More content:** more block types (water, flowers, ores), a block-picker inventory instead of an
   ever longer hotbar.
8. **Audio:** break/place/footstep sounds generated with Web Audio (keeps the no-assets approach).
9. **Settings:** look sensitivity, invert-Y, FOV, render-quality toggle.
10. **Three.js upgrade:** move to a current release and retune colours (`outputColorSpace`, texture
    `colorSpace`) so the look matches the r128 version.
