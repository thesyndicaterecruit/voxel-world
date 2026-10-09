import { CB, CS, H, W, D, NCX, NCZ, CI } from './config';
import { AIR, WATER, SOLID, MODEL, LEVEL, FALLING } from './blocks';
import { cellKey, keyX, keyY, keyZ } from './light';

/* ============================ FLOWING WATER ============================ */
// Water moves in ticks, TICK seconds apart, and only where something disturbed it: every block
// change schedules the water in and next to it (blockChanged), a tick updates at most MAX_UPDATES
// scheduled blocks, and whatever they change schedules its own neighbours for the next tick. Water
// nobody touched (the sea) is never looked at.
// The rules, close to the familiar ones:
// - Water falls first: into air below it (or a torch, which it washes away) as falling water, full
//   height. A flowing block with water on top of it is falling water.
// - On the ground it spreads sideways one level weaker per block — a source's neighbours get level
//   1, and level 7 spreads no further — toward the nearest drop within SLOPE blocks if there is one,
//   else every open way. Flowing water landing on more water doesn't spread out on top of it.
// - A flowing block takes the level its strongest neighbour feeds it (one weaker), or dries up when
//   nothing does: take a source away and its stream drains, put a block in a stream and the water
//   behind it finds another way.
// - Two or more sources beside a flowing block standing on solid ground (or on a source) turn it
//   into a source: water is infinite.
// - Sources never change by themselves.
// The scheduled updates of a chunk are saved with it (pendingIn / restore), so water left flowing
// keeps flowing after a reload.

/** Seconds between ticks (5 a second) */
export const TICK = 0.2;
/** Most scheduled blocks a tick updates (the rest wait for the next) */
export const MAX_UPDATES = 128;
/** How far ahead spreading water looks for a drop */
const SLOPE = 4;
const DX = [1, -1, 0, 0], DZ = [0, 0, 1, -1];

/** What the water needs of the world (World, or a stand-in in tests) */
export interface WaterWorld {
  getBlock(x: number, y: number, z: number): number;
  getState(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, id: number, state?: number): boolean;
  chunk(cx: number, cz: number): object | undefined;
}

export interface WaterSim {
  /** A block changed (world.onChange): schedule the water in and next to it. */
  blockChanged(x: number, y: number, z: number, old: number): void;
  /** Advance the clock by dt seconds (at most one tick per call). */
  update(dt: number): void;
  /** Run one tick now; returns how many blocks it changed. */
  tick(): number;
  /** The updates pending in chunk (cx, cz), as block indices in the chunk (CI), for saving; null if none. */
  pendingIn(cx: number, cz: number): Uint16Array | null;
  /** Schedule the updates saved with chunk (cx, cz) again (it has just loaded). */
  restore(cx: number, cz: number, flow: Uint16Array): void;
  /** Debugging: updates pending, ticks run, blocks the last tick changed and how long it took (ms) */
  stats(): { pending: number; ticks: number; changed: number; ms: number };
}

/** Level 0, not falling */
const isSource = (st: number) => (st & (LEVEL | FALLING)) === 0;
/** How much water a block holds: 8 for a source or falling water, 7 down to 1 for levels 1–7 */
const amount = (st: number) => (st & FALLING ? 8 : 8 - (st & LEVEL));

/**
 * `onWash` hears about blocks the water washes away (torches); `onPending` about each chunk that gets
 * an update scheduled (it has something to save).
 */
export function createWater(w: WaterWorld, opts: { onWash?: (x: number, y: number, z: number, id: number) => void;
  onPending?: (cx: number, cz: number) => void } = {}): WaterSim {
  /** Scheduled updates, oldest first (cell keys) */
  const queue = new Set<number>();
  /** Updates waiting for chunks around them to load, by chunk */
  const parked = new Map<number, Set<number>>();
  let acc = 0, ticks = 0, changed = 0, ms = 0, lastChunk = -1;

  /** Are the chunks within reach of (x, z) loaded? (the water looks SLOPE + 1 blocks around) */
  const ready = (x: number, z: number) => {
    for (const [ax, az] of [[x - 5, z - 5], [x + 5, z - 5], [x - 5, z + 5], [x + 5, z + 5]]) {
      const cx = ax >> CB, cz = az >> CB;
      if (cx >= 0 && cx < NCX && cz >= 0 && cz < NCZ && !w.chunk(cx, cz)) return false;
    }
    return true;
  };
  function schedule(x: number, y: number, z: number): void {
    if (y < 0 || y >= H || x < 0 || z < 0 || x >= W || z >= D) return;
    queue.add(cellKey(x, y, z));
    const ci = (x >> CB) + (z >> CB) * NCX;
    if (ci !== lastChunk) { lastChunk = ci; if (opts.onPending) opts.onPending(x >> CB, z >> CB); }
  }
  /**
   * What water can do to a cell: 0 nothing (solid, a source, outside the world), 1 flow in (air, or
   * a torch it washes away), 2 it is flowing water (which levels itself, see fed)
   */
  function open(x: number, y: number, z: number): number {
    if (y < 0 || y >= H || x < 0 || z < 0 || x >= W || z >= D) return 0;
    const id = w.getBlock(x, y, z);
    if (id === WATER) return isSource(w.getState(x, y, z)) ? 0 : 2;
    return id === AIR || (!SOLID[id] && MODEL[id] !== 2) ? 1 : 0;
  }
  /** Water flows into open cell (x, y, z) */
  function pour(x: number, y: number, z: number, state: number): void {
    const id = w.getBlock(x, y, z);
    if (id !== AIR && opts.onWash) opts.onWash(x, y, z, id);
    if (w.setBlock(x, y, z, WATER, state)) changed++;
  }
  /** Horizontal neighbours of (x, y, z) that are sources */
  function sourcesAround(x: number, y: number, z: number): number {
    let n = 0;
    for (let d = 0; d < 4; d++) if (w.getBlock(x + DX[d], y, z + DZ[d]) === WATER && isSource(w.getState(x + DX[d], y, z + DZ[d]))) n++;
    return n;
  }
  /** The state a flowing block should have now (−1: it dries up) */
  function fed(x: number, y: number, z: number): number {
    let most = 0, sources = 0;
    for (let d = 0; d < 4; d++) {
      if (w.getBlock(x + DX[d], y, z + DZ[d]) !== WATER) continue;
      const s = w.getState(x + DX[d], y, z + DZ[d]);
      if (isSource(s)) sources++;
      if (amount(s) > most) most = amount(s);
    }
    if (sources >= 2) {
      const b = w.getBlock(x, y - 1, z);
      if (SOLID[b] || (b === WATER && isSource(w.getState(x, y - 1, z)))) return 0;
    }
    if (w.getBlock(x, y + 1, z) === WATER) return FALLING;
    return most > 1 ? 9 - most : -1;                 // one level weaker than the strongest neighbour
  }
  /**
   * Which ways (bit d for DX[d], DZ[d]) water at (x, y, z) spreads: toward the nearest drop within
   * SLOPE blocks (a cell over air or water), or every open way when there is none
   */
  function ways(x: number, y: number, z: number): number {
    const drop = (cx: number, cz: number) => w.getBlock(cx, y - 1, cz) === WATER || open(cx, y - 1, cz) === 1;
    const key = (cx: number, cz: number) => (cx + 16) * 1024 + cz + 16;
    let opens = 0, found = 0, layer: number[] = [];
    const seen = new Set<number>([key(x, z)]);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], nz = z + DZ[d];
      if (!open(nx, y, nz)) continue;
      opens |= 1 << d;
      seen.add(key(nx, nz));
      if (drop(nx, nz)) found |= 1 << d;
      else layer.push(nx, nz, 1 << d);
    }
    // further out, a step at a time; a cell reached from several first steps at once counts for all
    for (let dist = 2; !found && dist <= SLOPE && layer.length; dist++) {
      const next = new Map<number, number>();
      for (let i = 0; i < layer.length; i += 3) for (let d = 0; d < 4; d++) {
        const nx = layer[i] + DX[d], nz = layer[i + 1] + DZ[d], k = key(nx, nz), m = next.get(k);
        if (m !== undefined) { next.set(k, m | layer[i + 2]); continue; }
        if (seen.has(k) || !open(nx, y, nz)) continue;
        seen.add(k);
        next.set(k, layer[i + 2]);
      }
      layer = [];
      for (const [k, m] of next) {
        const nx = ((k / 1024) | 0) - 16, nz = (k % 1024) - 16;
        if (drop(nx, nz)) found |= m;
        else layer.push(nx, nz, m);
      }
    }
    return found || opens;
  }
  /** Water with state `st` at (x, y, z) spreads out sideways */
  function spread(x: number, y: number, z: number, st: number): void {
    const a = amount(st) - 1;
    if (a <= 0) return;
    const m = ways(x, y, z);
    for (let d = 0; d < 4; d++) {
      if (!((m >> d) & 1)) continue;
      const nx = x + DX[d], nz = z + DZ[d], o = open(nx, y, nz);
      if (o === 1) pour(nx, y, nz, 8 - a);
      else if (o === 2 && amount(w.getState(nx, y, nz)) < a) schedule(nx, y, nz);   // too weak: it levels itself up
    }
  }
  function update(x: number, y: number, z: number): void {
    if (w.getBlock(x, y, z) !== WATER) return;
    let st = w.getState(x, y, z);
    if (!isSource(st)) {
      const ns = fed(x, y, z);
      if (ns < 0) { if (w.setBlock(x, y, z, AIR)) changed++; return; }
      if (ns !== st) { if (w.setBlock(x, y, z, WATER, ns)) changed++; st = ns; }
    }
    const below = open(x, y - 1, z);
    if (below) {
      // falling first; flowing water below turns into falling water by itself
      if (below === 1) pour(x, y - 1, z, FALLING);
      else if (!(w.getState(x, y - 1, z) & FALLING)) schedule(x, y - 1, z);
      if (sourcesAround(x, y, z) >= 3) spread(x, y, z, st);   // the edge of a lake over a hole spreads out too
    } else if (isSource(st) || w.getBlock(x, y - 1, z) !== WATER) spread(x, y, z, st);
  }
  function park(k: number): void {
    const ci = (keyX(k) >> CB) + (keyZ(k) >> CB) * NCX;
    let p = parked.get(ci);
    if (!p) parked.set(ci, (p = new Set()));
    p.add(k);
  }

  const sim: WaterSim = {
    blockChanged(x, y, z, old) {
      if (old === WATER || w.getBlock(x, y, z) === WATER) schedule(x, y, z);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
        if (w.getBlock(x + dx, y + dy, z + dz) === WATER) schedule(x + dx, y + dy, z + dz);
      }
    },
    update(dt) {
      acc += dt;
      if (acc < TICK) return;
      acc = Math.min(acc - TICK, TICK);
      sim.tick();
    },
    tick() {
      const t0 = performance.now();
      changed = 0;
      ticks++;
      // updates parked for chunks that have loaded since
      for (const [ci, p] of parked) {
        if (!ready((ci % NCX) * CS + CS / 2, ((ci / NCX) | 0) * CS + CS / 2)) continue;
        for (const k of p) queue.add(k);
        parked.delete(ci);
      }
      const batch: number[] = [];
      for (const k of queue) {
        queue.delete(k);
        batch.push(k);
        if (batch.length >= MAX_UPDATES) break;
      }
      // what changes now schedules more for the next tick
      for (const k of batch) {
        const x = keyX(k), z = keyZ(k);
        if (ready(x, z)) update(x, keyY(k), z);
        else park(k);
      }
      ms = performance.now() - t0;
      return changed;
    },
    pendingIn(cx, cz) {
      const out: number[] = [], add = (k: number) => {
        const x = keyX(k), z = keyZ(k);
        if (x >> CB === cx && z >> CB === cz) out.push(CI(x & (CS - 1), keyY(k), z & (CS - 1)));
      };
      for (const k of queue) add(k);
      const p = parked.get(cx + cz * NCX);
      if (p) for (const k of p) add(k);
      return out.length ? Uint16Array.from(out) : null;
    },
    restore(cx, cz, flow) {
      for (const i of flow) queue.add(cellKey(cx * CS + (i & (CS - 1)), i >> (2 * CB), cz * CS + ((i >> CB) & (CS - 1))));
    },
    stats() {
      let pending = queue.size;
      for (const p of parked.values()) pending += p.size;
      return { pending, ticks, changed, ms: +ms.toFixed(2) };
    },
  };
  return sim;
}
