# Voxel Island

A small, mobile-first voxel sandbox (think pocket Minecraft) built with Three.js, TypeScript and
Vite. The world is a 512×512×128-block archipelago generated from a seed, stored as 32×32 chunks of
16×16 columns (full height), each made of 8 sections of 16×16×16 blocks. Chunks stream in and out
around the player; generation, lighting and meshing (a section at a time) run in Web Workers, and
each chunk draws in at most two calls (opaque, cutout) plus a share of one for its water
(translucent, drawn 4×4 chunks at a time). A world keeps the generator that made it: new worlds
are islands of 14 biomes (meadows, forests, snowy peaks, deserts, badlands, jungles, swamps, a
volcano, three kinds of ocean…) with the sea at y = 48, whose grass, leaves and water take their
biome's colours; worlds made before the world grew taller keep the first generator (sea at y = 20)
so their ground never shifts. You walk around with an on-screen joystick, look by dragging, and
break/place 61 block types (glass, torches, ice, ores, a glowing crystal, plants, presents, candy canes and Christmas decorations among them), any
of them put in the hotbar from a creative block picker. Worlds are save files in IndexedDB: edited chunks
plus the player state and hotbar, picked
from a list on the start card. The sea and inland lakes are water blocks, and snow falls in snowy places (or
everywhere, a menu setting). Mid-range Android phones in
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
switch mode, 1–9, 0 and − pick a hotbar slot, mouse wheel over the hotbar scrolls it, B opens the
block picker).

## Structure

```
index.html           Markup for the HUD and start screen; loads src/style.css and src/main.ts
src/
  main.ts            Boot: pick the world, renderer, scene, wiring of all modules, view distance, autosave triggers,
                     biome teleport, the haze (biomes', winter's), the Snow setting, resize, frame loop, window.__voxel
  config.ts          Chunk size, world size (chunks/blocks), height, sections, player & physics constants, sky colours
  blocks.ts          Block registry (B): ids, tiles, solid/opaque/renderPass/light/model/slippery/support/waterlog
                     flags, lookup tables, faceHidden() culling rule, waterState (waterlogged plants), HOTBAR (a new
                     world's), PICKER (the picker's tabs), rotatable tiles
  noise.ts           Seeded hash2/hash3, mulberry PRNG, value noise (2D and 3D), fbm (all take the seed); urlSeed()
  textures.ts        Procedural 32×32 pixel-art tile painters (animated water: frames; paintTile, pure) → canvases, CanvasTextures,
                     RGBA tile texture array (grass, leaves, water turned grey), the biome tint map (setTints),
                     chunk materials per render pass (the water shader, tints), setUnderwater
  shading.ts         Light → brightness: shared light uniforms (daylight, sky tint, floor, Brightness, flicker
                     time), the chunk shader's light code, lightColor() for CPU-lit things
  torch.ts           Torch facing (block state), support offsets, hit boxes, the stick-and-flame model (pure)
  plants.ts          Blocks that aren't cubes (pure): plant offsets, hit boxes (blockBox), flat blocks' state (flatWall,
                     flatTurn, flatTurnFor), what holds a block up (holds) and popping what nothing holds any more
                     (popUnsupported)
  light.ts           Skylight + block light (pure): lighting a chunk from scratch (worker), relightMany() after edits
  water.ts           Flowing water (main thread): ticks, updates only where something disturbed it, the flow rules,
                     pending updates for saving
  mipmaps.ts         Coverage-preserving mip levels + colour bleeding for cutout tiles (pure)
  fog.ts             Radial-fog shader patch for built-in materials
  snow.ts            Falling snow, the pure part: the Snow setting (Off/Auto/On → how hard it snows), where flakes
                     stop in a column (ceiling), the cover grid of ceilings round the camera (wraps round, updated
                     a column or a chunk at a time), the flakes' layout, the winter haze
  weather.ts         Falling snow, drawn: one Points draw call moved by its vertex shader round the camera, hidden
                     under cover (the cover grid as a texture), lit by the time of day, fogged
  gen.ts             World generators by version (generator(v): sea level, cloud height, prepare, generateChunk(seed,
                     cx, cz), findSpawn, surfaceHeight); GENERATOR_VERSION for new worlds; generator 2: landforms
                     per biome shape, column2 (blended, then the coast: cliffs, sea stacks, arches), overhangs,
                     the blocks top down (rock faces, snow line, terracotta bands, crater), sea ice, trees
  caves.ts           Generator 2's underground (pure): the cave network per seed (worm tunnels, caverns under the
                     islands, hillside entrances) filed by chunk, carving that never reaches water, glow crystals on
                     deep caverns' walls, ore veins
  biomes.ts          Generator 2's biomes (pure): the BIOMES table (data), the islands and their climate, coast()
                     (distance from the coast), the coarse biome map, weights() (blending), findBiome (teleport),
                     tintMap (grass/foliage/water colours over the world); how hard it snows in each (snowfall)
  gen1.ts            Generator 1, FROZEN (worlds made before generator versions): columnHeight, waterLevel (sea,
                     lakes), layering, trees, generateChunk, findSpawn; floodSea (old saves get the sea)
  worker.ts          Web Worker entry: runs generateChunk (timing the seed's prepare on its own), lightChunk and
                     meshSection off the main thread
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
                     render pass (face culling, baked face shading, AO, smooth light, tile layer; cube, torch,
                     liquid, cross, inset and flat models: water surfaces shaped by their neighbours, flat ones
                     merged, waterlogged plants with their water); spliceSections
  meshing.ts         paddedCopy (chunk + 1-block border: blocks, light or state), mesher output → BufferGeometry;
                     boxesGeometry
  environment.ts     Sky (gradient + sunset glow shader), sun, moon, stars, the sea beyond the world's edge, clouds
                     around the camera, all following the time of day (setTime); fog + underwater look; daylight,
                     sky tint and the sky colour water reflects; the haze and the softer fog where it snows (setHaze)
  effects.ts         Target outline (around a block or a torch's hit box), placement ghost, block-break particles,
                     splashes (the last three lit like the spot they're at)
  player.ts          Player state (P, V, yaw/pitch, how wet, breath), AABB collision, movement physics (sliding on
                     ice, slowed by what they're in), swimming, auto-jump, aim(); playerEvents (splash, touch: the
                     hook for damage)
  audio.ts           Sound hooks (playSound), silent until the game has audio
  interact.ts        Break/place logic (act; torch and vine facing, plants in water, what makes way) and target
                     highlighting (updateTarget)
  input.ts           Touch joystick / look / buttons / hotbar swipes / block picker (taps, swipes), mouse + keyboard
                     fallback, gesture blocking
  ui.ts              HUD DOM: toast, mode button, hotbar (scrolls sideways; the world's blocks), block picker (tabs,
                     search, 3D block icons), menu (view distance, Fancy leaves,
                     Brightness, Snow, Day length, Always day, clock, Teleport to a biome, save & exit), fullscreen, start
                     screen + world list, error display
  style.css          All styles
tests/               Unit tests of the pure modules (Vitest): registry + face culling, tiles (painted in Node: every
                     approved tile unchanged, how the Christmas tiles look), plants (popping off when unsupported,
                     every Christmas decoration in every state, curtains of vines only, hit boxes, offsets, turning
                     the way the player looks), light (spreading, removal, chunk borders, incremental = fresh,
                     single and batched, high up, the star and fairy lights), mesher (water surfaces too, lily pads
                     and vines unchanged, paw prints turned by their state, the star at full brightness),
                     sections (meshing, splicing, counts, light worked out only as high as needed, water falling
                     through them), torch geometry, save format + migration, RLE, mipmaps, generation (generator
                     1's fingerprints, determinism, sea fill, lakes that hold), biomes (data, every biome in 3 of
                     5 seeds' worlds, one or two per island, cold never next to hot, borders no steeper than the
                     ground inside, teleport targets, smooth tints; generator 2 deterministic and continuous
                     across chunk borders, trees over them), terrain (two whole worlds: peaks to y 120 with snow
                     and rock faces, terraced mesas with all six bands, dunes, swamp pools, the crater, trenches,
                     sandbars, cliffs and beaches, stacks and arches, overhangs, caves with hillside entrances,
                     no cave touching water, a cave carved alike across chunk and section borders, ore veins at
                     their depths, crystals only on deep caverns' walls), flowing water (spreading, falling,
                     draining, infinite sources, chunk borders, saved updates), sliding on ice (and puzzle ice), swimming physics (sinking,
                     swimming up, bobbing, braking, climbing out), snow (the setting, snowfall only in the
                     snowy biomes, where flakes stop, the cover grid after any moves = a fresh one, edits and
                     chunk loads, wrapping round, the flakes' layout, the winter haze)
e2e/                 Browser tests (Playwright, phone emulation): game.ts drives the game (deterministic clock,
                     aiming, taps, joystick, several fingers at once, pixel captures, frame timing); see-through
                     blocks, torches, hotbar, the block picker (tabs, search, a swipe scrolls it, a tap fills the
                     slot, kept with the world), Fancy leaves, old saves (keeping generator 1), time of day (midday/sunset/midnight
                     screenshots, torchlight, frame time at night), water (a channel dug from the sea fills, a
                     lake swum across and climbed out of by touch, underwater screenshots by day, deep down and
                     at night, frame time looking out to sea, flow carrying on after a reload), biomes (the menu
                     teleport by touch, then every biome pictured from the air; generation time per chunk), the
                     Christmas blocks (their tab by touch, in portrait too, placed and broken; by day, at sunset
                     and at night, each the colour it should be, frosted glass half see-through), the Christmas
                     decorations (a bauble hung under leaves, the star on a tree, paw prints the way you look,
                     things on a wall, each broken by its own hit box and popping off with its support; a
                     decorated tree by day and at night, the star and fairy lights glowing, a paw-print trail),
                     snow (the menu setting by touch and kept after a reload, Auto in the Snowy Peaks, Taiga and
                     desert; none under a glass roof, there once it's gone, none under water; screenshots by
                     day and at night, the flakes dimmer at night; frame time at night with and without it)
docs/                Pictures for pull requests (not part of the game); CHRISTMAS_PLAN.md (the current plan) and
                     CHRISTMAS_PROMPTS.md (one prompt per session for it)
vitest.config.ts, playwright.config.ts
.github/workflows/deploy.yml   Unit tests + build + deploy to GitHub Pages on every push
.github/workflows/e2e.yml      Browser tests on every push; the report (with the screenshots) is a run artifact
```

Data flow per frame (`main.ts` → `frame`): `readControls()` → `player.update()` (only once the chunks
under the player are loaded) → `water.update()` (a tick every 0.2 s) → camera → `streamer.update()`
(apply finished meshes, unload, start worker jobs, rebuild water groups) → `updateTarget` →
particles → environment → render. Edits go `world.setBlock` → `world.onChange`, which tells the
water (`water.blockChanged`: schedule the water in and next to the block) and collects the change;
a microtask then pops whatever the changed blocks held up that nothing holds any more
(`popUnsupported`: torches, plants, and what those held up) and hands all the changes made together
(one action, one tick of water, the popping) to `streamer.blocksChanged`, which relights around them
on the spot and re-meshes the touched chunks (neighbours too, for borders) and every chunk whose
light changed, ahead of everything else.

## Conventions

- **Three.js is pinned to exactly `0.128.0`** (with `@types/three@0.128.0`). That's the version the
  original single-file game loaded from a CDN. Newer releases change colour management and lighting
  defaults (r152+), which would visibly change every colour. Upgrading is a deliberate roadmap item,
  not a drive-by bump.
- **Generation is a pure function of (seed, chunkX, chunkZ).** Every block a generator makes comes
  from hashes/noise of the seed and *world* coordinates — no `Math.random`, no shared PRNG state, no
  trig, `pow` or `exp` (engines may round them differently; `Math.sqrt` is exact) — so a chunk is
  identical whichever order chunks are generated in, on any thread. What chunks share is worked out
  once per seed and thread and kept (the islands, the biome map, the cave network, the terracotta
  bands, sea stacks): caches of pure functions, never state. Anything that reaches over a chunk
  border is made by both chunks alike: trees use one candidate per 6×6 cell and a chunk stamps every
  tree whose canopy reaches into it, caves are filed under every chunk they touch, and a chunk walks
  the ore veins started in its 8 neighbours too, keeping the blocks that land in it.
- **Generator versions** (`gen.ts`): a world record keeps the `generatorVersion` that made it, and
  its unexplored chunks always come from that generator (`generator(v)`: also its sea level, cloud
  height, spawn), so the ground never shifts next to what a save holds. Generator 1 (`gen1.ts`) is
  every world made before versions existed — the first archipelago, written for a 64-high world
  with the sea at y = 20; in today's chunks it is air above y = 64. It is **frozen**: don't change
  anything that reaches its output (`tests/gen.test.ts` checks fingerprints of its chunks). New
  worlds get `GENERATOR_VERSION` (2, sea level 48). Changing generator 2 changes the unexplored
  ground of every world made with it — fine while it is new; once worlds depend on it, a change that
  moves terrain is a new version. That includes `biomes.ts`: the islands, the biome map and the
  `BIOMES` table are all part of generator 2's output.
- **Biomes** (`biomes.ts`, generator 2 on). *The archipelago:* one island per cell of a jittered 5×5
  grid inside a 40-block band of open sea (a few cells stay open sea), each a warped, skewed ellipse
  with bays; the middle one is the start island (Meadow and Forest). `coast(seed, x, z).t` is how far
  a column is from the nearest coast in blocks (positive inland, negative at sea) — the
  continentalness every landform is built on. *Climate:* `temperature` (colder toward the north, −z,
  with slow wobbles) and `humidity` (noise). Each island takes the climate of its middle;
  `islands()` ranks them by temperature into cold, mild and hot thirds and by humidity (and size)
  within each, and gives each a `primary` and a `secondary` biome (the secondary in patches, round
  its peaks or on its coast), so every world has every biome, an island has one or two, and
  neighbours make sense (no snow next to desert). The sea is Frozen Ocean where it is cold, Warm
  Reef Ocean near hot coasts and Deep Ocean elsewhere. *The biome map:* one biome per `CELL` (4)
  blocks square, `GN` × `GN` (128 × 128) cells, worked out once per seed and thread (`biomeMap`; a
  worker's first chunk pays for it, which is the worst case in the generation timings).
  *A biome is data:* an entry of `BIOMES` (`Biome`; its index is its id, and the teleport list's
  order) with `name`, `ocean`, its landform (`shape`: rolling, hills, peaks, dunes, mesa, marsh or
  volcano; `lift`: how far the ground rises above the coast inland, `amp` and `freq`: how much more
  and how often; `depth` and `seaShape`, plain, trench or bars: its sea floor; `cliffChance`: how
  likely its islands have sea cliffs; `overhang`: how far its slopes lean out), its blocks top down
  (`top`, `fill` `fillDepth` deep, `under` `underDepth` deep — sandstone under the desert's sand,
  terracotta under the badlands' red sand — then stone; `bed` under water, `shore` where the land
  meets the sea; `patch` on `patchAmount` of its ground in noise patches: podzol in the taiga, mud in
  the swamp, clay on the sea floor; `cliff`: what its steep faces show; `bands`: terracotta in bands
  by height instead of `under` and on faces; `snowLine`: snow on its ground above that height),
  `freeze` (how much of its sea's surface is ice floes: the frozen ocean's), its tints (`grass`, `foliage`, `water`: absolute 0xRRGGBB colours),
  `haze` and `hazeAmount` (what the fog and sky lean toward there), `snowfall` (how hard it snows there
  with the Snow setting on Auto, 0–1: Snowy Peaks 1, Frozen Ocean 0.85, Taiga 0.7; nothing generated
  reads it) and `decorations` (names of what
  grows on it: `oak` and `oak-sparse` trees for now; part 2 fills in the rest). Fields left out take
  `BASE`'s values (grass on dirt, a sandy bed and shore). *Blending:* `weights(seed, x, z, out)`
  weighs the cells within `BLEND` (8) blocks with a smooth kernel; a column's height (`column2` in
  `gen.ts`) is the weighted mix of the biomes' landforms, which all meet sea level at the coast, so a
  border never makes a cliff of its own (a test checks that a border is never steeper than the
  ground inside a biome); its blocks are the heaviest biome's, dithered with the next one's near a
  border. *Tints:* grass, leaves and water tiles are grey in the tile array (`GREY` 0.78 bright on
  average; hotbar icons keep their painted colours) and take their colour per vertex from the tint
  map (`tintMap(seed)` → `setTints`: a `GN` × `GN` texture array with a layer per kind, each texel
  the average of the biomes within 2 cells, sampled linearly by world x/z in the vertex shader; the
  `tileKinds` uniform, `TILE_KIND`, says which layer a tile takes, if any). The grass side's alpha marks its grass
  texels, the only ones the tint touches. Worlds without biomes (generator 1) keep `CLASSIC_TINTS`
  (the colours the tiles were painted) everywhere, so they look as they always did. *Haze:* every 6
  frames `main.ts` weighs the biomes around the camera (`climate`) and `env.setHaze` eases the fog and
  sky toward their haze colour (darkened with the sky at dusk and night); where it snows, winter's
  haze is mixed in (see Snow). *Teleport* (menu → Teleport,
  `__voxel.teleport(id)`): `findBiome` finds the nearest cell well inside the biome (its 8
  neighbours the same), and the player lands on its ground or afloat on its sea.
- **Generator 2's ground** (`gen.ts`). *Landforms* (`landform`, by the biome's `shape`; t is the
  coast distance, everything rises from sea level at the coast): rolling country (fbm), hills
  (sharpened fbm: the jungle), peaks (warped ridged noise, squared, rising over 26 blocks inland: up
  to the cap at y = 120), dunes (asymmetric ridges across a per-world wind, one of 8 rational
  directions), mesa (a plateau mask, the height floored to 4-block terraces), marsh (barely above the
  sea, pools sunk below it), volcano (a concave cone round its island's middle, a crater inside
  `CRATER`); offshore the sea floor sinks over `SHELF` blocks to the biome's depth, with trenches
  (deep ocean: ridged lines, at least y = 6) or sandbars (warm reef, some just above the water).
  *The coast* (`column2`, after blending): islands with `cliff` > 0 rise by that much within 2.5
  blocks of the coast where the local biomes have cliffs (none in swamps, deserts, on beaches), deep
  water at their foot; sea stacks stand in cells of 11 blocks 4–18 blocks off them (`stackIn`,
  rock of the island's cliff block, grass on top), and some reach back to the cliff as arches (a
  fin of rock, `lo`…`hi` above the water, its underside an arc). *Overhangs:* above y = S + 2 a
  column whose `lean` > 0 (peaks, the volcano, cliff coasts) is solid where y is below the ground
  height looked up a little to the side — offsets from smooth 3D noise on a 4-block lattice, times
  `lean` (at most 4) — so faces bulge and recede with height; the chunk keeps the ground of 4
  columns round it for that (2 otherwise). *Blocks* (`generateChunk2`): each column top down, a
  block's depth under the open air above it picks it: the sea floor's blocks under water, the shore's
  at the water's edge, the cliff block (or bands) on steep columns (a step of 3+ to a neighbour, 6+
  above the snow line), snow above the snow line (±3), obsidian on a crater floor, the patch or top,
  then fill, under and stone; bedrock at y = 0; the air below sea level is water (sources), and a
  frozen sea's top layer ice floes. Then ore, caves and trees.
- **Underground** (`caves.ts`, generator 2). *The cave network* (`network`, once per seed): worm
  tunnels — in most 32-block cells one, deep down, 60–140 steps of 1.2 blocks, 1.3–2.7 wide,
  turning on smooth noise and mostly level; in some an entrance that sets off uphill into a slope,
  slowly going down — and caverns under the islands of radius 16 or more (one, two under the
  biggest; three ellipsoids at y 12–28, with three tunnels leading off). Every ellipsoid is filed
  under each chunk its box reaches (`fileShape`), and a chunk carves just its own (`carveCaves`).
  *Dry:* caves stay 2 blocks below any water within 2 columns (the chunk's `DRY` limits), so they
  never touch the sea or a pool and can't drain it (a test checks two whole worlds). *Glow crystals*
  grow in patches (3D noise) on rock next to the air of the deep caverns (centre y ≤ 26).
  *Ore veins* (`placeOres`): per chunk and ore, a number of random walks replacing stone — coal 20
  of 12 blocks at y 16–96, copper 8 of 8 at 12–64, iron 7 of 7 at 6–56, gold 2 of 5 at 4–28 — and
  a chunk also walks its neighbours' veins, keeping what lands in it. Timings: `__voxel.stream()`
  reports the worker's time per chunk (`genMs` average, `genMax`) and the seed's preparation
  (`prepMs`: islands, biome map, bands, cave network, once per worker).
- **Other determinism:** clouds come from `mulberry(seed ^ …)`, so the same seed gives the same sky.
  Texture painters share `trand` (fixed seed), so `TILE_PAINTERS` order in `textures.ts` must match
  the `T_*` ids in `blocks.ts`; don't add `trand()` calls in the middle without accepting that every
  texture changes. `tests/textures.test.ts` paints every tile in Node (`paintTile`) and keeps
  fingerprints of every tile approved so far (up to the Christmas cubes'), so a painter inserted in
  the middle fails it; extend it once a milestone's new tiles are approved.
- **Water:** the sea and lakes are `WATER` blocks (not solid, translucent pass, `lightFilter` 2 so
  deep water gets darker, model 'liquid'). Generation fills the air below the sea level
  (`world.seaLevel`, the generator's) with still water (sources); generator 1 also digs lakes into
  inland ground (at most one per 32×32 cell: a bowl filled up to the lowest point of the ground around it, with a
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
  a source (creative-style; buckets come with an inventory). *Waterlogged:* a plant that can sit in
  water (seagrass) carries the `WATERLOGGED` state bit (0x80) there; its block is water too, a source
  — `waterState(id, state)` (and `world.water(x, y, z)`) gives the water in any block, and
  everything that asks about water goes through it: the flow (water flows out of a waterlogged plant,
  never into it; flowing water washes away plants that can't be waterlogged, like torches), swimming
  and the camera, the mesher (it draws the water round the plant as a source, joined to the water
  next to it). Breaking a waterlogged plant leaves its water.
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
  above it; nothing uses it until there is health. Blocks the player is in slow them by their `slow`
  (the slowest one's); touching a block that `hurts` (a cactus) tells `playerEvents.touch(id)` every
  0.5 s — the hook for damage, also unused until there is health.
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
  never change; new blocks get new ids: 0–12 the first blocks, 13–36 the islands' — snow, ice,
  packed ice, sandstone, red sand, terracotta in 6 colours, gravel, clay, podzol, coarse dirt, mud,
  moss, basalt, obsidian, coal/copper/iron/gold ore, glow crystal — 37–41 plants: tall grass,
  seagrass, cactus, lily pad, vines — 42–53 Christmas cubes: presents in 4 colours (`PRESENT` + 0 … 3,
  red, green, gold, pink; `PRESENTS` their names), candy cane and pink candy cane blocks, gingerbread,
  icing, gingerbread with icing, snow bricks, frosted glass, puzzle ice — 54–61 Christmas decorations:
  paw prints, baubles in 3 colours (`BAUBLE` + 0 … 2, pink, red, gold; `BAUBLES`), fairy lights,
  wreath, stocking, star), a name, a tile per face kind
  (sandstone has a top, sides and bottom; basalt and podzol a top and sides; a present a top with a bow
  — also its icon — and sides with a ribbon, a pair of tiles per colour from `T_PRESENT`; gingerbread
  with icing has icing's top, gingerbread's bottom and sides of its own, drips painted down them),
  `solid` (collides), `opaque`
  (blocks light, hides neighbouring faces), `renderPass` ('opaque' | 'cutout' | 'translucent'),
  `lightEmission` (0–15), `lightFilter` (skylight removed: 0 air/glass, 1 leaves, 2 water, 15
  opaque), `model` ('cube' | 'torch' | 'liquid' | 'cross' | 'inset' | 'flat', MODEL: M_CUBE …),
  `cullSame` (two of it hide their shared face: glass, water), `jit` (brightness variation), `icon`
  (hotbar tile), `particle` (tile of the bits that fly off when it breaks), `slippery` (the feet
  barely grip: ice, packed ice and puzzle ice, see player.ts), optional `fastTex` (tiles when meshed as an opaque
  cube: leaves with Fancy leaves off), and for plants (see Plants) `support` ('none' | 'floor' |
  'water' | 'wall' | 'torch' | 'hang'), `stacks`, `waterlog` ('no' | 'can' | 'only'), `replaceable` (building
  there replaces it), `offset` (drawn off the middle of its block), `slow` (× the player's speed in
  it), `hurts` (touching it tells `playerEvents.touch`: the hook for damage) and `turns` (placed facing
  the way the player looks: paw prints).
  `lightEmission` and `lightFilter` drive the light (see Light); `lightFilter` also decides which
  cubes darken AO corners. Ice is a cube in the translucent pass (like water: `lightFilter` 2,
  `cullSame`, no jitter so its top reflects the sky in the water shader, which animates only the
  water's own tiles). The glow crystal is an opaque cube that gives off light 10, and its tile is
  drawn at full brightness (`TILE_KIND` 3 in `textures.ts`: the vertex shader sets its light to 1).
  Frosted glass is glass in everything but its tile (cutout, `cullSame`, `lightFilter` 0): a frosted
  band round a clear window, every texel solid or clear (the cutout pass is alpha-tested), so it
  shows part of what's behind it. Puzzle ice is an opaque cube, a bevelled square to a block so a
  floor of it reads as a grid, `slippery` like packed ice until Milestone 9 gives it the slide. The
  Christmas decorations are plants in how they're drawn and held up (see Plants): their tiles are
  mostly clear, so their `particle` is a solid tile of their colour (paw prints: snow; their `icon` is
  the prints in a square of snow). The star (light 15) and the fairy lights (8) glow: their tiles are
  `TILE_KIND` 3 and they have no jitter. Hot loops use the `Uint8Array` tables
  (`SOLID`, `OPAQUE`, `OCCLUDES`, `TARGETABLE`, `REPLACEABLE` (air, liquids, plants that make way),
  `BUILD_ON` (cubes and the cactus), `SUPPORT`, `LOGGABLE`, …) instead of the objects. Face culling is
  `faceHidden(self, neighbour)`: an opaque neighbour hides a face, so does a same-type neighbour for
  `cullSame` blocks; leaves next to leaves still render unless leaves are meshed as opaque cubes. AO
  corners come from `OCCLUDES` (cubes that dim light: opaque blocks and leaves, not ice).
- **Torches** (`torch.ts`): block state 0 = standing on the block below, 1–4 = on a wall, leaning out
  of it, with the supporting block at −x, +x, −z, +z (`TORCH_SUPPORT`). The state comes from the face
  you build against (`torchStateFor`; never an underside), and the support must be a solid cube.
  Torches aren't solid, nothing builds against them, and the raycast only hits them inside their
  small `torchBox` (rays past the stick reach the block behind). A torch whose support goes pops off
  (`support: 'torch'`, see Plants). The model is built in texels (1/32 block, uv = position
  in the torch tile), tilted 22.5° and turned per state in `TORCH_MODELS`; the mesher copies it into
  the cutout pass (flame and tip full-bright), and the placement ghost uses it too.
- **Plants** (`plants.ts`, the models in `mesher.ts`): *cross* (grass, seagrass, baubles, the star):
  two quads corner to corner `CROSS_IN` in from the block's corners, each seen from both sides (the two
  windings share their 4 vertices), in the cutout pass, lit by the light in their own block, 0.78 as
  bright at the foot (not a block that gives off light: the star), no AO; `offset` plants sit up to 0.2 off the middle by a hash of where they are
  (`plantOffset`, never toward −x/−z out of their chunk: vertex positions are unsigned). *inset* (the
  cactus): a box `INSET` (1/16) in from its block's sides, its top and bottom hidden under more of it
  or an opaque block, flat-lit. *flat* (lily pads, vines, paw prints, fairy lights, wreaths,
  stockings): one quad seen from both sides — state 0 on the floor (`FLAT_UP` above it), or on the
  water's surface for a block held up by water (`ON_WATER` below its own block's floor), turned one
  of four ways by a hash of where it is; states 1–4 against the wall at −x, +x, −z, +z
  (`TORCH_SUPPORT`), `FLAT_OUT` from it; states 5–8 (`FLAT_TURNED` + 0 … 3) on the floor with its
  tile's top toward −z, −x, +z, +x (`FLAT_ROT` in the mesher, the ghost the same): a block that
  `turns` (paw prints) takes `flatTurnFor(player.yaw)`, the nearest of the four to where the player
  looks, however far round the yaw is wound. Read the state with `flatWall` / `flatTurn` (the low 4
  bits; never `& 7`, which would read 8 as 0). Hit boxes (`blockBox`, raycast and outline)
  are small, so a tap past a plant reaches the block behind; a bauble's is round its ball, up to the
  block it hangs from. *Support:* `holds()` — 'floor' needs a solid cube below (or more of itself if
  it `stacks`: the cactus; leaves count, so the star tops a tree), 'water' water below, 'wall' a
  solid cube where its state faces (vines also hang from the same vine above facing the same way:
  curtains; a stocking or a wreath always needs its wall), 'torch' a torch's rule, 'hang' (baubles) a
  solid cube right above (leaves, glass, a present). After every change `popUnsupported` pops what lost its support, and what that held up in turn
  (a waterlogged plant leaves its water). *Placing* (`interact.ts`): a replaceable target (grass,
  seagrass, vines) is replaced where it stands; nothing is built against a torch or a plant; a plant
  placed in water is waterlogged if it can be (`waterlog` 'can'/'only'), refused if not, and a
  water-only plant is refused out of it; a lily pad aims at the water's surface (`aim(true)`). A
  hanging block goes wherever there's a solid cube above the spot (a tap on the underside of leaves;
  against a side too, with a cube above the new spot), else "Hangs under a block". The Christmas
  tab's blocks can't go under water ("Can't go under water"; plants "don't grow" there).
- **Fancy leaves** (menu toggle, default on, saved in localStorage): on, leaves use the see-through
  `T_LEAVES_CUT` tile in the cutout pass; off, `streamer.setOpaqueLeaves(true)` meshes them as opaque
  cubes with the old solid tile (`fastTex`), culled like stone (`faceHidden(…, opaqueLeaves)`).
  Switching re-meshes the chunks with leaves and their neighbours as normal jobs.
- **Snow** (`snow.ts` pure, `weather.ts` draws it). *The setting* (menu → Snow, a stepper OFF / AUTO /
  ON, saved in localStorage as `voxel-island.snow`, default Auto): `snowAmount(setting, here)` is how
  hard it snows, 0–1 — On 1, Off 0, Auto `here`, the `snowfall` of the biomes round the camera by
  weight (worked out every 6 frames with the haze; 0 in worlds without biomes), so it sets in and
  stops at biome borders. The story world will pass `here` = 1 (Milestone 6). The snowfall eases
  toward the amount over 2 s, and the amount is how many of the `FLAKES` (2400) are drawn. *The
  flakes:* one `Points` (a `PointsMaterial` patched in `onBeforeCompile`, `radialFogVertex`), each
  flake a start in the `SNOW_BOX` (36 × 28 × 36 blocks, its bottom 10 below the eye) and a speed,
  sway and size (`flakeLayout`, from the seed); the vertex shader moves it on with its own clock
  (falling 0.9–1.7 blocks/s, swaying, the wind `SNOW_WIND`) and wraps it into the box round the
  camera, so flakes stay put in the world as the camera moves and no CPU work is done per flake.
  Soft round dots (`gl_PointCoord`), smaller far off, none right at the eye, faded toward the box's
  edges; drawn after the water (`renderOrder` 1, no depth writes), `frustumCulled` off. Their colour
  is set every frame: full skylight now (`lightColor(0xf0)`: white by day), but never darker than
  the fog's colour (or they'd look like ash against a sunset) or moonlit snow (`MOONLIT`). *Cover:*
  no snow under a roof, a tree, glass, in a cave or under water — every column has a ceiling, on
  top of its highest block (`world.topY`; at the foot of a plant, torch or flat block so grass
  doesn't stop it in mid-air; the sea's surface past the world's edge; `NO_SNOW` where the chunk
  isn't loaded). The ceilings of the `COVER` × `COVER` (64) columns round the camera are a grid that
  wraps round (`createCover`: a column's cell is x and z modulo 64): moving on works out only the
  columns that came into the window (64 per block crossed), `world.onChange` refreshes an edited
  column and `world.onLoad` a loaded chunk's. The grid is an R8 `DataTexture` with repeat wrapping,
  uploaded on frames when it changed; the shader reads a flake's column and hides it below the
  ceiling, fading it out over the last half block. Under water (the camera) nothing is drawn.
  *Winter atmosphere:* where it snows, `winterHaze` mixes a pale, cold haze (`WINTER_HAZE`,
  `WINTER_AMOUNT` 0.22 at full snow) into the biomes' and `env.setHaze(…, soft)` starts the fog
  nearer (up to half as far: `SOFT`), so a snowy place looks colder and softer, darkening with the
  sky at night as the haze does.
- **Hotbar:** 11 slots of 36 px that scroll sideways when they don't fit (portrait phones). Touches
  that start on `#hotbar` belong to it (`input.ts`), never to the joystick or look zones: a swipe
  scrolls, a tap picks the nearest slot (gaps included). The end with more slots past it fades.
  Each world has its own hotbar (`hud.items`, saved as `WorldRecord.hotbar`; a new world starts with
  `HOTBAR`).
- **Block picker** (`ui.ts`, the ▦ button right of the hotbar, or B): every block but air on a grid
  of big targets (3D icons drawn from the tiles: top and two sides shaded like faces in the world),
  a tab per category (`PICKER` in `blocks.ts`: Natural, Stone, Wood, Plants, Light, Liquids,
  Christmas; every block is on exactly one; in portrait the tabs wrap three to a row, Christmas alone
  on the last) and a search box (any tab clears it). A tap on a block puts it in the
  selected slot and switches to Place; the hotbar stays above the picker (`#hotrow` is over
  `#picker`), so a tap on a slot chooses the next one to fill. Touches on the grid are handled like
  the hotbar's: a tap picks, an up-down swipe scrolls it (`#pgrid` doesn't scroll by itself under the
  gesture blocking). While it is open the controls are still and keys typed in the search box don't
  reach the game. New blocks go on a tab (a unit test checks that every block is on one).
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
  filter) per block. Block light starts at the emitter's `lightEmission` (torch 14, the star 15) and loses max(1,
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
- **Workers only run pure code.** `gen.ts`, `gen1.ts`, `biomes.ts`, `caves.ts`, `light.ts`, `mesher.ts`,
  `torch.ts`, `noise.ts`, `blocks.ts`, `config.ts` are imported by `worker.ts`: no three.js, no DOM, no `world`.
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
  break/place mode, the world clock, generatorVersion, the hotbar's blocks); store `chunks` holds only *edited* chunks
  under `${worldId}:${cx},${cz}` as `{ v, rle, srle?, flow? }`: the block ids run-length encoded,
  plus the per-block state the same way when any of it is non-zero, plus the blocks with pending
  water updates (a chunk with some is saved even if its blocks are as generated). Everything else
  regenerates from the seed with the world's generator (`generatorVersion` in its record; 1 for
  every world made before save version 6). Chunks saved before version 6 are 64 layers high: reading
  them adds a run of air on top (their CI indices, pending water included, stay the same). Chunks
  saved before version 4 had air where the sea is; reading them runs `floodSea` (the air below sea
  level open to the sea becomes water). Worlds saved before version 7 get the fixed hotbar every
  world had (`HOTBAR`), so their selected slot holds the same block. `SAVE_VERSION` is 7; when the stored format changes, bump
  it, note it in the history at the top of `saves.ts`, add a fixture of the previous version to
  `tests/saves.test.ts`, and extend `migrateWorld` / `migrateChunk`, which bring any older record up
  to date every time one is read (a migrated record is written back the next time it is saved). The save is the
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
  cost, chunks generated and the worker's time per chunk: `genMs` on average, `genMax` at most, and
  `prepMs`, the longest a worker took to work out what the seed's chunks share),
  `chunk(cx, cz)` (one chunk's streaming state, lit or not, its non-empty sections, mesh
  versions per section, triangles per pass), `light(x, y, z)` ([skylight, block light]),
  `verifyLight(cx, cz)` (cells that differ from a fresh lighting), `time` (the world clock, days)
  and `setTime(t)` (time of day today, 0–1), `water()` (pending updates, ticks, the last tick's
  changes and time), `waterTick()` (run one now), `showWater(on)` (draw the water or not, to time
  it), `setRenderDistance(r)`, `setFancyLeaves(on)` (same as the menu toggle), `getState`,
  `look(yaw, pitch)`, `target()` (the block under the crosshair, with the face hit and its id),
  `tiles` (the tile canvases), `hotbar()` (the block in each slot), `sel()` (the selected slot),
  `pick(id)` (the picker's tap: that block into the selected slot), `worldId`, `save()`, `biomes` (the biomes' names, by id; empty
  without biomes), `biome()` / `biomeAt(x, z)` (the biome's name there) and `teleport(id)` (the
  menu's Teleport: to the nearest place of that biome; returns how far, −1 if there is none), `snow()` (the
  Snow setting, `here`: how hard the biomes round the camera say it snows, `amount`: how hard it
  snows now, `flakes` drawn, `visible`), `setSnow(s)` ('off' | 'auto' | 'on', as the menu sets it),
  `showSnow(on)` (draw the snow or not, whatever the setting: to time it or compare pictures) and
  `cover(x, z)` (where snow stops in a column near the camera). Keep it working: the browser tests drive the
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

**Current focus: Bentley's Christmas Adventure** — a story mode, due 25 December 2026. The plan,
milestones and story are in [docs/CHRISTMAS_PLAN.md](docs/CHRISTMAS_PLAN.md); work through it one
milestone at a time, and it takes priority over the ideas below.

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
