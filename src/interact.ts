import { H } from './config';
import { AIR, BEDROCK, GRASS, DIRT, WATER, REPLACEABLE, SOLID, OPAQUE, MODEL, TORCH } from './blocks';
import { world, type Hit } from './world';
import { P, V, aim, collides, overlapsPlayer } from './player';
import { hud, toast } from './ui';
import { TORCH_SUPPORT, torchStateFor, torchBox } from './torch';
import type { Effects } from './effects';

/* ===================== BREAK / PLACE ===================== */
const buzz = (ms: number) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } };
const isTorch = (id: number) => MODEL[id] === 1;
const UNIT = [0, 0, 0, 1, 1, 1];

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
  if (isTorch(world.getBlock(h.x, h.y, h.z))) return null;           // nothing builds against a torch
  const x = h.x + h.nx, y = h.y + h.ny, z = h.z + h.nz;
  if (!world.isLoaded(x, z) || y < 0 || y >= H || !REPLACEABLE[world.getBlock(x, y, z)]) return null;
  if (!isTorch(id)) return { x, y, z, state: 0 };
  if (world.getBlock(x, y, z) === WATER) return "Torches don't burn under water";
  // torches stand on top of a block or lean out of its side, and need a solid cube to hold them
  const state = torchStateFor(h.nx, h.ny, h.nz), support = world.getBlock(h.x, h.y, h.z);
  if (state < 0) return 'Torches go on top of blocks or on walls';
  if (!SOLID[support] || MODEL[support] !== 0) return 'Torches need a solid block';
  return { x, y, z, state };
}

export function createInteraction(fx: Effects): Interaction {
  /** Torches held up by block (x, y, z) fall off once it's gone. */
  function popTorches(x: number, y: number, z: number): void {
    TORCH_SUPPORT.forEach(([dx, dy, dz], state) => {
      const tx = x - dx, ty = y - dy, tz = z - dz;
      if (isTorch(world.getBlock(tx, ty, tz)) && world.getState(tx, ty, tz) === state) {
        world.setBlock(tx, ty, tz, AIR);
        fx.burst(tx, ty, tz, TORCH);
      }
    });
  }

  function act(): void {
    const h = aim();
    if (!h) return;
    if (hud.mode === 'break') {
      const id = world.getBlock(h.x, h.y, h.z);
      if (id === BEDROCK) { toast('Bedrock is unbreakable'); return; }
      world.setBlock(h.x, h.y, h.z, AIR);
      fx.burst(h.x, h.y, h.z, id);
      popTorches(h.x, h.y, h.z);
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
    const h = playing ? aim() : null;
    fx.outline.visible = !!h;
    fx.ghost.visible = false;
    if (!h) return;
    // a torch's outline hugs its hit box
    fx.showOutline(h.x, h.y, h.z, isTorch(world.getBlock(h.x, h.y, h.z)) ? torchBox(world.getState(h.x, h.y, h.z)) : UNIT);
    if (hud.mode !== 'place') return;
    const id = hud.items[hud.sel], at = placement(h, id);
    if (!at || typeof at === 'string') return;
    const { x, y, z } = at;
    if (SOLID[id] && overlapsPlayer(x, y, z) && (y + 1 - P[1] > 0.6 || collides(P[0], y + 1, P[2]))) return;
    fx.showGhost(x, y, z, id, at.state);
  }

  return { act, updateTarget };
}
