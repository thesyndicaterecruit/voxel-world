import { H } from './config';
import { AIR, BEDROCK, GRASS, DIRT, WATER, B, REPLACEABLE, BUILD_ON, SOLID, OPAQUE, MODEL, SUPPORT, LOGGABLE, WATERLOGGED, M_TORCH,
  M_LIQUID, S_WATER, S_WALL, S_TORCH } from './blocks';
import { world, type Hit } from './world';
import { P, V, aim, collides, overlapsPlayer } from './player';
import { hud, toast } from './ui';
import { torchStateFor } from './torch';
import { blockBox, holds } from './plants';
import type { Effects } from './effects';

/* ===================== BREAK / PLACE ===================== */
// Breaking a block leaves air (water, for a waterlogged plant); whatever it held up pops off by itself
// (main.ts runs popUnsupported after every change). Building goes against the face of the block hit,
// or into it where it makes way (grass, seagrass); nothing builds against a torch or a plant.
const buzz = (ms: number) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } };
const UNIT = [0, 0, 0, 1, 1, 1];
/** Why a block that needs holding up can't stay where it was put, by what it needs (SUPPORT) */
const UNHELD = ['', 'Needs solid ground under it', 'Goes on water', 'Goes on walls', 'Torches need a solid block'];

export interface Interaction {
  /** Break or place (depending on the HUD mode) at the crosshair. */
  act(): void;
  /** Move the outline / placement ghost to whatever the crosshair is on. */
  updateTarget(playing: boolean): void;
}

/**
 * Where block `id` would go when building against hit `h`, with its block state — or a message
 * saying why it can't go there, or null when there's simply no room.
 */
function placement(h: Hit, id: number): { x: number; y: number; z: number; state: number } | string | null {
  // water is only aimed at to put something on it (a lily pad)
  const target = world.getBlock(h.x, h.y, h.z), liquid = MODEL[target] === M_LIQUID;
  let x = h.x + h.nx, y = h.y + h.ny, z = h.z + h.nz;
  if (REPLACEABLE[target] && !liquid) { x = h.x; y = h.y; z = h.z; }   // grass, seagrass, vines make way
  else if (!BUILD_ON[target] && !liquid) return null;                // nothing builds against a torch or a plant
  if (!world.isLoaded(x, z) || y < 0 || y >= H || !REPLACEABLE[world.getBlock(x, y, z)]) return null;
  const b = B[id], sup = SUPPORT[id], wet = world.water(x, y, z) >= 0;
  let state = 0;
  if (sup === S_TORCH || sup === S_WALL) {
    // torches stand on top of a block or lean out of its side; vines hang on its side
    state = torchStateFor(h.nx, h.ny, h.nz);
    if (state < 0 || (sup === S_WALL && state === 0)) return sup === S_WALL ? UNHELD[S_WALL] : 'Torches go on top of blocks or on walls';
  }
  if (MODEL[id] === M_TORCH && wet) return "Torches don't burn under water";
  if (!SOLID[id] && b.model !== 'liquid') {
    // in water, a plant that can sit there is waterlogged; the others don't grow there, and water plants grow nowhere else
    if (wet && b.waterlog === 'no') return sup === S_WATER ? UNHELD[S_WATER] : "Doesn't grow under water";
    if (!wet && b.waterlog === 'only') return 'Only grows under water';
    if (wet) state |= WATERLOGGED;
  }
  if (sup && !holds(world, id, state, x, y, z)) return UNHELD[sup];
  return { x, y, z, state };
}

export function createInteraction(fx: Effects): Interaction {
  /** What the crosshair is on: a lily pad (or anything else that goes on water) about to be placed aims at the water's surface too */
  const target = () => aim(hud.mode === 'place' && SUPPORT[hud.items[hud.sel]] === S_WATER);

  function act(): void {
    const h = target();
    if (!h) return;
    if (hud.mode === 'break') {
      const id = world.getBlock(h.x, h.y, h.z), st = world.getState(h.x, h.y, h.z);
      if (id === BEDROCK) { toast('Bedrock is unbreakable'); return; }
      world.setBlock(h.x, h.y, h.z, st & WATERLOGGED && LOGGABLE[id] ? WATER : AIR);
      fx.burst(h.x, h.y, h.z, id);
      buzz(14);
      return;
    }
    const id = hud.items[hud.sel], at = placement(h, id);
    if (typeof at === 'string') { toast(at); return; }
    if (!at) return;
    const { x, y, z, state } = at;
    if (SOLID[id] && overlapsPlayer(x, y, z)) {
      // block would only poke up into your feet (e.g. mid-jump): hop you on top → easy pillaring
      if (y + 1 - P[1] > 0.6 || collides(P[0], y + 1, P[2])) { toast("You're standing there!"); return; }
      P[1] = y + 1;
      if (V[1] < 0) V[1] = 0;
    }
    world.setBlock(x, y, z, id, state);
    // grass needs light: an opaque block on top turns it to dirt
    if (OPAQUE[id] && y > 0 && world.getBlock(x, y - 1, z) === GRASS) world.setBlock(x, y - 1, z, DIRT);
    buzz(8);
  }

  function updateTarget(playing: boolean): void {
    const h = playing ? target() : null;
    fx.outline.visible = !!h;
    fx.ghost.visible = false;
    if (!h) return;
    // a torch's or a plant's outline hugs its hit box
    fx.showOutline(h.x, h.y, h.z, blockBox(world.getBlock(h.x, h.y, h.z), world.getState(h.x, h.y, h.z), world.seed, h.x, h.y, h.z) ?? UNIT);
    if (hud.mode !== 'place') return;
    const id = hud.items[hud.sel], at = placement(h, id);
    if (!at || typeof at === 'string') return;
    const { x, y, z } = at;
    if (SOLID[id] && overlapsPlayer(x, y, z) && (y + 1 - P[1] > 0.6 || collides(P[0], y + 1, P[2]))) return;
    fx.showGhost(x, y, z, id, at.state);
  }

  return { act, updateTarget };
}
