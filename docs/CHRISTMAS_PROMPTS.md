# Bentley's Christmas — prompts for Claude Code

One prompt per session, in order. Paste the whole block. Each one ends with the same **standard
finish** so every session plans first, tests, updates the docs and tells you what to check.

Between sessions: play the result on your phone, then commit (or ask Claude to). If a session goes
badly wrong, `git reset --hard` to the last good commit and start that prompt again in a new session.

Useful follow-ups (any session):

- *"Show me the plan again before you change anything else."*
- *"That's not right on my phone: <what you saw>. Fix it without touching anything else."*
- *"Commit this with a clear message and push."*
- *"Stop. Summarise what you've changed so far and what's left."*

---

## Prompt 0 — Get ready

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md. Don't change any game code in this session.

1. Run npm install, npm test, npm run typecheck and npm run build and tell me if anything fails.
2. Read the codebase enough to tell me, for each milestone in the plan, which existing files it
   will touch and anything in the plan that conflicts with how the code actually works.
3. Suggest any changes to docs/CHRISTMAS_PLAN.md that would make the milestones safer or smaller,
   and make them once I agree.
```

---

## Prompt 1 — Christmas blocks

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then do Milestone 1 (Christmas blocks).

Add these blocks with new ids from 42, tiles painted procedurally in textures.ts (appended per the
TILE_PAINTERS rules), all on a new "Christmas" tab in the block picker:
- Presents (cube, ribbon + bow on top and sides) in red, green, gold and pink
- Candy cane block (red/white diagonal stripes) and a pink/white one
- Gingerbread, Icing (white, drips down the sides) and Gingerbread roof (gingerbread with an icing top)
- Fairy lights: flat on walls like vines, multicolour bulbs, light emission ~8
- Baubles in pink, red and gold: small hanging balls, cutout model, can hang on/under leaves
- Wreath and Stocking: flat on walls
- Star: full-bright like the glow crystal, light emission 15
- Paw prints: flat on the floor like a lily pad on land, 4 rotations, not solid, replaceable,
  snow-coloured with prints pressed in (they're for trails on snowy ground)
- Snow bricks and Frosted glass

Each should look good in the hotbar icon, in the world by day, and at night.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md and tick the milestone in the plan. Then tell me exactly what to try on my phone.
```

---

## Prompt 2 — Snowfall

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then do Milestone 2 (Snowfall and winter atmosphere).

- Falling snow around the camera: soft flakes drifting down with a gentle sideways sway, one draw
  call (Points), lit by the time of day, fogged like everything else.
- No snow under roofs, in caves or under water: skip flakes where the column above has no open sky.
- A "Snow" setting in the menu (on / off / auto), saved in localStorage. Auto = on in snowy biomes
  (Snowy Peaks, Taiga, Frozen Ocean) and in the story world later; off elsewhere.
- Winter worlds get a slightly colder, softer fog and sky through the existing haze.
- A browser test: screenshots with snow by day and at night, and a frame-time comparison with
  snow on vs off in the same run.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md and tick the milestone in the plan. Then tell me exactly what to try on my phone.
```

---

## Prompt 3 — Entity system + Bentley's model

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then do Milestone 3 (entity system and Bentley's model).

1. A small entity system in src/entities.ts: position, velocity, yaw, AABB, update, mesh. Gravity
   and collision shared with the player — factor the reusable parts out of player.ts instead of
   copying them, and keep the player tests green. Entities are lit like the block they stand in
   (lightColor) and pause when their chunk isn't loaded. Keep it plain functions + a createX
   factory, like the rest of the code.
2. Box-model rendering: cuboid parts with procedurally painted textures (no image files), parts
   that rotate around pivots (head, 4 legs, tail, ears).
3. Bentley: a blocky pug. Fawn body (~#C8A15A, a darker back), black face mask and muzzle, black
   floppy ears, dark round eyes, a pink tongue when panting, short chunky legs, tight curly tail on
   top, darker wrinkle lines on the forehead. He should be instantly recognisable as a pug.
   Animations: idle (breathing + an occasional head shake/snort), walk (a waddle), sit, sleep
   (lying on his side, "Z" particles rising), tail wag.
4. Debug: __voxel.spawnBentley() puts him in front of the player in any world; __voxel.bentley
   gives his position and state, and lets a test set his animation state.

Show me a screenshot of each animation state from the browser test.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md and tick the milestone in the plan. Then tell me exactly what to try on my phone.
```

---

## Prompt 4 — Bentley follows, swims, gets petted

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then do Milestone 4 (Bentley follows, swims and gets
petted).

- Follow: walks toward the player when more than ~3 blocks away, stops within 2, steps/jumps up
  1-block ledges, avoids drops over 3 blocks when he can, swims (paddling, head above water),
  teleports next to the player when more than ~24 blocks away or stuck for 3 seconds. Sits down
  after a while standing still, falls asleep after longer.
- Pet: tapping Bentley (raycasts hit entities before blocks) makes hearts, a wag and a happy
  snort animation, in break or place mode, and never breaks or places the block behind him.
- Sit/Come: tapping him twice toggles staying put or following.
- Save Bentley with the world (position, state, wearing the jumper or not) — this changes the save
  format, so bump SAVE_VERSION with a migration and fixture as CLAUDE.md describes.
- Browser tests: he follows the player across a hill and a stretch of water by touch controls,
  teleports when left far behind, and a tap on him pets instead of breaking.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md and tick the milestone in the plan. Then tell me exactly what to try on my phone.
```

---

## Prompt 5 — Sound

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then do Milestone 5 (Sound).

All sounds generated with Web Audio — no audio files.
- audio.ts becomes a real engine: one AudioContext unlocked by the first tap on Play, master
  volume, Sound and Music toggles in the menu (localStorage), positional sources (volume by
  distance, left/right pan) for things in the world.
- Sounds: break and place per material (snow crunch, wood, stone, glass, plants), footsteps (snow
  crunches on snow and ice), splash, pickup sparkle, sleigh bells, and Bentley: a looping snore
  (filtered noise with a slow breathing rhythm, positional — this is a key story mechanic, it must
  clearly get louder as you approach), snort, sneeze, a small bark, a happy whine when petted.
- Music: a soft music-box Jingle Bells loop (the 1857 tune is public domain), quiet; off by
  default for now.
- Nothing makes a sound before the first tap, and the browser tests stay free of console warnings.

Tell me which sounds I should listen to on my phone to judge them, and make each easy to tweak
(one parameters object per sound).

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md and tick the milestone in the plan. Then tell me exactly what to try on my phone.
```

---

## Prompt 6a — Winter generator

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then do the first half of Milestone 6: generator 3,
the winter archipelago. (The story world itself is the next session.)

- Generator 3 reuses generator 2's machinery with a winter flag: every island takes winter biomes
  (snowy meadow, taiga, snowy peaks, and one cherry grove dusted with snow — the pink island),
  snow on all open ground, a frozen sea with ice floes, cold tints. Add any winter biome variants
  you need to biomes.ts without changing generator 2's island assignment or output.
- Tests: generator 3 is deterministic and continuous across chunk borders; generator 1 and 2
  fingerprints/outputs are unchanged (add a generator 2 fingerprint test first if there isn't one,
  so this is proven).
- A script or test that searches seeds and lists the best few for the story: the start island in
  the middle with 4 neighbouring islands within ~120 blocks, one of them tall enough for a big
  mountain (Starlight Peak), one able to be the cherry island. Show me the top 3 with screenshots
  from the air, and I'll pick.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md. Then tell me exactly what to try on my phone.
```

## Prompt 6b — The story world

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then finish Milestone 6: the story world. Use seed
<THE SEED I PICKED> with generator 3.

- WorldRecord gains `story` ('xmas') and `progress` (story step, flags, found items, baubles found,
  checkpoint). Bump SAVE_VERSION with a migration and fixture.
- Start card: a big "Bentley's Christmas" button above the world list. One story world: "Continue"
  if it exists, "Start over" (with a confirm) to begin again. Free-build worlds work as before.
- Story worlds have a curated hotbar (snow, snow bricks, planks, ice, torches, presents, baubles,
  paw prints…) and the block picker is hidden until free play is unlocked (a progress flag).
- The story controls the time of day: the normal clock is paused in a story world until free play;
  add a function the story can call to set or ease the time.
- No health or damage anywhere in story worlds.
- Browser test: create the story world from the start card, check it's wintry, reload and continue.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md and tick the milestone in the plan. Then tell me exactly what to try on my phone.
```

---

## Prompt 7a — Structures: Home Island and Snowy Meadow

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then start Milestone 7 (structures): the system and
the first two islands.

- src/story/structures.ts: pure stamping functions placed by generator 3 at anchors relative to
  their islands, stamped by every chunk they overlap (the way trees cross chunk borders), using
  only seeded hashes, never Math.random. Named anchors exported for the story script, e.g.
  'cottage.door', 'cottage.tree', 'meadow.stream'. __voxel.goto(anchor) teleports there.
- Home Island: Gabby's cosy cottage — snowy roof, chimney, a door, warm lit windows, a fireplace
  with a glowing hearth, Bentley's bed by the fire, a Christmas tree with empty spots for baubles,
  presents underneath, fairy lights and a wreath — a snowman outside, and a trail of paw prints
  from the door toward the meadow.
- Snowy Meadow: an icy stream with a gap to bridge, paw prints leading on, a spot for the squeaky
  toy.
- Make them look hand-built and cosy, not boxy. Show me screenshots from each anchor, inside and
  outside the cottage, by day and at dusk.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md. Then tell me exactly what to try on my phone.
```

## Prompt 7b — Structures: Grove, Lake, Peak

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then finish Milestone 7 (structures).

- Gingerbread Grove (the pink cherry island): the Snowman Baker's half-built gingerbread house
  (gingerbread, icing, candy canes), candy-cane "trees", a cookie-crumb trail, 4 hidden spots for
  gingerbread pieces, a spot where Bentley's jumper is.
- Frozen Lake: a sliding-ice puzzle arena (leave space for the puzzle ice block — mark its tiles
  with an anchor list for now) with rocks to stop against, the cave entrance leading down to the
  glow caves, a route through the caves, and the collar spot.
- Starlight Peak: a walkable path up the mountain (steps cut in, ledges, no jumps that are hard on
  a phone), the beacon tower at the top with a spot for the Star, the spilled present sack and the
  sleigh with room for a reindeer.
- 12 hidden bauble spots spread across all five islands (some easy, some tucked away).
- Screenshots from every anchor.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md and tick the milestone in the plan. Then tell me exactly what to try on my phone.
```

---

## Prompt 8a — Story engine

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then start Milestone 8: the story engine (no real
chapters yet — a two-step test script only).

- src/story/script.ts: data only — steps with id, chapter, objective text, a trigger, dialogue
  lines and effects, a checkpoint anchor. The format sketched in the plan is a starting point.
  Triggers: enter an area near an anchor, pick up an item, place given blocks near an anchor
  (with a count), talk to an NPC, custom (for puzzles). Effects: dialogue, set/ease time of day,
  give items, move or set Bentley's state, set the Listen target, play a sound, fade to white.
- src/story/runner.ts: tracks the current step, checks triggers cheaply each frame, runs effects,
  saves to WorldRecord.progress.
- Dialogue box: bottom of the screen, speaker name + text, tap to continue, pink trim, controls
  paused while it's open. HUD objective line at the top.
- __voxel.story() (current step, flags) and __voxel.storyJump(stepId).
- Browser test: the test script runs end to end, survives a reload mid-way.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md. Then tell me exactly what to try on my phone.
```

## Prompt 8b — Pickups, NPCs, Listen, Back to the path

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then finish Milestone 8.

- Pickups: story items as entities — floating, slowly spinning, sparkling, a chime when collected.
  Items: squeaky toy, 4 gingerbread pieces, Bentley's jumper, his collar, the Star, 12 pink
  baubles. Collected ones are remembered in progress and never respawn.
- A "found" strip on the HUD: toy, jumper, collar, and baubles x/12.
- NPCs: a static entity type with a box model and dialogue on tap. Make the Snowman Baker (a
  snowman with a chef's hat and a rolling pin) and a reindeer.
- Listen button: plays Bentley's snore from the current Listen target (positional) and shows a
  soft paw-print compass toward it for 3 seconds.
- Menu → "Back to the path": teleports to the last checkpoint.
- Baubles found appear on the cottage tree.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md and tick the milestone in the plan. Then tell me exactly what to try on my phone.
```

---

## Prompt 9a — Chapters 0 and 1

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then write Chapters 0 and 1 in the story script.

- Chapter 0 (Home): Christmas Eve afternoon. Short, warm tutorial lines teaching look, move and
  place. Hang 3 baubles on the tree, put a present under it. Bentley snores by the fire. The day
  eases into dusk, sleigh bells pass overhead, Bentley wakes, snorts and bolts out of the door
  (he runs down the path and disappears out of sight). The door is open; paw prints lead away.
- Chapter 1 (Snowy Meadow): golden twilight. Follow the paw prints, bridge the icy stream
  (teaches breaking and building), find the squeaky toy (it squeaks when picked up). End with a
  short line and a checkpoint.
- Dialogue tone: sweet and funny, Gabby talking to herself and to Bentley. Mark any line where a
  personal detail would fit with a // PERSONALISE comment so I can find them.
- A browser test that plays both chapters by touch, start to finish.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md. Then tell me exactly what to try on my phone.
```

## Prompt 9b — Chapter 2

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then write Chapter 2 (Gingerbread Grove).

- Arrive at the pink island. Meet the Snowman Baker: Bentley charged through his kitchen and
  scattered the 4 gingerbread pieces (and ate some cookies — leave a crumb trail).
- Find the 4 pieces (crumb trail + Listen), bring them back. The Baker finishes his house and
  gives Gabby Bentley's Christmas jumper, which he found snagged on a candy cane.
- Funny, kind Baker lines. // PERSONALISE comments where a personal joke would fit.
- Browser test that plays the chapter.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md. Then tell me exactly what to try on my phone.
```

## Prompt 9c — Chapter 3

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then write Chapter 3 (Frozen Lake and Glow Caves) and
finish Milestone 9.

- A new Puzzle ice block: standing on it, the player slides in the direction they push (the
  joystick's main axis, snapped to the 4 grid directions) at a fixed speed until they hit
  something solid or reach normal ground. No steering mid-slide. Feels good on a touchscreen.
- Lay out the slide puzzle on the lake's puzzle tiles: solvable in about 6-8 moves, with one
  obvious-looking wrong route. Add a unit test that solves it with a search, so it's provably
  solvable.
- Then the cave: dark, torches in the hotbar, glow crystals, follow the snoring to the collar.
- End of chapter: Gabby sees the star-shaped beacon on top of Starlight Peak in the distance.
- Browser test: the slide puzzle played by touch; the whole chapter played.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md and tick the milestone in the plan. Then tell me exactly what to try on my phone.
```

---

## Prompt 10 — Chapter 4 and the ending

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then do Milestone 10 (Chapter 4 and the ending).

- Chapter 4: night falls (still readable on a phone). Climb Starlight Peak with Bentley's snoring
  from the top. Place the Star on the beacon: the sky brightens, sleigh bells, the reindeer is
  there, and Bentley is asleep in the spilled present sack wrapped in paper. He wakes, sneezes,
  runs to Gabby: hearts everywhere, a happy bark. He now wears his jumper.
- Ending: fade to white, sleigh bells → Christmas morning at the cottage, Bentley by the fire,
  presents opened except one. Tapping it opens a full-screen letter with a pink-and-snow frame.
- src/story/letter.ts holds the letter as plain text, with a bonus paragraph shown only if all 12
  baubles were found. Use an obvious PLACEHOLDER text for now — I'll write the real one.
- Credits roll ("Made with love for Gabby by <NAME>", "Starring Bentley"), then free play unlocks:
  block picker, normal day clock, Bentley follows; the menu offers "Replay the ending".
- Browser test: storyJump to Chapter 4 and play to free play.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md and tick the milestone in the plan. Then tell me exactly what to try on my phone.
```

---

## Prompt 11 — Gift wrapping

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then do Milestone 11 (Gift wrapping). Use the
frontend-design skill if it's available.

- Title screen: snowy, "Bentley's Christmas Adventure" in a friendly rounded font bundled with the
  game (no network requests), Bentley asleep on the title card, snow falling, pink accents. The
  story button first and biggest, "Free build" second.
- A consistent pink theme across the HUD, menus, hotbar selection and dialogue box. Still readable
  in bright daylight on a phone.
- PWA: a web app manifest (name "Bentley's Christmas", short name "Bentley", pink theme colour),
  icons of Bentley's face painted procedurally and rendered to PNGs by a build script (no
  hand-made image files in the repo), and a service worker so it works offline after the first
  visit. Make sure updates still arrive (new deploys replace the cache).
- A short "Fetching Bentley…" loading message while the world streams in.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Add unit tests
and a browser test with screenshots. Run npm test, typecheck and build until they pass. Update
CLAUDE.md and tick the milestone in the plan. Then tell me exactly what to try on my phone,
including how to add it to the home screen.
```

---

## Prompt 12 — Full playthrough and polish

```
Read CLAUDE.md and docs/CHRISTMAS_PLAN.md, then do Milestone 12 (Full playthrough, polish).

1. A browser test that plays the entire story from a new story world to free play, through
   __voxel and touch (jump between checkpoints where walking would be slow), checking every step
   fires and the console stays clean.
2. Play it yourself through the tests and screenshots and list everything that could confuse or
   frustrate a first-time player on a phone: unclear objectives, Listen too vague, places Bentley
   or the player could get stuck, too dark, too long, too fiddly. Show me the list before fixing.
3. Performance on a mid-range phone: frame time with snow, entities and lights at night; fix the
   worst offenders.
4. Fix what I approve from the list.

Standard finish: plan first and wait for my OK. Follow every CLAUDE.md convention. Run npm test,
typecheck, build and the browser tests until they pass. Update CLAUDE.md and tick the milestone.
```

---

## Prompt 13 — Personal touches (do this yourself, near the end)

```
Here are personal details to work into the story: <Bentley's habits, nicknames, our places and
in-jokes>. Go through every // PERSONALISE comment in src/story/ and suggest a line for each
using these. Show me them all as a list before changing anything.
```

## Prompt 14 — The letter (last few days only)

```
Replace the placeholder in src/story/letter.ts with this letter, keeping my words exactly:
<YOUR LETTER>. Bonus paragraph for all 12 baubles: <BONUS>. Credits name: <YOUR NAME>.
Check it fits and reads well on a small phone screen, then commit and push.
```

## Prompt 15 — Final check (around 20 December)

```
It's the final check before I give this as a present. Run every test, build, and play the whole
story through the browser tests. Check: a brand-new player on a phone can finish it, saving and
continuing works, the PWA installs and works offline, no console errors, the letter shows
correctly. Tell me anything that isn't perfect. Don't add features — fixes only.
```
