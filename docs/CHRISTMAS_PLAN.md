# Bentley's Christmas Adventure — build plan

A Christmas 2026 gift for Gabby: a story mode for Voxel Island in which she rescues her pug, Bentley,
across a snowy archipelago on Christmas Eve. No evil mobs, no damage, lots of pink.

This file is the plan for building it with Claude (Opus 5.5) **one milestone per session**. The
engine is already solid (see `CLAUDE.md`); everything here is new content and a thin layer of story
systems on top of it.

---

## How to use this plan

1. Start a fresh session for each milestone. Paste the matching prompt from
   [CHRISTMAS_PROMPTS.md](CHRISTMAS_PROMPTS.md) (or the generic **session prompt** below).
2. Let it plan first and read the plan before it codes. Push back if it wants to touch things the
   milestone doesn't need.
3. When it's done: `npm test`, `npm run build`, then **play it on your phone** (the Pages URL
   rebuilds on every push). The browser tests take a few minutes — let CI run them.
4. Happy with it? Say so in the same session: it ticks the box in the checklist at the bottom,
   merges its branch into `main` and pushes, so the next session starts from it. Not happy? Say
   what's wrong in the same session. Gone badly sideways? Abandon that session's branch (`main`
   only ever holds work you approved) and start the milestone again in a new session with a
   sharper prompt. That's cheaper than untangling.
5. Keep milestones in order: each one builds on the last.

**The Pages URL shows the last push from any branch**, not just `main`. A session's work in
progress is live as soon as it pushes, and Gabby sees it too if she plays there. To put the last
approved build back after a bad push: GitHub → Actions → *Deploy to GitHub Pages* → *Run
workflow* on `main`.

### Session prompt (copy this)

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then implement Milestone <N> only.

- Plan first: list the files you'll change and how, and wait for my OK.
- Follow every convention in CLAUDE.md (mobile first, no image assets, three.js stays 0.128.0,
  generation stays pure, ids never change, save migrations, __voxel kept working).
- Don't change generator 1 or generator 2 output; existing tests must stay green.
- Add unit tests for pure code and a browser test (e2e/) for what the player sees.
- Run npm test, npm run typecheck and npm run build until they pass.
- Update CLAUDE.md (structure, conventions, __voxel, roadmap) for what you added, and tick
  Milestone <N> in the checklist at the bottom of docs/CHRISTMAS_PLAN.md.
- Finish by telling me exactly what to try on my phone to check it.
- Once I say I'm happy with it on my phone, merge the branch into main and push.
```

---

## The story (what we're building)

**Setup.** Christmas Eve on a snowy archipelago. Gabby's cosy cottage on the home island: a tree, a
fire, Bentley snoring on his bed. At dusk, sleigh bells jingle overhead and a sack of presents
spills across the islands. Bentley wakes, snorts, and bolts out of the doorway after the noise. When
Gabby turns round he's gone, and there's a trail of paw prints in the snow.

**Tone.** Bentley isn't kidnapped; there is no villain. He's on a greedy, curious pug adventure,
and each island shows where he's been: half-eaten cookies, a dropped toy, a pug-shaped dent in a
snowdrift. Sweet and funny throughout.

**The core mechanic: follow the snoring.** On every island Gabby can tap **Listen**: Bentley's
snore plays from his direction (louder the closer she is) and a soft paw-print compass shows the
way for a few seconds. Paw-print blocks in the snow mark the path too.

**Chapters** (one island each; each hides one of Bentley's things and has one puzzle):

| # | Island | Find | Puzzle / activity | Teaches |
|---|--------|------|-------------------|---------|
| 0 | Home Island | — | Hang 3 baubles on the tree, wrap a present. Dusk falls, Bentley bolts. | Placing |
| 1 | Snowy Meadow | His **squeaky toy** | Build a bridge over an icy stream; follow paw prints. | Breaking, building |
| 2 | Gingerbread Grove (pink cherry island, candy canes) | His **Christmas jumper** | Snowman Baker lost 4 gingerbread pieces (Bentley scattered them). Find them, bring them back. Follow the cookie crumbs. | Exploring, talking to NPCs |
| 3 | Frozen Lake & Glow Caves | His **collar** | Sliding-ice puzzle on the lake (you slide until you hit something), then a dark cave lit by torches and glow crystals. | Puzzles, light |
| 4 | Starlight Peak | **Bentley!** | Climb the tallest mountain at night and place the Star on the beacon so the sleigh can find its way. Bentley is asleep in the spilled present sack at the top, wrapped in paper, with a reindeer. | — |

**Ending.** Fade to white, sleigh bells: it's Christmas morning at the cottage. Bentley is by the
fire. The presents under the tree are open — except one. Tapping it opens a letter: a personal
message from the person who made this game (text in one file, see Milestone 10). Then the credits,
and **free play** unlocks: the full block picker, the normal day clock, Bentley following her around.

**Bonus.** 12 pink baubles hidden across the islands. Each one found appears on the cottage tree.
All 12 unlocks a bonus line in the letter.

**Story time of day.** The clock is story-controlled until the ending: Chapter 0 afternoon → dusk,
chapters 1–3 a long golden twilight (bright enough on a phone), chapter 4 night (so the Star
matters), the ending morning.

### Bentley's look

A blocky pug: fawn body (warm dark yellow, around `#C8A15A`, a slightly darker back), **black face
mask and muzzle**, black floppy ears, dark round eyes, a little pink tongue when he pants, short
chunky legs, a tight curly tail on top, a wrinkly forehead (a darker stripe or two on the head
texture). Optional: pink Christmas jumper once you find it in Chapter 2 (he wears it from then on).

Personality in animation and sound: snorts, snores, sneezes, tail wag, waddles more than he walks,
flops over to sleep.

---

## Locked design decisions

Decide once, so no session re-litigates them:

- **Story world = its own world type.** The start card gets a **"Bentley's Christmas"** button
  that creates (or continues) the story world. `WorldRecord` gains `story` (story id, e.g.
  `'xmas'`) and `progress` (story flags, found items, baubles, checkpoint). Saving Bentley
  (Milestone 4) bumps `SAVE_VERSION` to 8 and the story world (Milestone 6) to 9, each with a
  migration and a fixture, as CLAUDE.md says.
- **Winter generator = generator 3.** Same machinery as generator 2, but every island takes winter
  biomes (snowy meadow, taiga, snowy peaks, a cherry grove dusted with snow), snow on all open
  ground, a frozen sea. Generator 2's output must not change. The story world uses a **fixed seed**
  chosen for a good layout (start island in the middle, 4 neighbours within reach).
- **Structures are code, not saved files.** The cottage, gingerbread house, snowmen, ice puzzle,
  cave route, beacon tower and so on are pure functions stamped by generator 3 at anchors
  relative to their islands, across chunk borders the same way trees already are. That keeps
  generation pure, needs no level files, and lets Claude build things by writing code. Named
  anchors (`cottage.tree`, `grove.baker`, `peak.beacon`…) are what the story script refers to.
- **The story script is data.** One file (`src/story/script.ts`) holds the chapters, steps,
  triggers and every line of dialogue, so you can edit the words yourself without touching logic.
- **No damage, no health, no hostile mobs** anywhere in story mode.
- **Hotbar in story mode is curated** (snow, planks, ice, torches, Christmas blocks…). The block
  picker unlocks with free play after the ending. Breaking and building always work; puzzles don't
  need to be cheat-proof, they're for fun.
- **Can't get stuck:** the menu has **Back to the path** (to the last checkpoint), and every
  objective shows as one line on the HUD.
- **Everything still works on a phone first**, with no keyboard.
- **Blocks or entities.** Anything that never moves and can be built from cubes is blocks, stamped
  by the structures (Milestone 7): the cottage and its brick fireplace (the hearth glows with glow
  crystals and torches), the Christmas tree, presents, the decorative snowman by the cottage,
  the gingerbread house, candy-cane trees, the beacon tower and **the sleigh** (planks, red and
  gold presents, candy-cane runners; it never moves). Anything that moves, talks, is picked up or
  has a soft round shape blocks can't make is an **entity** (box models, Milestone 3): Bentley;
  the **Snowman Baker** and the **reindeer** (NPCs that animate and talk when tapped); **Bentley's
  bed** and **the present sack** (static props: Bentley curls up in the bed in Chapter 0 and in the
  sack in Chapter 4); and the pickups (squeaky toy, gingerbread pieces, jumper, collar, baubles).
  Generation stays blocks only: the structures export anchors for the props and NPCs
  (`cottage.bed`, `peak.sack`, `peak.reindeer`, `grove.baker`), and the story layer (Milestone 8)
  places the entities there.
- **Generator 3 freezes at the end of Milestone 7.** Until then, a story world made before a
  structures change has seams where its saved (edited) chunks meet regenerated ones, so use
  **Start over** after each change. After the freeze, nothing may move generator 3's blocks
  without a new story world: fine while only you play it, never once Gabby has started.

---

## Milestones

### Milestone 1a — Christmas blocks: the cubes

**Goal:** the festive building materials, in their own picker tab. Only cubes, so nothing new in
the mesher or the support rules.

New blocks (new ids from 42; tiles painted in `textures.ts`, appended per the TILE_PAINTERS rule):

- **Presents**: cubes with a ribbon down the sides and a bow on top (a top tile and a side
  tile), in red, green, gold and **pink**.
- **Candy cane block** (red/white diagonal stripes) and a **pink/white** one.
- **Gingerbread**; **Icing**, a plain white block; and **Gingerbread with icing** for roofs:
  gingerbread with a white top, and drips painted down the top edge of its sides. (Opaque cubes
  ignore alpha, so the drips are painted into the side tile, white over gingerbread.)
- **Snow bricks**, and **frosted glass** in the cutout pass like glass (frosty texels painted in,
  `cullSame`). The translucent pass is the water shader, which would make it reflect the sky.
- **Puzzle ice**, the slide puzzle's floor (Milestone 9 gives it the slide): an opaque cube with
  a clear tile pattern, so the puzzle's squares read at a glance. Until Milestone 9 it is just
  slippery, like packed ice. It is here so that the structures (Milestone 7) can build the arena
  with it.
- A **Christmas** tab in the picker (`PICKER`), with every new block on it.

**Done when:** all of them can be picked, placed and broken on a phone, look right by day and at
night, and the unit test that every block is on a tab still passes.

### Milestone 1b — Christmas blocks: decorations

**Goal:** the blocks that aren't cubes, with the two new rules they need. All on the Christmas
tab.

- **Paw prints**: flat on the floor (like a lily pad on land), not solid, replaceable,
  snow-coloured with prints pressed in, **pointing the way the player looked when placing them**.
  *New rule:* today a flat block on the floor is turned by a hash of where it is
  (`mesher.ts`), and states 1–4 mean a wall. Paw prints keep their direction in their state (for
  example 5–8 = on the floor, turned 0–3). State 0 keeps the hashed turn, so lily pads and vines
  look exactly as before (a mesher test checks it). The structures (Milestone 7) set it for the
  trails.
- **Baubles** in pink, red and gold: a small ball hanging from the block above it (crossed quads
  like the plants, cutout, a small hit box). *New rule:* a `'hang'` support kind: it needs a solid
  cube right above it (leaves count), and pops off when that goes (`holds`, `popUnsupported`).
  Placing: it goes where you build and is refused without a cube above it. Tapping the
  underside of leaves is the natural way, so placing must allow building against an underside
  for hanging blocks (`torchStateFor` refuses undersides today).
- **Fairy lights**: flat on walls like vines, multicolour bulbs, gives off light 8.
- **Wreath** and **stocking**: flat on walls.
- **Star**, the tree topper and the beacon's star: a star-shaped model, crossed quads like the
  plants with a star tile, drawn full-bright (`TILE_KIND` 3, like the glow crystal), gives off
  light 15. It stands on the block below (leaves count, so it tops a tree). If crossed quads turn
  out much harder or look wrong, a full-bright cube is fine.

**Done when:** all of them can be picked, placed (a bauble under leaves, the star on top of a
tree, paw prints pointing the way you look) and broken on a phone. Each pops off when its support
goes, they look right by day and at night (fairy lights and the star glow), and lily pads and
vines are unchanged.

### Milestone 2 — Snowfall and winter atmosphere

**Goal:** it feels like Christmas.

- Falling snow: soft flakes drifting around the camera (one `Points` draw call, cheap, fogged with
  `radialFog`), lit by the time of day, with a gentle sideways drift. Never under a roof, in a cave
  or under water. To check, keep a small grid of the highest block per column around the camera
  (`world.topY`, refreshed as chunks change) rather than looking up the light for every flake each
  frame. Snow stops under any block, glass and trees included, which a skylight test would let
  through.
- Settings: **Snow** in the menu: **On / Off / Auto** (saved in localStorage). Auto, the default,
  means on in snowy biomes (Snowy Peaks, Taiga, Frozen Ocean) and in the story world (Milestone 6
  turns it on there), off elsewhere.
- A slightly colder, softer fog and sky in winter worlds (via the existing haze system).
- Frame-time check at night with snow on (compare in one run, like the other perf tests).

**Done when:** snow falls outdoors, stops under roofs and in caves, and the frame time on a
mid-range phone is about the same.

### Milestone 3 — Creatures, part 1: the entity system and Bentley's model

**Goal:** something alive in the world, and it's Bentley. (Risk first: he's the heart of the game.)

- A small entity system (`src/entities.ts`): a list of entities, each with position, velocity, yaw,
  an AABB, an update and a mesh. Lit like the spot they're in (`lightColor`, every frame, so they
  follow the time of day). Entities in unloaded chunks freeze.
- Physics shared with the player through a small **body** object (position, velocity, half-width,
  height, on the ground). Today `collides` and `moveAxis` in `player.ts` work on the player's `P`,
  `PR` and `PH` only. The player keeps its exports and behaves exactly as before: the player,
  swimming and ice tests stay green unchanged.
- Box-model rendering: cuboids with procedurally painted textures (no image files), parts that can
  rotate (head, legs, tail, ears). Entity skins are their own textures, painted with their own
  seeded PRNG, **not** new `TILE_PAINTERS` entries (that would reshuffle `trand`). One or two draw
  calls per entity: parts posed on the CPU into one geometry, or one group sharing one material,
  not a draw call per part.
- "Z" particles: a new particle kind in `effects.ts` (today's particles are only bits of
  blocks).
- **Bentley's model** (see *Bentley's look*) with animations: idle (breathing, an occasional
  snort-shake), walk (waddle), sit, sleep (lying down, rising "Z" particles), tail wag.
- Debug: `__voxel.bentley` (position, state), `__voxel.spawnBentley()` to put him next to you in
  any world.

**Done when:** `spawnBentley()` puts a recognisable pug next to you, and he animates through all
states (a browser test captures each one).

### Milestone 4 — Creatures, part 2: Bentley follows, swims and gets petted

- Follow: walk toward the player when more than ~3 blocks away, stop within 2, step and jump up
  1-block ledges, swim (paddle, head above water), never walk off a drop of more than 3 blocks if
  he can help it, teleport next to the player when more than ~24 blocks away or stuck for 3 s.
- **Idle**: he sits after about 10 s with the player standing still near him, and falls asleep
  (lying down, Z particles) after about 40 s. He wakes and follows again when she walks away or
  pets him.
- **Pet**: a tap on Bentley **always** pets him: hearts, a happy snort, a wag. Works in break mode
  and place mode, and never breaks or places the block behind him (`interact.ts` checks entities
  before blocks, in `act` and in `updateTarget`).
- **Sit / Come**: a small button, shown when he's close, toggles staying put and following. It
  is a button only, with no double tap (the first tap of a double tap would already pet him).
- Bentley is saved with the world in `WorldRecord` as an optional `bentley` field (absent until
  he's spawned): position, following or staying, asleep or not, wearing the jumper or not.
  `SAVE_VERSION` 8, with a migration and a fixture.

**Done when:** on a phone, Bentley follows you round an island, across water and up hills, comes
when you walk far away, sits and then sleeps when you stand still, stays when told, and you can
pet him.

### Milestone 5 — Sound

All generated with Web Audio (no audio files), filling the existing `playSound` hooks.

- An audio engine (`audio.ts`): one `AudioContext` unlocked by the first tap on Play, a master
  volume, **Sound** and **Music** toggles in the menu (localStorage), positional sounds (a panner
  per source; volume by distance). Today's `playSound(name, volume)` has no position and can't
  loop. Add a positional `playAt(name, x, y, z)` and looping sources with a handle to move or stop
  (the snore), panned and faded relative to the camera every frame.
- Materials: a `sound` field in the block registry (`blocks.ts`: snow, wood, stone, glass,
  plant, …) picks the break, place and footstep sounds. Footsteps need a new hook in `player.ts`
  (`playerEvents.step`, like `splash`).
- Sounds: break and place (by material: snow crunch, wood, stone, glass), footsteps (snow crunch
  on snow), splash, sleigh bells, pickup sparkle, Bentley's **snore** (a looping filtered noise
  with a slow rhythm, positional), **snort**, **sneeze**, **bark**, a happy whine when petted.
- Music: a soft music-box *Jingle Bells* loop (the 1857 tune is public domain), quiet, off by
  default in free play, on in the story.

**Done when:** every action makes a fitting sound, Bentley's snore gets louder as you walk toward
him and pans left/right with headphones, and the game stays silent until the first tap.

### Milestone 6 — Winter generator and the story world

Two sessions: 6a the winter generator, 6b the story world.

- **First, in a commit of its own, before `gen.ts` or `biomes.ts` change:** a generator 2
  fingerprint test, like generator 1's in `tests/gen.test.ts`. None exists yet (the terrain tests
  check properties, not exact blocks), so without it "generator 2 unchanged" can't be proven.
- **Generator 3** in `gen.ts` (see *Locked design decisions*): winter biomes on every island
  (assign them in `biomes.ts` behind a generator flag, leaving generator 2's assignment untouched),
  snow on all open ground, frozen sea with ice floes, the cherry grove pink with snow. Tests:
  deterministic, continuous across chunk borders, generator 1 and 2 fingerprints unchanged.
  - The per-seed caches (`islands` and `biomeMap` in `biomes.ts`, `bands` in `gen.ts`, `network`
    in `caves.ts`, the tint map) are keyed by the seed alone. Key them by seed **and** generator,
    or generators 2 and 3 with the same seed in one thread (the unit tests do this) get each
    other's islands.
  - `biomes.ts`'s functions take only a seed (`islands`, `biomeMap`, `biomeAt`, `weights`,
    `findBiome`, `tintMap`), and `main.ts` calls them for the tints, the haze and teleport. The
    winter switch has to go through all of them.
  - Trees: only oaks exist, and the Taiga has none, so winter islands need snowy spruce-like trees:
    new decoration code in generator 3. The Cherry Grove biome exists already and is pink from its
    foliage tint. "Dusted with snow" means snow blocks on the canopy tops and the ground (a tint
    can't do it).
- Pick the **story seed**: a script/test that lists seeds whose start island has 4 neighbouring
  islands within ~120 blocks, one of them big enough for Starlight Peak. Hard-code the chosen
  one. (The start island is always the middle cell of the 5×5 island grid, and neighbours are
  about 86 blocks apart, so the search is really about which neighbours exist and their size and
  shape.)
- **Story world**: `WorldRecord.story` + `progress`, `SAVE_VERSION` 9 (migration + fixture), a
  "Bentley's Christmas" button on the start card (one story world; "Continue" if it exists,
  "Start over" with a confirm). It is **not** in the free-build world list, only behind the
  button. A curated story hotbar of exactly 11 blocks (the hotbar's size), with the picker hidden
  until free play.
- Story-controlled clock: the story sets the time of day; the normal clock is paused until free
  play, and the Day length and Always day settings are hidden in the story world until then.

**Done when:** "Bentley's Christmas" opens a snowy archipelago from the fixed seed, every island is
wintry, normal new worlds are unchanged, and old saves still load.

### Milestone 7 — Structures

Pure stamping functions (`src/story/structures.ts`) placed by generator 3 at anchors relative to
their islands, each a function of world coordinates only (no randomness except seeded hashes).
Two sessions: 7a the system, Home Island and the Snowy Meadow; 7b the rest.

- **First, in a commit of its own with a unit test: generated chunks carry block state.** Today
  `generateChunk` returns block ids only, and the streamer gives a generated chunk no state
  (`streaming.ts`; CLAUDE.md: "generated terrain never has any"). Structures need state for wall
  torches, fairy lights, wreaths, stockings and the paw prints' direction. Let a generator return
  an optional state array and carry it through the worker message, the streamer and
  `world.setChunk`. Generators 1 and 2 return none, so their fingerprints don't change. Saves are
  unaffected: unedited chunks regenerate, and edited ones already save their state.
- **Home Island:** Gabby's cottage (snow-roofed, a doorway, window light, a brick fireplace with a
  glowing hearth, a Christmas tree with empty spots for baubles under its leaves, presents under
  it, fairy lights, a wreath), a snowman made of blocks, a path of paw prints out of the doorway
  toward the meadow. Anchor `cottage.bed` by the fire for Bentley's bed (an entity, Milestone 8).
  There's no door block: the doorway is a gap.
- **Snowy Meadow:** an icy stream with a gap to bridge, paw prints, a dropped squeaky toy spot.
- **Gingerbread Grove:** the Snowman Baker's half-built gingerbread house (candy canes, icing),
  candy-cane trees, a cookie-crumb trail, 4 hidden spots for gingerbread pieces. Anchor
  `grove.baker`.
- **Frozen Lake:** the slide puzzle arena, built of the puzzle ice block (Milestone 1a) and rocks
  (see Milestone 9), and the cave entrance down to the glow caves; the collar spot.
- **Starlight Peak:** a path up the mountain (a few steps cut into it, ledges), the beacon tower at
  the top, the sleigh built of blocks, and anchors `peak.sack` and `peak.reindeer` for the present
  sack and the reindeer (entities, Milestone 8), with spilled present blocks round the sack.
- 12 hidden bauble spots spread over the islands.
- Which things are blocks and which are entities: see *Locked design decisions*. This milestone
  stamps only blocks.
- Named anchors exported for the story script. `__voxel.goto(anchor)` teleports there (dev only).
- Browser test: a screenshot from each anchor.
- **Generator 3 freezes when this milestone is done** (see *Locked design decisions*). While you
  work on it, use Start over on the story world after every structures change.

**Done when:** you can `goto` every anchor and each place looks hand-built and Christmassy.

### Milestone 8 — Story engine, dialogue and pickups

- **Script format** (`src/story/script.ts`, data only), roughly:

  ```ts
  { id: 'tree', chapter: 0, objective: 'Hang 3 baubles on the tree',
    trigger: { place: { blocks: [BAUBLE_PINK, BAUBLE_RED, BAUBLE_GOLD], near: 'cottage.tree', count: 3 } },
    say: [{ who: 'Gabby', text: 'Perfect. Bentley, what do you think?' }, { who: 'Bentley', text: '*snoooore*' }],
    then: 'dusk', checkpoint: 'cottage.door' }
  ```

  Trigger kinds: enter an area near an anchor, pick up an item, place a block near an anchor,
  talk to an NPC, a custom one for puzzles. Effects: dialogue, set the time of day, give items,
  move Bentley, set the Listen target, play a sound, fade.
  - The **place** trigger hooks the player's own placements in `interact.ts` (`act`), not
    `world.onChange`, which also fires for flowing water, blocks popping off and the story's own
    edits.
  - There is no inventory: **give** puts a block into the story hotbar (the Star, more baubles).
    Story items found (toy, jumper, collar, baubles) are flags in `progress`, shown in the found
    strip.
- **Story runner** (`src/story/runner.ts`): tracks the current step, checks triggers each frame
  (cheaply), applies effects, saves progress in `WorldRecord.progress`.
- **Dialogue box**: bottom of the screen, name + text, tap to continue, pink trim; controls pause
  while it's open.
- **HUD**: the objective line at the top, a **found** strip (toy, jumper, collar, baubles x/12),
  the **Listen** button (snore toward the target + a paw compass for 3 s), menu → **Back to the
  path**.
- **Pickups**: story items as entities (floating, slowly spinning, sparkling, a chime on pickup).
  Taken ones are remembered in `progress`, not respawned.
- **NPCs**: a static entity type with a box model and dialogue on tap (the Snowman Baker; a
  reindeer). A tap on an NPC talks, like a tap on Bentley pets: never the block behind.
- **Props**: static box-model entities with no dialogue: Bentley's bed and the present sack.
  Props and NPCs are placed at their structure anchors (`cottage.bed`, `peak.sack`,
  `peak.reindeer`, `grove.baker`) by the story layer, not by the generator.
- **Baubles on the cottage tree**: each bauble found is set as a block under the tree's leaves by
  the runner once the tree's chunk is loaded, so it is saved like any other edit.
- Debug: `__voxel.story()` (step, flags), `__voxel.storyJump(stepId)` to test any chapter.

**Done when:** a two-step test script (walk somewhere → dialogue → pick something up → next step)
runs end to end in a browser test, survives a reload, and Listen points the right way.

### Milestone 9 — Chapters 0 to 3

Write the real script and wire the puzzles:

- **Chapter 0**: tutorial lines, baubles on the tree, wrapping a present (place a present block
  under the tree), dusk, sleigh bells, Bentley runs out (he runs off down the path and despawns
  out of sight), the empty doorway and his paw prints in the snow.
- **Chapter 1**: follow the paw prints, bridge the stream, find the squeaky toy (it squeaks).
- **Chapter 2**: meet the Snowman Baker, find the 4 gingerbread pieces (cookie trail + Listen),
  bring them back; the baker finishes the house and gives you Bentley's jumper.
- **Chapter 3**: the **puzzle ice** block (it exists since Milestone 1a; this gives it the slide).
  Standing on it, you slide in the direction you push (the joystick's main axis) at a fixed speed
  until you hit something solid or reach normal ground. The slide is a new movement state in
  `player.ts`; the ice and swimming tests stay green.
  Then the cave: dark, torches in the hotbar, glow crystals, follow the snoring to the collar.
- Each chapter ends with a short dialogue and sets a checkpoint.

**Done when:** you can play from a new story world to the end of Chapter 3 on a phone without
getting lost or stuck. Add a browser test that plays the slide puzzle by touch.

### Milestone 10 — Chapter 4 and the ending

- **Chapter 4**: night falls. Climb Starlight Peak (Bentley's snoring from the top), place the Star
  on the beacon → the sky lights up, sleigh bells, the reindeer appears, and there's Bentley asleep
  in the present sack. A reunion: he wakes, sneezes, runs to Gabby, hearts everywhere.
- **Ending**: fade to white → Christmas morning at the cottage, Bentley by the fire in his jumper,
  presents open, one left. Tap it → full-screen **letter** with a gentle pink-and-snow frame.
- **The letter** lives in `src/story/letter.ts` (plain text, with a bonus paragraph for finding all
  12 baubles). **See "Keeping it a secret" below before you put the real words in.**
- **Credits**: a short roll ("Made with love for Gabby by …", "Starring Bentley").
- **Free play** unlocks: picker, normal clock, Bentley follows, the story menu offers "Replay the
  ending".

**Done when:** the whole story plays through to the letter and free play, and `storyJump` to
Chapter 4 works for testing.

### Milestone 11 — Gift wrapping

- **Title screen**: snowy, "Bentley's Christmas Adventure" in a friendly font (bundled, no network
  requests), Bentley asleep on the title card, pink accents, the story button first, "Free build"
  second.
- **Pink theme** across the HUD and menus (buttons, hotbar selection, dialogue box).
- **The font** comes from an npm `@fontsource` package (openly licensed) and is bundled by Vite:
  no network request.
- **Install on her home screen (PWA)**: web app manifest (name "Bentley's Christmas", pink theme
  colour), icons (a Bentley face, painted procedurally and rendered to PNGs at build time by a
  script, so the repo still has no hand-made image assets), a service worker for offline play.
  - The icons can't use `textures.ts`'s painters, which need a DOM canvas that Node doesn't have.
    Paint into a plain pixel array with pure code, and write the PNGs with a Node script that
    uses only Node's own `zlib` (no new dependencies). It runs as part of `npm run build`, so
    `deploy.yml` makes them.
  - The service worker goes **network first for the page** (`index.html`) and cache first for the
    hashed assets, so a new deploy shows up on the next load whenever she's online. The browser
    tests block service workers (`serviceWorkers: 'block'` in `playwright.config.ts`).
- Loading feel: a short "Fetching Bentley…" while the world streams in.

**Done when:** on an Android phone, "Add to Home screen" gives a Bentley icon that opens the game
full screen and works offline.

### Milestone 12 — Full playthrough, polish and freeze

- A browser test that plays the **entire story** through `__voxel` + touch (jumping between
  checkpoints where walking would be slow), checking every step fires, and no console errors.
- Fix anything confusing from your own playthroughs: unclear objectives, Listen too vague, Bentley
  stuck, too dark, too long.
- Performance pass on a mid-range Android: snow, entities, lights at night.
- **Freeze on 20 December.** After that, only bug fixes.

---

## Calendar (12 Oct → 25 Dec, about 10 weeks)

| Week | Dates | Milestones |
|------|-------|------------|
| 1 | 12–18 Oct | 1a Christmas cubes, 1b Christmas decorations, 2 Snowfall |
| 2 | 19–25 Oct | 3 Entities + Bentley's model |
| 3 | 26 Oct–1 Nov | 4 Bentley follows + petting |
| 4 | 2–8 Nov | 5 Sound |
| 5 | 9–15 Nov | 6 Winter generator + story world |
| 6 | 16–22 Nov | 7 Structures → **generator 3 frozen** |
| 7 | 23–29 Nov | 8 Story engine |
| 8 | 30 Nov–6 Dec | 9 Chapters 0–3 |
| 9 | 7–13 Dec | 10 Chapter 4 + ending |
| 10 | 14–20 Dec | 11 Gift wrapping, 12 Polish → **freeze 20 Dec** |
| — | 21–24 Dec | Buffer. Play it start to finish twice. Install it on her phone or plan the reveal. |

**If you fall behind, cut in this order:** the bonus baubles → the music → Chapter 3's cave (keep
the ice puzzle) → the PWA (just send her the link) → merge Chapters 1 and 2 into one island. Never
cut: Bentley, Listen/snoring, the ending letter.

---

## Things only you can provide

Fill these in as you go; drop them into the script and letter files:

- [ ] Bentley's real habits and quirks (stealing socks? hates rain? a favourite toy or food?).
      Each one can become a clue, a line of dialogue or a joke.
- [ ] Places or memories you share (first date, a trip, an in-joke) for signs, island names or
      the Snowman Baker's lines.
- [ ] What Gabby calls Bentley (nicknames) and what he's like when he's happy.
- [ ] The letter.
- [ ] What happens in real life after the letter (a clue to the real present?).
- [ ] Your name for the credits.

## Keeping it a secret

- The repo is **public** and every push deploys to the **public** Pages URL. Anyone with the link
  can play the work in progress, and anyone can read the code, including `letter.ts`.
- Keep a placeholder letter until the last few days, and add the real one just before you give it
  to her. Or move the project to a private repo and host it somewhere that serves private repos
  for free (Cloudflare Pages or Netlify), so it's never public at all.
- If Gabby already plays Voxel Island at that URL, she'll see each update as it's pushed.

---

## Checklist

- [x] Milestone 1a — Christmas blocks: the cubes
- [x] Milestone 1b — Christmas blocks: decorations
- [ ] Milestone 2 — Snowfall and winter atmosphere
- [ ] Milestone 3 — Entity system and Bentley's model
- [ ] Milestone 4 — Bentley follows, swims, gets petted
- [ ] Milestone 5 — Sound
- [ ] Milestone 6 — Winter generator and the story world
- [ ] Milestone 7 — Structures
- [ ] Milestone 8 — Story engine, dialogue and pickups
- [ ] Milestone 9 — Chapters 0 to 3
- [ ] Milestone 10 — Chapter 4 and the ending
- [ ] Milestone 11 — Gift wrapping
- [ ] Milestone 12 — Full playthrough, polish, freeze
