import { H } from './config';
import { AIR, BEDROCK, GRASS, DIRT, HOTBAR, REPLACEABLE } from './blocks';
import { world } from './world';
import { P, V, aim, collides, overlapsPlayer } from './player';
import { hud, toast } from './ui';
import type { Effects } from './effects';

/* ===================== BREAK / PLACE ===================== */
const buzz = (ms: number) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } };

export interface Interaction {
  /** Break or place (depending on the HUD mode) at the crosshair. */
  act(): void;
  /** Move the outline / placement ghost to whatever the crosshair is on. */
  updateTarget(playing: boolean): void;
}

export function createInteraction(fx: Effects): Interaction {
  function act(): void {
    const h = aim();
    if (!h) return;
    if (hud.mode === 'break') {
      const id = world.getBlock(h.x, h.y, h.z);
      if (id === BEDROCK) { toast('Bedrock is unbreakable'); return; }
      world.setBlock(h.x, h.y, h.z, AIR);
      fx.burst(h.x, h.y, h.z, id);
      buzz(14);
    } else {
      const x = h.x + h.nx, y = h.y + h.ny, z = h.z + h.nz;
      if (!world.isLoaded(x, z) || y < 0 || y >= H || !REPLACEABLE[world.getBlock(x, y, z)]) return;
      if (overlapsPlayer(x, y, z)) {
        // block would only poke up into your feet (e.g. mid-jump): hop you on top → easy pillaring
        if (y + 1 - P[1] > 0.6 || collides(P[0], y + 1, P[2])) { toast("You're standing there!"); return; }
        P[1] = y + 1;
        if (V[1] < 0) V[1] = 0;
      }
      world.setBlock(x, y, z, HOTBAR[hud.sel]);
      if (y > 0 && world.getBlock(x, y - 1, z) === GRASS) world.setBlock(x, y - 1, z, DIRT);
      buzz(8);
    }
  }

  function updateTarget(playing: boolean): void {
    const h = playing ? aim() : null;
    fx.outline.visible = !!h;
    fx.ghost.visible = false;
    if (!h) return;
    fx.outline.position.set(h.x, h.y, h.z);
    if (hud.mode === 'place') {
      const x = h.x + h.nx, y = h.y + h.ny, z = h.z + h.nz;
      if (world.isLoaded(x, z) && y >= 0 && y < H && REPLACEABLE[world.getBlock(x, y, z)] &&
          (!overlapsPlayer(x, y, z) || (y + 1 - P[1] <= 0.6 && !collides(P[0], y + 1, P[2])))) {
        fx.ghost.visible = true;
        fx.ghost.position.set(x + 0.5, y + 0.5, z + 0.5);
      }
    }
  }

  return { act, updateTarget };
}
