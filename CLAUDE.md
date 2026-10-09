# Voxel Island

A small, mobile-first voxel sandbox (think pocket Minecraft) built with Three.js, TypeScript and
Vite. The world is a 512×512×128-block archipelago generated from a seed, stored as 32×32 chunks of
16×16 columns (full height), each made of 8 sections of 16×16×16 blocks. Chunks stream in and out
around the player; generation, lighting and meshing (a section at a time) run in Web Workers, and
each chunk draws in at most two calls (opaque, cutout) plus a share of one for its water
(translucent, drawn 4×4 chunks at a time). A world keeps the generator that made it: new worlds
have the sea at y = 48, worlds made before the world grew taller keep the first generator (sea at
y = 20) so their ground never shifts. You walk
around with an on-screen joystick, look by dragging, and break/place 10 block types, glass and
torches among them. Worlds are save files in IndexedDB: edited chunks plus the player state, picked
from a list on the start card. The sea and inland lakes are water blocks. Mid-range Android phones in
Chrome are the target. All textures are painted procedurally at startup — there are no image assets
and no runtime network requests. WebGL 2 is required (texture arrays).

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
switch mode, 1–9, 0 and − pick a hotbar slot, mouse wheel over the hotbar scrolls it).

## Structure

```
index.html           Markup for the HUD and start screen; loads src/style.css and src/main.ts
src/
  main.ts            Boot: pick the world, renderer, scene, wiring of all modules, view distance, autosave triggers,
                     resize, frame loop, window.__voxel
  config.ts          Chunk size, world size (chunks/blocks), height, sections, player & physics constants, sky colours
  blocks.ts          Block registry (B): ids, tiles, solid/opaque/renderPass/light/model flags, lookup tables,
                     faceHidden() culling rule, HOTBAR, rotatable tiles
  noise.ts           Seeded hash2/hash3, mulberry PRNG, value noise, fbm (all take the seed); urlSeed()
  textures.ts        Procedural 32×32 pixel-art tile painters (animated water: frames) → canvases, CanvasTextures,
                     RGBA tile texture array, chunk materials per render pass (the water shader), setUnderwater
  shading.ts         Light → brightness: shared light uniforms (daylight, sky tint, floor, Brightness, flicker
                     time), the chunk shader's light code, lightColor() for CPU-lit things
  torch.ts           Torch facing (block state), support offsets, hit boxes, the stick-and-flame model (pure)
  light.ts           Skylight + block light (pure): lighting a chunk from scratch (worker), relightMany() after edits
  water.ts           Flowing water (main thread): ticks, updates only where something disturbed it, the flow rules,
                     pending updates for saving
  mipmaps.ts         Coverage-preserving mip levels + colour bleeding for cutout tiles (pure)
  fog.ts             Radial-fog shader patch for built-in materials
  gen.ts             World generators by version (generator(v): sea level, cloud height, generateChunk(seed, cx, cz),
                     findSpawn, surfaceHeight); GENERATOR_VERSION for new worlds; generator 2
  gen1.ts            Generator 1, FROZEN (worlds made before generator versions): columnHeight, waterLevel (sea,
                     lakes), layering, trees, generateChunk, findSpawn; floodSea (old saves get the sea)
  worker.ts          Web Worker entry: runs generateChunk, lightChunk and meshSection off the main thread
  workers.ts         Worker pool (least-busy dispatch, transferable typed arrays) + message types
  streaming.ts       Chunk streaming: load/light/mesh/unload regions, job priorities, upload budget, edits (relight +
                     re-mesh the sections they touch), sections' meshes spliced into one per chunk and pass
  world.ts           Chunk storage (block ids, lazy per-block state, light, blocks per section) + World class
                     (getBlock/getState/getLight/setBlock/isSolid/topY in world coords, seed, generator, sea level),
                     raycast; inWater, waterDepth, waterFlow
  saves.ts           Save files: worlds list/create/delete, the open world's chunk source + autosave
  db.ts              Tiny promise wrapper over IndexedDB
  rle.ts             Run-length encoding of chunk data (varint run lengths)
  mesher.ts          Pure chunk mesher, a section at a time: padded chunk blocks + light + state → typed arrays per
                     render pass (face culling, baked face shading, AO, smooth light, tile layer; cube, torch and
                     liquid models: water surfaces shaped by their neighbours, flat ones merged); spliceSections
  meshing.ts         paddedCopy (chunk + 1-block border: blocks, light or state), mesher output → BufferGeometry;
                     boxesGeometry
  environment.ts     Sky (gradient + sunset glow shader), sun, moon, stars, the sea beyond the world's edge, clouds
                     around the camera, all following the time of day (setTime); fog + underwater look; daylight,
                     sky tint and the sky colour water reflects
  effects.ts         Target outline (around a block or a torch's hit box), placement ghost, block-break particles,
                     splashes (the last three lit like the spot they're at)
  player.ts          Player state (P, V, yaw/pitch, how wet, breath), AABB collision, movement physics, swimming,
                     auto-jump, aim(); playerEvents (splash)
  audio.ts           Sound hooks (playSound), silent until the game has audio
  interact.ts        Break/place logic (act; torch facing, torches popping off) and target highlighting (updateTarget)
  input.ts           Touch joystick / look / buttons / hotbar swipes, mouse + keyboard fallback, gesture blocking
  ui.ts              HUD DOM: toast, mode button, hotbar (scrolls sideways), menu (view distance, Fancy leaves,
                     Brightness, Day length, Always day, clock, save & exit), fullscreen, start screen + world list,
                     error display
  style.css          All styles
tests/               Unit tests of the pure modules (Vitest): registry + face culling, light (spreading, removal,
                     chunk borders, incremental = fresh, single and batched, high up), mesher (water surfaces too),
                     sections (meshing, splicing, counts, light worked out only as high as needed, water falling
                     through them), torch geometry, save format + migration, RLE, mipmaps, generation (generator
                     1's fingerprints, determinism, sea fill, lakes that hold), flowing water (spreading, falling,
                     draining, infinite sources, chunk borders, saved updates), swimming physics (sinking,
                     swimming up, bobbing, braking, climbing out)
e2e/                 Browser tests (Playwright, phone emulation): game.ts drives the game (deterministic clock,
                     aiming, taps, joystick, several fingers at once, pixel captures, frame timing); see-through
                     blocks, torches, hotbar, Fancy leaves, old saves (keeping generator 1), time of day (midday/sunset/midnight
                     screenshots, torchlight, frame time at night), water (a channel dug from the sea fills, a
                     lake swum across and climbed out of by touch, underwater screenshots by day, deep down and
                     at night, frame time looking out to sea, flow carrying on after a reload)
vitest.config.ts, playwright.config.ts
.github/workflows/deploy.yml   Unit tests + build + deploy to GitHub Pages on every push
.github/workflows/e2e.yml      Browser tests on every push; the report (with the screenshots) is a run artifact
```

Data flow per frame (`main.ts` → `frame`): `readControls()` → `player.update()` (only once the chunks
under the player are loaded) → `water.update()` (a tick every 0.2 s) → camera → `streamer.update()`
(apply finished meshes, unload, start worker jobs, rebuild water groups) → `updateTarget` →
particles → environment → render. Edits go `world.setBlock` → `world.onChange`, which tells the
water (`water.blockChanged`: schedule the water in and next to the block) and collects the change;
a microtask then hands all the changes made together (one action, one tick of water) to
`streamer.blocksChanged`, which relights around them on the spot and re-meshes the touched chunks
(neighbours too, for borders) and every chunk whose light changed, ahead of everything else.

## Conventions

- **Three.js is pinned to exactly `0.128.0`** (with `@types/three@0.128.0`). That's the version the
  original single-file game loaded from a CDN. Newer releases change colour management and lighting
  defaults (r152+), which would visibly change every colour. Upgrading is a deliberate roadmap item,
  not a drive-by bump.
- **Generation is a pure function of (seed, chunkX, chunkZ).** Every block a generator makes comes
  from hashes/noise of the seed and *world* coordinates — no `Math.random`, no shared PRNG state, no
  trig (engines may round it differently) — so a chunk is identical whichever order chunks are
  generated in, on any thread. Trees use one candidate per 6×6 cell; a chunk stamps every tree whose
  canopy reaches into it, including trees rooted in neighbouring chunks.
- **Generator versions** (`gen.ts`): a world record keeps the `generatorVersion` that made it, and
  its unexplored chunks always come from that generator (`generator(v)`: also its sea level, cloud
  height, spawn), so the ground never shifts next to what a save holds. Generator 1 (`gen1.ts`) is
  every world made before versions existed — the first archipelago, written for a 64-high world
  with the sea at y = 20; in today's chunks it is air above y = 64. It is **frozen**: don't change
  anything that reaches its output (`tests/gen.test.ts` checks fingerprints of its chunks). New
  worlds get `GENERATOR_VERSION` (2, sea level 48). Changing generator 2 changes the unexplored
  ground of every world made with it — fine while it is new; once worlds depend on it, a change that
  moves terrain is a new version.
- **Other determinism:** clouds come from `mulberry(seed ^ …)`, so the same seed gives the same sky.
  Texture painters share `trand` (fixed seed), so `TILE_PAINTERS` order in `textures.ts` must match
  the `T_*` ids in `blocks.ts`; don't add `trand()` calls in the middle without accepting that every
  texture changes.
- **Water:** the sea and lakes are `WATER` blocks (not solid, translucent pass, `lightFilter` 2 so
  deep water gets darker, model 'liquid'). Generation fills the air below the sea level
  (`world.seaLevel`, the generator's) with still water (sources), and digs lakes into inland ground
  (at most one per 32×32 cell: a bowl filled up to the lowest point of the ground around it, with a
  bank raised where the rim has a gap, so a lake always holds its water; `waterLevel(seed, x, z)`).
  Block state: the low 3 bits are the level (0 a source, 1–7 flowing, a step lower per block), bit 3
  (`FALLING`) is water falling down; `liquidHeight` gives a block's surface height (a source's is
  7/8 of a block, so the sea's surface sits just under a sea-level beach). The mesher shapes the
  surface per corner from the up to 4 columns sharing it (full where any of them falls or has water
  on top, else the average of their heights with sources counting 10 times, pulled down by open
  cells, solid ones ignored), so neighbouring water joins up; faces between water blocks are hidden,
  faces toward the world's edge too (`environment.ts` draws the sea on past it). Flat, evenly lit
  tops of still water merge into quads of up to 7×7 blocks (uvs are bytes; the shader repeats the
  tile with `fract`, sampling once with `textureLod` at a mip level worked out from the unwrapped uv
  — no anisotropic taps, which matters on weak GPUs). Tiles: still water's ripples on tops and
  bottoms, flowing water's streaks on sides and on sloping tops (turned to run downhill) —
  `WATER_FRAMES` frames each at the end of `TILE_PAINTERS`, played by time in the shader. The water
  shader reflects the sky colour (`lightUniforms.skyColor`, set with the time of day) where it sees
  skylight, more at a glancing angle; that and the angle are worked out in view space, because r128
  doesn't give a `MeshBasicMaterial` `cameraPosition`. The camera counts as in water (`inWater`)
  below a water block's surface: then the fog, clear colour and `body.under` tint turn blue, darker
  the deeper it is (`waterDepth`, down to 24 blocks: the fog also closes in from 20 to 14 blocks)
  and at night (the CSS tint's dark layer follows `--dim`), and the water material shows back faces
  too (`setUnderwater`): the surface from below shows the sky near overhead (Snell's window) and
  mirrors the deep further out, fogged half as much as the rest. Out of water it stays single-sided,
  or a pond would show its far side through its near one. Water can't be aimed at (raycasts pass
  through it); placing a block into water replaces it, but torches refuse. The hotbar's Water places
  a source (creative-style; buckets come with an inventory).
- **Swimming** (`player.ts`): `player.wet` says how deep the player is — 1 feet (0.1 up), 2 waist
  (0.9 up), 3 head (the eye) under. With the waist in, the player swims: 55% speed (80% wading with
  just the feet in), JUMP (held) swims up toward 3 blocks/s and without it they sink toward
  −1 block/s, a fall is braked hard (already with the feet in, to −4 blocks/s), and there is no
  auto-jump (wading keeps it). Holding JUMP at the surface bobs: the waist rises out, gravity takes
  over, it dips back in — the head stays above water. Pushing into a ledge with JUMP held while the
  feet are in water lifts the player at 9.5 blocks/s, enough to clear a block above the water (the
  way out of a lake on a touchscreen: joystick forward + JUMP). Flowing water carries the player
  along its `waterFlow` at 1.2 blocks/s. Hitting the water faster than 6 blocks/s fires
  `playerEvents.splash` (main.ts: `fx.splash` and the silent `playSound('splash')` hook).
  `player.breath` counts seconds of air (`BREATH` 15) down with the head under water and back up
  above it; nothing uses it until there is health.
- **Flowing water** (`water.ts`, main thread): water moves in ticks 0.2 s apart and only where
  something disturbed it — `world.onChange` schedules the water in and next to every changed block,
  a tick updates at most `MAX_UPDATES` (128) scheduled blocks, and what they change schedules its
  own neighbours for the next tick, so the untouched sea costs nothing. Rules: water falls first
  (into air, or a torch it washes away, as full-height falling water; water with water on top is
  falling); on the ground it spreads one level weaker per block, 7 blocks from a source, toward the
  nearest drop within 4 blocks if any (a breadth-first look), else every open way; flowing water
  landing on more water doesn't spread on top of it; a flowing block takes the level its strongest
  neighbour feeds it, or dries up (a stream drains when its source goes, and finds another way
  round a block put in it); two sources beside a flowing block on solid ground or a source make it
  a source; sources never change by themselves. Updates whose chunks (5 blocks around) aren't
  loaded wait. Pending updates are saved with their chunk (`pendingIn` / `restore`).
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
  with Fancy leaves off). `lightEmission` and `lightFilter` drive the light (see Light);
  `lightFilter` also decides which cubes darken AO corners. Hot loops use the `Uint8Array` tables
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
- **Hotbar:** 11 slots of 36 px that scroll sideways when they don't fit (portrait phones). Touches
  that start on `#hotbar` belong to it (`input.ts`), never to the joystick or look zones: a swipe
  scrolls, a tap picks the nearest slot (gaps included). The end with more slots past it fades.
- **Sections:** a chunk column is `NSEC` (8) sections of 16×16×16 blocks (`SH` layers each). CI runs
  y last, so a section is one contiguous slice of a chunk's arrays (blocks, state, light) — the
  storage stays one array per chunk. `chunk.count` holds the non-air blocks per section (kept by
  `setBlock`): an empty section has no mesh, never goes to a worker and costs nothing to draw, and
  `sectionTop` says how high a chunk's blocks go. Meshing is per section (`meshSection`, with a padded
  copy of its layers and one above and below): a change at y re-meshes the sections holding y − 1 …
  y + 1, in its chunk and the neighbours it borders, and the sections whose light changed. Each
  section has its own version (`ver` / `shown` / `sent` in `streaming.ts`); one job meshes all of a
  chunk's sections that need it. To keep draw calls down a chunk is still drawn whole: its sections'
  meshes are kept one after another per pass (`SectionedMesh`), and `spliceSections` swaps the parts
  of the sections that changed. Light and water work in world coordinates, so section borders mean
  nothing to them.
- **Per-block state:** each chunk can carry a second `Uint8Array` (`chunk.state`, same layout as
  the block ids) for things like torch facing and water level. It is `null` until some block gets a
  non-zero state — generated terrain never has any — and `world.setBlock(x, y, z, id, state)` sets
  both.
- **Light** (`light.ts`): two channels per block, 0–15, packed in `chunk.light` (one byte per block,
  same layout as the ids): skylight in the high nibble, block light in the low one. Never saved:
  worked out from the blocks. Rules: a block's `lightFilter` is what light loses entering it (15:
  none gets in). Skylight enters the top layer at 15 and, straight down, loses only each block's
  filter (open air stays 15 to the ground, leaves take 1, water 2); any other way it loses max(1,
  filter) per block. Block light starts at the emitter's `lightEmission` (torch 14) and loses max(1,
  filter) per block every way. Light reaches at most 15 blocks, so a chunk is lit exactly from its
  3×3 neighbourhood: `lightChunk` in a worker, once it and its 8 neighbours are loaded. Above
  everything built or grown it is open sky (15, no block light), so lighting only works up to 16
  blocks above the highest block around (`topOf`; the streamer sends just those layers) and fills
  the rest with sky — exact, and as cheap as the terrain is low. After that,
  `streamer.blocksChanged` calls `relightMany()` on the main thread for the changes made together
  (the two-queue flood fill: remove what depended on the old blocks, then spread back from the edge;
  it works on a copied box 16 blocks around them, from the bottom up to 16 above the highest block
  in it, ≈0.5 ms for one block; changes more than 32 blocks apart are lit separately) and re-meshes
  the sections whose light changed. If anything within reach isn't lit yet it falls back to lighting
  those chunks again in workers; lighting jobs carry a version and results from before an edit are
  thrown away. Meshing needs the chunk and its 8 neighbours lit. `tests/light.test.ts` checks that
  incremental updates, single and in batches, always equal a fresh computation; in the game
  `__voxel.verifyLight(cx, cz)` does the same for one chunk.
- **Shading** (`shading.ts`): every chunk vertex carries its colour as r = face shading × AO ×
  jitter, g = skylight, b = block light (light as level × 17). Smooth light: a vertex averages the
  light of the cells touching its corner on the face's outer side (the face's neighbour, the two
  beside it, the diagonal unless both of those are solid), leaving out solid cells; a torch takes its
  own cell's light, its flame full block light. The chunk shader makes
  `max(curve(sky × daylight) × skyTint, curve(block × flicker) × warm, floor)` per vertex, where
  `curve` is Minecraft's l / (4 − 3l) lifted by the Brightness setting (Moody / Normal / Bright:
  curve lift and floor, saved in localStorage) — all uniforms in `lightUniforms`, so time of day
  never re-meshes. Torches flicker in the shader (a slow wave in `time`). Anything else drawn in the
  world should follow the light: `lightColor(world.getLight(…), color)` gives the same colour on the
  CPU (break particles, the placement ghost). In full skylight by day the result equals the old unlit
  look.
- **Day and night:** the world clock counts days since the world began (`WorldRecord.time`, saved
  with the world; the fraction is the time of day: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset;
  new worlds start at 0.3). It runs while playing, not on the title screen or with the menu open: a
  day takes the Day length setting (5–60 real minutes, default 20), and Always day holds it at noon
  (both saved in localStorage). Every frame `env.setTime(t)` moves the sun (its path tilted toward
  −z) and the moon opposite, recolours the sky shader (horizon/zenith gradient, a warm glow around a
  low sun), fog and clear colour, the sea and the clouds (blending day, sunrise/sunset and night
  colours), fades the stars in (a fixed point field turned with the sky, one rotation per frame), and
  sets the light uniforms: `daylight` from 1 down to 0.38 (moonlight) and a warm or cool `skyTint`.
  The sun and moon hide below the horizon. Nothing re-meshes as time passes.
- **Block access goes through `world`.** `getBlock` reads air outside the world and in unloaded
  chunks; `isSolid` (collision) reads *solid* there, so the world edge is an invisible wall and the
  player can never fall into terrain that isn't loaded. Raycasts, particles and placing all use
  `world`, so they work across chunk borders.
- **Coordinates:** world (x, y, z) lives in chunk (x >> CB, z >> CB) at
  `data[CI(x & 15, y, z & 15)]` — x fastest, then z, then y — in section y >> SB. The world is `H` =
  128 high. Block (x, y, z) occupies [x, x+1)×[y, y+1)×[z, z+1). Player `P` is the feet position;
  the eye is at `P[1] + EYE`. `yaw = 0` looks toward −Z.
- **Workers only run pure code.** `gen.ts`, `gen1.ts`, `light.ts`, `mesher.ts`, `torch.ts`,
  `noise.ts`, `blocks.ts`, `config.ts` are imported by `worker.ts`: no three.js, no DOM, no `world`.
  `meshChunk` only sees a padded copy of the chunk (one block of each neighbour, see `paddedCopy`).
  Per-block hashes use world coordinates.
- **Streaming regions** (`streaming.ts`), measured from the player to each chunk's nearest point:
  meshed within `R·16` blocks (R = view distance, 3–10, default 6, saved in localStorage), lit
  within `R·16 + 24` (so a meshed chunk always has its 8 neighbours lit), loaded within `R·16 + 48`
  (so a lit chunk has its neighbours' blocks), unloaded beyond `R·16 + 72`. Until the world is first
  ready to play it streams as if R were 2, so the start area comes first. Fog ends exactly at
  `R·16`, and is *radial* (`fog.ts`), so chunks fade in instead of popping. Every fogged material
  needs `radialFog()` (or `radialFogVertex` in its own `onBeforeCompile`).
- **Budgets:** at most 2 chunks' new or re-built meshes are added per frame while playing (8 behind
  the title card; a new mesh skips frustum culling for its first frame, so its GPU upload happens
  then), and at most 8 normal worker jobs (load, light, mesh) start per frame. Edit re-meshes skip
  both limits. Jobs go nearest-first, favouring chunks in view. A result stays "on its way" (`sent`)
  until it is shown, so a chunk waiting for its upload isn't sent to a worker again.
- **Render passes:** each chunk has up to three meshes' worth of data, created only when non-empty —
  opaque, cutout (alpha-tested at 0.5, writes depth: leaves, glass, torches) and translucent
  (alpha-blended, no depth writes: water; drawn after everything else). The sea puts water in most
  chunks, so the translucent pass is drawn per group of 4×4 chunks (`groupGeometry`: one draw call
  for all 16), rebuilt when one of them changes or crosses into or out of the view distance;
  `streamer.sortTranslucent` orders the groups back to front each frame through `renderOrder`. A
  block's faces go into its registry `renderPass` (leaves into the opaque one when meshed as opaque
  cubes).
- **One draw call per pass:** every tile is a layer of `tileArray` (an RGBA `DataTexture2DArray`,
  r128's name for `DataArrayTexture`), the tile is a per-vertex `layer` attribute, and the three
  `chunkMaterials` are `MeshBasicMaterial`s patched in `onBeforeCompile` to sample the array (the
  opaque one ignores alpha). Vertex positions are `Uint16` fixed point in 1/64 block relative to the
  chunk (`FP` in `mesher.ts`, fine enough for the tilted torch; meshes are scaled by 1/FP), uvs are
  `Uint8` texels (0–`TEX` = 32; the materials divide by 32), colours are normalized `Uint8` (shading
  and light, see Shading). Dispose geometries when meshes go away.
- **Cutout tiles** (tiles of cutout blocks with see-through texels) get colour bleeding into their
  clear texels and coverage-preserving mip levels (`mipmaps.ts`), uploaded over GL's generated
  mips in the texture's `onUpdate`, so leaves and glass frames don't fade out in the distance.
  Other tiles keep GL's mipmaps. New tiles go at the end of `TILE_PAINTERS`.
- **Save files** (`saves.ts`, IndexedDB `voxel-island`): store `worlds` holds one `WorldRecord` per
  world (id, name, seed, createdAt, lastPlayed, saveVersion, player position/yaw/pitch, hotbar slot,
  break/place mode, the world clock, generatorVersion); store `chunks` holds only *edited* chunks
  under `${worldId}:${cx},${cz}` as `{ v, rle, srle?, flow? }`: the block ids run-length encoded,
  plus the per-block state the same way when any of it is non-zero, plus the blocks with pending
  water updates (a chunk with some is saved even if its blocks are as generated). Everything else
  regenerates from the seed with the world's generator (`generatorVersion` in its record; 1 for
  every world made before save version 6). Chunks saved before version 6 are 64 layers high: reading
  them adds a run of air on top (their CI indices, pending water included, stay the same). Chunks
  saved before version 4 had air where the sea is; reading them runs `floodSea` (the air below sea
  level open to the sea becomes water). `SAVE_VERSION` is 6; when the stored format changes, bump
  it, note it in the history at the top of `saves.ts`, add a fixture of the previous version to
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
  `seaLevel`, `generator`, `yaw`, `pitch`, `mode`, `onGround`, `wet`, `breath`, `pixelRatio`,
  `ready` (world loaded, play enabled), `count()` (non-air blocks in loaded chunks), `stream()`
  (loaded/lit/meshed/visible counts, draw calls, worker time per lighting job, the last relight's
  cost), `chunk(cx, cz)` (one chunk's streaming state, lit or not, its non-empty sections, mesh
  versions per section, triangles per pass), `light(x, y, z)` ([skylight, block light]),
  `verifyLight(cx, cz)` (cells that differ from a fresh lighting), `time` (the world clock, days)
  and `setTime(t)` (time of day today, 0–1), `water()` (pending updates, ticks, the last tick's
  changes and time), `waterTick()` (run one now), `showWater(on)` (draw the water or not, to time
  it), `setRenderDistance(r)`, `setFancyLeaves(on)` (same as the menu toggle), `getState`,
  `look(yaw, pitch)`, `target()` (the block under the crosshair, with the face hit and its id),
  `tiles` (the tile canvases), `worldId` and `save()`. Keep it working: the browser tests drive the
  game through it; `?seed=123` in the URL gives a fixed world.
- **Tests:** pure modules get unit tests in `tests/` (they run in Node: no DOM, no WebGL). Browser
  tests go through `e2e/game.ts`, which replaces the page's clock, `requestAnimationFrame` and
  `Math.random` so the game only advances when a test calls `ticks()`: wait for game state in frames
  (`until`, or `settle` for streaming to finish), never in wall time, and read pixels with `capture`
  (the 3D view, without the HUD). `fingers` puts several fingers on the screen at once (joystick and
  JUMP together, as on a phone). `frameMs` times frames with the real clock, GPU included; compare
  timings within one run (taking turns), never against fixed numbers. Every browser test checks that
  the console stayed free of errors and warnings.
- `vite.config.ts` uses `base: './'` so the build works under the Pages sub-path. Keep asset
  references relative.

## Roadmap

Ideas, roughly in priority order. Nothing here is committed to.

1. **More automated checks:** trees across chunk borders, streaming and unloading while the player
   moves, autosave timing; screenshot comparisons to catch changes in the look.
2. **Saves:** rename worlds, export/import a world as a file, guard against two tabs writing the same
   world.
3. **PWA:** web app manifest + service worker for home-screen install and offline play.
4. **Health:** hearts, fall damage, and drowning: `player.breath` already counts the seconds of air
   left under water (15), but nothing shows or uses it yet.
5. **Faster meshing:** greedy meshing (fewer vertices), smarter job cancellation when the player
   moves fast.
6. **More content:** more block types (flowers, ores), a block-picker inventory instead of an ever
   longer hotbar, buckets (water is a creative-style hotbar item for now).
7. **Audio:** break/place/footstep/splash sounds generated with Web Audio (keeps the no-assets
   approach); `playSound` in `audio.ts` is already called where a splash should sound.
8. **Settings:** look sensitivity, invert-Y, FOV, render-quality toggle.
9. **Three.js upgrade:** move to a current release and retune colours (`outputColorSpace`, texture
   `colorSpace`) so the look matches the r128 version.
