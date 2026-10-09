import * as THREE from 'three';
import { CB, CS, H, NCX, NCZ, CHUNK_VOL, SB, SH, NSEC, SEC_VOL, inWorld } from './config';
import { world, sectionTop, type Chunk } from './world';
import { LEAVES } from './blocks';
import { FP, PAD_VOL, noSections, spliceSections, type MeshData, type PassMesh, type SectionedMesh } from './mesher';
import { paddedCopy, chunkGeometry, groupGeometry } from './meshing';
import { relightMany, lightChunk, cellKey, keyX, keyY, keyZ } from './light';
import type { WorkerPool } from './workers';

/* ============================ CHUNK STREAMING ============================ */
// Keeps the chunks around the player loaded, lit and meshed. Distances are measured from the
// streaming centre to the nearest point of each chunk, in blocks:
//   ≤ R·CS          mesh region: meshed and drawn (fog hides everything beyond R·CS)
//   ≤ R·CS + 24     light region: lit, so every meshed chunk has its 8 neighbours lit (light at its
//                   borders, a diagonal neighbour being ≤ 16√2 further away); meshes that drift out
//                   of it are disposed
//   ≤ R·CS + 48     load region: loaded, so every lit chunk has its 8 neighbours' blocks (light
//                   comes from up to 15 blocks away)
//   ≤ R·CS + 72     keep region: still loaded (hysteresis); anything further is unloaded, saved
//                   first if it was edited
// Generation, lighting and meshing run in workers. The main thread copies a chunk's neighbourhood
// per job, adds at most UPLOADS_PER_FRAME chunks' meshes a frame (more behind the title card, where
// a slow frame doesn't matter), and lets edits jump the queue. While the world is first loading,
// it streams as if the view distance were FIRST_R, so what's needed to start comes first.
// Edits are relit on the main thread (relightMany in light.ts: the changes made together, e.g. by
// one tick of flowing water, in one go), and the chunks whose light changed are re-meshed with them.
//
// Meshing goes by section (CS × SH × CS blocks): each has its own version, and an edit re-meshes only
// the sections it touches (its own, and a neighbour's where it is on the border). An empty section
// has no mesh and never goes to a worker. A chunk is drawn whole, though: its sections' meshes are put
// together per render pass (spliceSections swaps one section's part), so taller chunks don't mean
// more draw calls.
// A chunk has up to three meshes, one per render pass (only those that aren't empty): opaque,
// cutout (alpha-tested, writes depth) and translucent (blended, drawn after everything else, back to
// front — see sortTranslucent). The translucent pass is water: the sea puts some in most chunks, so
// it is drawn a group of WG×WG chunks at a time (one draw call for all of them), rebuilt whenever
// one of them changes or crosses into or out of the view distance.

export const RENDER_DISTANCE = { def: 6, min: 3, max: 10 };
const LIGHT_MARGIN = 24, LOAD_MARGIN = 48, KEEP_MARGIN = 72;
const UPLOADS_PER_FRAME = 2, UPLOADS_TITLE = 8, FIRST_R = 2;
/** Most normal jobs started per frame (bounds the main-thread copying) */
const DISPATCH_PER_FRAME = 8;
/** Opaque and cutout meshes per chunk; the translucent pass goes to the chunk's group */
const OWN_PASSES = 2, TRANSLUCENT = 2;
/** Water groups: WG × WG chunks */
const WG = 4, NGX = NCX / WG;
/** Every section (bit k: section k) */
const ALL = (1 << NSEC) - 1, LAYER = CS * CS;
/** Sections holding layers y − 1 … y + 1: what a change at y can alter the meshes of */
const nearLayers = (y: number) => {
  let m = 0;
  for (let k = Math.max(0, (y - 1) >> SB); k <= Math.min(NSEC - 1, (y + 1) >> SB); k++) m |= 1 << k;
  return m;
};

const NONE = 0, LOADING = 1, LOADED = 2;
interface Slot {
  state: number;
  /** Bumped on every (un)load, so late worker results for an old load are ignored */
  epoch: number;
  /** Per section: bumped whenever its mesh inputs change (an edit in it or on its border, light, Fancy leaves) */
  ver: Uint32Array;
  /** Per section: version of the mesh being shown (-1: none yet) */
  shown: Int32Array;
  /** Per section: latest version on its way (in a worker, or waiting to be shown); -1: none */
  sent: Int32Array;
  /** An edit is waiting for its re-mesh */
  urgent: boolean;
  /** Bumped whenever a block within reach of this chunk's light changes: lighting jobs for older ones are stale */
  lightVer: number;
  /** Light version a lighting job is working on (-1: none) */
  lightSent: number;
  /** Being lit again after an edit (its light was dropped): hurry, and re-mesh it and its neighbours after */
  relit: boolean;
  /** Per render pass: the chunk's mesh, its sections' meshes one after another */
  pass: SectionedMesh[];
  /** Opaque and cutout meshes (pass 0 and 1 drawn), null where the pass is empty */
  meshes: (THREE.Mesh | null)[];
  /** The translucent pass (drawn by the chunk's water group), null where empty */
  water: PassMesh | null;
  /** Within the view distance, so its water is drawn */
  wvis: boolean;
  /** Nearest distance from the streaming centre in blocks, refreshed every frame */
  dist: number;
  score: number;
}
/** Finished meshes of some of a chunk's sections (`meshes[j]` is section `sections[j]`'s, made from version `vers[j]`) */
interface Ready { ci: number; epoch: number; urgent: boolean; sections: number[]; vers: number[]; meshes: MeshData[] }

export interface ChunkSource {
  /**
   * Edited contents of chunk (cx, cz) kept from earlier, or null to generate it from the seed; `flow`:
   * water updates that were still pending in it (see water.ts).
   */
  load?(cx: number, cz: number): Promise<{ data: Uint8Array; state: Uint8Array | null; flow?: Uint16Array | null }> | null;
  /** Called with a chunk that is about to be dropped from memory (keep it if it was edited). */
  unload?(c: Chunk): void;
}

export interface Streamer {
  /**
   * Once per frame: stream around (x, z), preferring chunks in view direction (fx, fz). `mode`:
   * 'first' while the world first loads (only what's needed to start), 'title' while nobody is
   * playing yet (frames may take longer: more meshes are added per frame), 'play'.
   */
  update(x: number, z: number, fx: number, fz: number, mode?: 'first' | 'title' | 'play'): void;
  /** Once per frame, before rendering: order the chunks' translucent meshes back to front from the camera. */
  sortTranslucent(camera: THREE.Vector3): void;
  /**
   * Blocks have just changed (world.onChange): `changes` holds x, y, z and the block that was there
   * for each. Relight around them and re-mesh what they touch — their chunks and neighbours on a
   * border, and every chunk whose light changed — ahead of everything else.
   */
  blocksChanged(changes: number[]): void;
  setRenderDistance(r: number): void;
  /** Mesh leaves as opaque cubes ("Fancy leaves" off); re-meshes the chunks it changes. */
  setOpaqueLeaves(on: boolean): void;
  /** Are all chunks within `radius` blocks of (x, z) loaded and meshed? */
  isReady(x: number, z: number, radius: number): boolean;
  /** Are the chunks under and right around (x, z) loaded? (physics only runs when they are) */
  areaLoaded(x: number, z: number): boolean;
  /**
   * Debugging: how many cells of chunk (cx, cz)'s light differ from lighting it from scratch now
   * (-1: not lit, or a neighbour isn't loaded). 0 means the incremental updates got it right.
   */
  verifyLight(cx: number, cz: number): number;
  /**
   * Debugging: one chunk's streaming state (0 none, 1 loading, 2 loaded), lit, mesh versions (summed
   * over its sections: wanted, shown; the shown one per section), its non-empty sections (bit mask)
   * and triangles per pass
   */
  debugChunk(cx: number, cz: number): { state: number; lit: boolean; version: number; meshed: number; sections: number; shown: number[];
    tris: number[] };
  /**
   * Counts for debugging: loaded / lit chunks, chunks with meshes, visible ones, meshes per pass,
   * results waiting, edits waiting; average worker time per lighting job, and how long the last
   * edit's relight took on the main thread (ms) and how many cells it changed
   */
  stats(): { loaded: number; lit: number; meshed: number; visible: number; passes: number[]; queued: number; edits: number;
    lightMs: number; relightMs: number; relit: number };
}

/**
 * Split edits (x, y, z, old, new each) into groups whose light can be worked out separately: edits in
 * 32×32 cells that touch (diagonally too) go together, so edits in different groups are more than
 * 32 blocks apart and can't affect each other's light (it reaches 15 blocks).
 */
function clusters(edits: number[]): number[][] {
  const cells = new Map<number, number[]>();
  for (let e = 0; e < edits.length; e += 5) {
    const k = (edits[e] >> 5) + (edits[e + 2] >> 5) * 64;
    let c = cells.get(k);
    if (!c) cells.set(k, (c = []));
    c.push(edits[e], edits[e + 1], edits[e + 2], edits[e + 3], edits[e + 4]);
  }
  const out: number[][] = [];
  for (const start of cells.keys()) {
    if (!cells.has(start)) continue;
    const group: number[] = [], todo = [start];
    while (todo.length) {
      const k = todo.pop()!, c = cells.get(k);
      if (!c) continue;
      cells.delete(k);
      for (const v of c) group.push(v);
      const kx = k % 64, kz = (k / 64) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (cells.has(kx + dx + (kz + dz) * 64)) todo.push(kx + dx + (kz + dz) * 64);
    }
    out.push(group);
  }
  return out;
}

/** `materials` are the chunk materials per render pass: opaque, cutout, translucent. */
export function createStreamer(scene: THREE.Scene, materials: THREE.Material[], pool: WorkerPool, source: ChunkSource = {}): Streamer {
  const slots: Slot[] = Array.from({ length: NCX * NCZ }, () => ({
    state: NONE, epoch: 0, ver: new Uint32Array(NSEC), shown: new Int32Array(NSEC).fill(-1), sent: new Int32Array(NSEC).fill(-1),
    urgent: false, lightVer: 0, lightSent: -1, relit: false, pass: [noSections(), noSections(), noSections()],
    meshes: [null, null], water: null, wvis: false, dist: Infinity, score: 0,
  }));
  /** Water groups: one mesh for the water of WG × WG chunks, rebuilt when `dirty` */
  const groups = Array.from({ length: NGX * (NCZ / WG) }, () => ({ mesh: null as THREE.Mesh | null, dirty: false }));
  const groupOf = (ci: number) => ((ci % NCX) / WG | 0) + (((ci / NCX) | 0) / WG | 0) * NGX;
  let R = RENDER_DISTANCE.def, opaqueLeaves = true;
  const ready: Ready[] = [], urgentQ: number[] = [], pads: Uint8Array[] = [], blocks9: Uint8Array[] = [];
  let fresh: THREE.Mesh[] = [];                 // meshes added last frame (frustum culling off once)
  let urgentScheduled = false;
  let lightMs = 0, lightJobs = 0, relightMs = 0, relitCells = 0;

  /** Is every existing chunk in the 3×3 around (cx, cz) loaded / lit? */
  const around = (cx: number, cz: number, ok: (c: Chunk | undefined, s: Slot) => boolean) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, z = cz + dz;
      if (x >= 0 && x < NCX && z >= 0 && z < NCZ && !ok(world.chunk(x, z), slots[x + z * NCX])) return false;
    }
    return true;
  };
  const neighboursLoaded = (cx: number, cz: number) => around(cx, cz, (_c, s) => s.state === LOADED);
  const neighboursLit = (cx: number, cz: number) => around(cx, cz, (c) => !!c && !!c.light);
  const hasMesh = (s: Slot) => s.meshes[0] !== null || s.meshes[1] !== null || s.water !== null;
  /** Has any section been meshed (shown) */
  const anyShown = (s: Slot) => s.shown.some((v) => v >= 0);
  /** Sections that need meshing and aren't on their way yet (bit mask) */
  const toMesh = (s: Slot) => {
    let m = 0;
    for (let k = 0; k < NSEC; k++) if (s.shown[k] < s.ver[k] && s.sent[k] < s.ver[k]) m |= 1 << k;
    return m;
  };
  const upToDate = (s: Slot) => s.shown.every((v, k) => v >= s.ver[k]);
  const meshable = (ci: number) => slots[ci].state === LOADED && neighboursLit(ci % NCX, (ci / NCX) | 0);
  const resetSlot = (s: Slot) => {
    s.ver.fill(0); s.shown.fill(-1); s.sent.fill(-1); s.urgent = false;
    s.lightVer = 0; s.lightSent = -1; s.relit = false;
  };

  function dispatchLoad(ci: number): void {
    const s = slots[ci], cx = ci % NCX, cz = (ci / NCX) | 0, epoch = ++s.epoch;
    s.state = LOADING;
    const done = (data: Uint8Array, state: Uint8Array | null, edited: boolean, flow: Uint16Array | null = null) => {
      if (s.epoch !== epoch || s.state !== LOADING) return;   // unloaded meanwhile
      world.setChunk(cx, cz, data, state, edited, flow);
      s.state = LOADED;
      resetSlot(s);
    };
    const gen = () => pool.run({ type: 'gen', id: 0, seed: world.seed, gen: world.generator, cx, cz }, [],
      (res) => { if (res.type === 'gen') done(res.data, null, false); });
    const saved = source.load ? source.load(cx, cz) : null;
    if (saved) saved.then((c) => done(c.data, c.state, true, c.flow ?? null), gen);
    else gen();
  }

  /**
   * Light a chunk in a worker, from the blocks of it and its 8 neighbours (all loaded): only the
   * layers up to 16 above the highest of them go (above that it's open sky).
   */
  function dispatchLight(ci: number): void {
    const s = slots[ci], cx = ci % NCX, cz = (ci / NCX) | 0, epoch = s.epoch, ver = s.lightVer;
    let top = 0;
    for (let k = 0; k < 9; k++) {
      const c = world.chunk(cx + (k % 3) - 1, cz + ((k / 3) | 0) - 1);
      if (c) top = Math.max(top, sectionTop(c.count));
    }
    const height = Math.min(H, top + 16), n = height * LAYER;
    const buf = blocks9.pop() || new Uint8Array(9 * CHUNK_VOL);
    let present = 0;
    for (let k = 0; k < 9; k++) {
      const c = world.chunk(cx + (k % 3) - 1, cz + ((k / 3) | 0) - 1);
      if (c) { buf.set(c.data.subarray(0, n), k * n); present |= 1 << k; }
    }
    s.lightSent = ver;
    pool.run({ type: 'light', id: 0, cx, cz, blocks: buf.subarray(0, 9 * n), present, height }, [buf.buffer], (res) => {
      if (res.type !== 'light') return;
      blocks9.push(new Uint8Array(res.blocks.buffer));
      lightMs += res.ms; lightJobs++;
      if (s.epoch !== epoch) return;                       // unloaded meanwhile
      if (s.lightSent === ver) s.lightSent = -1;
      const c = world.chunk(cx, cz);
      if (ver !== s.lightVer || s.state !== LOADED || !c) return;   // blocks changed since: light again
      c.light = res.light;
      // a chunk lit again after an edit: re-mesh it, and its neighbours (they read its border light)
      if (s.relit) {
        s.relit = false;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, z = cz + dz;
          if (x >= 0 && x < NCX && z >= 0 && z < NCZ && anyShown(slots[x + z * NCX])) touch(x + z * NCX, ALL);
        }
      }
    });
  }

  /**
   * Mesh the sections of a chunk that need it. Empty ones simply have no mesh; the others go to a
   * worker with a padded copy of their layers and the one above and below.
   */
  function dispatchMesh(ci: number, urgent: boolean): void {
    const s = slots[ci], cx = ci % NCX, cz = (ci / NCX) | 0, epoch = s.epoch, c = world.chunk(cx, cz)!;
    const sections: number[] = [], vers: number[] = [], empty: number[] = [], emptyVers: number[] = [];
    let y0 = H, y1 = -1;
    for (let k = 0; k < NSEC; k++) {
      if (s.shown[k] >= s.ver[k] || s.sent[k] >= s.ver[k]) continue;
      s.sent[k] = s.ver[k];
      if (!c.count[k]) { empty.push(k); emptyVers.push(s.ver[k]); continue; }
      sections.push(k); vers.push(s.ver[k]);
      y0 = Math.min(y0, k * SH - 1); y1 = Math.max(y1, k * SH + SH);
    }
    // nothing to upload for those (unless they just lost their blocks): no need to wait for the budget
    if (empty.length) applyMesh({ ci, epoch, urgent, sections: empty, vers: emptyVers, meshes: empty.map(() => [null, null, null]) });
    if (!sections.length) return;
    const pad = pads.pop() || new Uint8Array(PAD_VOL), light = pads.pop() || new Uint8Array(PAD_VOL);
    paddedCopy(world, cx, cz, pad, 'blocks', y0, y1);
    paddedCopy(world, cx, cz, light, 'light', y0, y1);
    // per-block state (torch facing, water levels) when any of the 3×3 chunks has some
    let state: Uint8Array | null = null;
    if (!around(cx, cz, (n) => !n || !n.state)) paddedCopy(world, cx, cz, (state = pads.pop() || new Uint8Array(PAD_VOL)), 'state', y0, y1);
    pool.run({ type: 'mesh', id: 0, seed: world.seed, cx, cz, sections, pad, light, state, opaqueLeaves, seaLevel: world.seaLevel },
      state ? [pad.buffer, light.buffer, state.buffer] : [pad.buffer, light.buffer], (res) => {
        if (res.type !== 'mesh') return;
        pads.push(res.pad, res.light);
        if (res.state) pads.push(res.state);
        if (s.epoch === epoch) ready.push({ ci, epoch, urgent, sections, vers, meshes: res.meshes });
      });
  }

  /** Re-mesh sections `mask` of a chunk ahead of everything else (an edit touched them). */
  function touch(ci: number, mask: number): void {
    const s = slots[ci];
    if (s.state !== LOADED || !mask) return;
    for (let k = 0; k < NSEC; k++) if (mask & (1 << k)) s.ver[k]++;
    s.urgent = true;
    if (!urgentQ.includes(ci)) urgentQ.push(ci);
    if (!urgentScheduled) { urgentScheduled = true; queueMicrotask(pumpUrgent); }
  }

  // edits: coalesce the setBlock calls of one action, then send them straight to the workers;
  // chunks that can't be meshed yet (being lit again) go as soon as they can (update)
  function pumpUrgent(): void {
    urgentScheduled = false;
    while (urgentQ.length) {
      const ci = urgentQ.shift()!, s = slots[ci];
      if (s.state === LOADED && s.urgent && toMesh(s) && meshable(ci)) dispatchMesh(ci, true);
    }
  }

  /** Show finished section meshes: splice them into the chunk's meshes, the passes they change. */
  function applyMesh(r: Ready): void {
    const s = slots[r.ci];
    if (s.epoch !== r.epoch || s.state !== LOADED) return;   // stale
    const parts: (PassMesh | null | undefined)[][] = [[], [], []];
    let any = false;
    r.sections.forEach((k, j) => {
      if (s.sent[k] === r.vers[j]) s.sent[k] = -1;
      if (r.vers[j] <= s.shown[k]) return;                 // a newer one is shown already
      s.shown[k] = r.vers[j];
      for (let p = 0; p < 3; p++) parts[p][k] = r.meshes[j][p];
      any = true;
    });
    if (!any) return;
    if (upToDate(s)) s.urgent = false;
    const cx = r.ci % NCX, cz = (r.ci / NCX) | 0;
    for (let p = 0; p < 3; p++) {
      // a pass whose sections were and stay empty doesn't change
      const old = s.pass[p];
      if (parts[p].every((m, k) => m === undefined || (m === null && old.i[k + 1] === old.i[k]))) continue;
      const pm = s.pass[p] = spliceSections(old, parts[p]), data = pm.mesh;
      if (p === TRANSLUCENT) { setWater(r.ci, data); continue; }
      const m = s.meshes[p];
      if (!data) { if (m) disposeMesh(s, p); continue; }
      const geo = chunkGeometry(data);
      if (m) { m.geometry.dispose(); m.geometry = geo; continue; }
      const n = new THREE.Mesh(geo, materials[p]);
      n.position.set(cx * CS, 0, cz * CS);
      n.scale.setScalar(1 / FP);
      n.matrixAutoUpdate = false;
      n.updateMatrix();
      n.frustumCulled = false;                 // draw (= upload) it this frame even if out of view
      fresh.push(n);
      scene.add(n);
      s.meshes[p] = n;
    }
  }

  function disposeMesh(s: Slot, p: number): void {
    const m = s.meshes[p];
    if (!m) return;
    scene.remove(m);
    m.geometry.dispose();
    s.meshes[p] = null;
  }
  /** Drop a chunk's meshes (it is meshed from scratch if it comes back into range) */
  const disposeAll = (ci: number) => {
    const s = slots[ci];
    for (let p = 0; p < OWN_PASSES; p++) disposeMesh(s, p);
    setWater(ci, null);
    s.pass = [noSections(), noSections(), noSections()];
    s.shown.fill(-1);
  };
  function setWater(ci: number, data: PassMesh | null): void {
    if (!data && !slots[ci].water) return;
    slots[ci].water = data;
    groups[groupOf(ci)].dirty = true;
  }

  /** Put together a water group's mesh from its chunks' water (the ones within the view distance). */
  function rebuildGroup(gi: number): void {
    const g = groups[gi], gx = gi % NGX, gz = (gi / NGX) | 0, parts: [PassMesh, number, number][] = [];
    g.dirty = false;
    for (let dz = 0; dz < WG; dz++) for (let dx = 0; dx < WG; dx++) {
      const s = slots[gx * WG + dx + (gz * WG + dz) * NCX];
      if (s.water && s.wvis) parts.push([s.water, dx * CS, dz * CS]);
    }
    if (g.mesh) {
      g.mesh.geometry.dispose();
      if (!parts.length) { scene.remove(g.mesh); g.mesh = null; }
    }
    if (!parts.length) return;
    const geo = groupGeometry(parts);
    if (g.mesh) g.mesh.geometry = geo;
    else {
      g.mesh = new THREE.Mesh(geo, materials[TRANSLUCENT]);
      g.mesh.position.set(gx * WG * CS, 0, gz * WG * CS);
      g.mesh.scale.setScalar(1 / FP);
      g.mesh.matrixAutoUpdate = false;
      g.mesh.updateMatrix();
      scene.add(g.mesh);
    }
    g.mesh.frustumCulled = false;                    // upload it this frame
    fresh.push(g.mesh);
  }

  function unload(ci: number): void {
    const s = slots[ci], cx = ci % NCX, cz = (ci / NCX) | 0, c = world.chunk(cx, cz);
    if (c && source.unload) source.unload(c);
    world.removeChunk(cx, cz);
    disposeAll(ci);
    s.state = NONE; s.epoch++;
    resetSlot(s);
  }

  return {
    update(px, pz, fx, fz, mode = 'play') {
      for (const m of fresh) m.frustumCulled = true;
      fresh = [];
      // finished meshes: every edit re-mesh now, others (new chunks, re-meshes) within the upload
      // budget, nearest first
      if (ready.length) {
        ready.sort((a, b) => (a.urgent !== b.urgent ? (a.urgent ? -1 : 1) : slots[a.ci].score - slots[b.ci].score));
        let uploads = 0;
        for (let i = 0; i < ready.length; i++) {
          const r = ready[i], s = slots[r.ci];
          if (!r.urgent && s.epoch === r.epoch && r.sections.some((k, j) => r.vers[j] > s.shown[k])) {
            if (uploads >= (mode === 'play' ? UPLOADS_PER_FRAME : UPLOADS_TITLE)) continue;
            uploads++;
          }
          applyMesh(r);
          ready.splice(i--, 1);
        }
      }

      const meshD = R * CS, lightD = meshD + LIGHT_MARGIN, keepD = meshD + KEEP_MARGIN;
      // where new work goes: nearer while the world first loads
      const jobR = mode === 'first' ? Math.min(R, FIRST_R) * CS : meshD;
      const fl = Math.sqrt(fx * fx + fz * fz), ux = fl > 1e-3 ? fx / fl : 0, uz = fl > 1e-3 ? fz / fl : 0;
      const cands: number[] = [];
      for (let ci = 0; ci < slots.length; ci++) {
        const s = slots[ci], x0 = (ci % NCX) * CS, z0 = ((ci / NCX) | 0) * CS;
        const dx = Math.max(x0 - px, 0, px - x0 - CS), dz = Math.max(z0 - pz, 0, pz - z0 - CS);
        const d = s.dist = Math.sqrt(dx * dx + dz * dz);
        if (s.state !== NONE && d > keepD) { unload(ci); continue; }
        if (anyShown(s)) {
          if (d > lightD) disposeAll(ci);
          else for (const m of s.meshes) if (m) m.visible = d <= meshD;
        }
        if (s.wvis !== d <= meshD) { s.wvis = d <= meshD; if (s.water) groups[groupOf(ci)].dirty = true; }
        // priority: nearest first, chunks in front of the camera before those behind
        const cx = x0 + CS / 2 - px, cz = z0 + CS / 2 - pz, cl = Math.sqrt(cx * cx + cz * cz);
        s.score = d < CS ? d * 0.5 : d * (1 - 0.45 * (cl > 1e-3 ? (cx * ux + cz * uz) / cl : 0));
        if (s.state === NONE) { if (d <= jobR + LOAD_MARGIN) cands.push(ci); continue; }
        if (s.state !== LOADED) continue;
        const ccx = ci % NCX, ccz = (ci / NCX) | 0;
        if (!world.chunk(ccx, ccz)!.light) {
          // being lit again after an edit goes first; otherwise lit in turn, within the light region
          if (s.lightSent !== s.lightVer && (s.relit || d <= jobR + LIGHT_MARGIN) && neighboursLoaded(ccx, ccz)) {
            if (s.relit) dispatchLight(ci); else cands.push(ci);
          }
        } else if (toMesh(s) && (s.urgent || d <= jobR) && neighboursLit(ccx, ccz)) {
          if (s.urgent) dispatchMesh(ci, true); else cands.push(ci);
        }
      }
      // brand-new chunks start with every section at version 0 and none shown, so they need meshing
      cands.sort((a, b) => slots[a].score - slots[b].score);
      for (let i = 0, n = 0; i < cands.length && n < DISPATCH_PER_FRAME && pool.free() > 0; i++, n++) {
        const ci = cands[i], s = slots[ci];
        if (s.state === NONE) dispatchLoad(ci);
        else if (!world.chunk(ci % NCX, (ci / NCX) | 0)!.light) dispatchLight(ci);
        else dispatchMesh(ci, false);
      }
      for (let gi = 0; gi < groups.length; gi++) if (groups[gi].dirty) rebuildGroup(gi);
    },

    sortTranslucent(cam) {
      // three draws transparent objects by renderOrder first: farther water groups get lower numbers
      for (let gi = 0; gi < groups.length; gi++) {
        const m = groups[gi].mesh;
        if (!m) continue;
        const dx = ((gi % NGX) + 0.5) * WG * CS - cam.x, dz = (((gi / NGX) | 0) + 0.5) * WG * CS - cam.z;
        m.renderOrder = -Math.sqrt(dx * dx + dz * dz);
      }
    },

    blocksChanged(changes) {
      // each block once, from what it was first to what it is now
      const first = new Set<number>(), edits: number[] = [], near = new Set<number>();
      for (let i = 0; i < changes.length; i += 4) {
        const x = changes[i], y = changes[i + 1], z = changes[i + 2], k = cellKey(x, y, z);
        if (first.has(k)) continue;
        first.add(k);
        edits.push(x, y, z, changes[i + 3], world.getBlock(x, y, z));
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const X = (x >> CB) + dx, Z = (z >> CB) + dz;
          if (X >= 0 && X < NCX && Z >= 0 && Z < NCZ) near.add(X + Z * NCX);
        }
      }
      // lighting jobs started before this used the old blocks: their results will be redone
      for (const ci of near) slots[ci].lightVer++;
      const t0 = performance.now(), meshD = R * CS;
      /** Sections to re-mesh, by chunk: those holding (or next to) a changed cell, in the chunks around it */
      const marks = new Map<number, number>();
      const mark = (x: number, y: number, z: number) => {
        const m = nearLayers(y);
        for (let Z = (z - 1) >> CB; Z <= (z + 1) >> CB; Z++) for (let X = (x - 1) >> CB; X <= (x + 1) >> CB; X++) {
          if (X >= 0 && X < NCX && Z >= 0 && Z < NCZ) marks.set(X + Z * NCX, (marks.get(X + Z * NCX) ?? 0) | m);
        }
      };
      relitCells = 0;
      for (const group of clusters(edits)) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let e = 0; e < group.length; e += 5) {
          x0 = Math.min(x0, group[e]); x1 = Math.max(x1, group[e]); z0 = Math.min(z0, group[e + 2]); z1 = Math.max(z1, group[e + 2]);
        }
        // everything the changes can light or darken (≤ 15 blocks) is lit: relight right here
        let lit = true;
        for (let Z = (z0 - 16) >> CB; Z <= (z1 + 16) >> CB && lit; Z++) for (let X = (x0 - 16) >> CB; X <= (x1 + 16) >> CB; X++) {
          const c = world.chunk(X, Z);
          if (X >= 0 && X < NCX && Z >= 0 && Z < NCZ && !(c && c.light)) { lit = false; break; }
        }
        if (lit) {
          // then re-mesh the sections with a changed cell in them or next to them
          const changed = relightMany(world, group);
          for (const k of changed) mark(keyX(k), keyY(k), keyZ(k));
          if (relitCells >= 0) relitCells += changed.length;
        } else {
          // some of it isn't lit yet (just loaded): light the lit chunks around it again from scratch
          for (let e = 0; e < group.length; e += 5) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const c = world.chunk((group[e] >> CB) + dx, (group[e + 2] >> CB) + dz);
            if (c && c.light) { c.light = null; slots[c.cx + c.cz * NCX].relit = true; }
          }
          relitCells = -1;
        }
      }
      for (const ci of marks.keys()) if (!anyShown(slots[ci]) && slots[ci].dist > meshD) marks.delete(ci);   // not drawn: nothing to redo
      relightMs = performance.now() - t0;
      // and the blocks themselves: their sections, and the sections they border (in this chunk or the next)
      for (let e = 0; e < edits.length; e += 5) mark(edits[e], edits[e + 1], edits[e + 2]);
      for (const [ci, m] of marks) touch(ci, m);
    },

    setRenderDistance(r) { R = Math.max(RENDER_DISTANCE.min, Math.min(RENDER_DISTANCE.max, r)); },

    setOpaqueLeaves(on) {
      if (on === opaqueLeaves) return;
      opaqueLeaves = on;
      // re-mesh (as normal jobs, nearest first) the sections with leaves, the sections above and
      // below them and the same ones next door: a face there is hidden by an opaque leaves block
      const leafy = slots.map((s, ci) => {
        const c = s.state === LOADED ? world.chunk(ci % NCX, (ci / NCX) | 0) : undefined;
        let m = 0;
        if (c) for (let k = 0; k < NSEC; k++) if (c.count[k] && c.data.subarray(k * SEC_VOL, (k + 1) * SEC_VOL).includes(LEAVES)) m |= 1 << k;
        return m;
      });
      slots.forEach((s, ci) => {
        const cx = ci % NCX, cz = (ci / NCX) | 0;
        if (s.state !== LOADED) return;
        let m = leafy[ci] | (cx > 0 ? leafy[ci - 1] : 0) | (cx < NCX - 1 ? leafy[ci + 1] : 0) |
          (cz > 0 ? leafy[ci - NCX] : 0) | (cz < NCZ - 1 ? leafy[ci + NCX] : 0);
        m = (m | (m << 1) | (m >> 1)) & ALL;
        for (let k = 0; k < NSEC; k++) if (m & (1 << k)) s.ver[k]++;
      });
    },

    isReady(x, z, radius) {
      for (let ci = 0; ci < slots.length; ci++) {
        const s = slots[ci], x0 = (ci % NCX) * CS, z0 = ((ci / NCX) | 0) * CS;
        const dx = Math.max(x0 - x, 0, x - x0 - CS), dz = Math.max(z0 - z, 0, z - z0 - CS);
        if (dx * dx + dz * dz <= radius * radius && (s.state !== LOADED || s.shown.some((v) => v < 0))) return false;
      }
      return true;
    },

    areaLoaded(x, z) {
      for (const [ax, az] of [[x - 1, z - 1], [x + 1, z - 1], [x - 1, z + 1], [x + 1, z + 1]]) {
        const X = Math.floor(ax), Z = Math.floor(az);
        if (inWorld(X, Z) && !world.isLoaded(X, Z)) return false;
      }
      return true;
    },

    verifyLight(cx, cz) {
      const c = world.chunk(cx, cz);
      if (!c || !c.light || !neighboursLoaded(cx, cz)) return -1;
      const buf = new Uint8Array(9 * CHUNK_VOL);
      let present = 0;
      for (let k = 0; k < 9; k++) {
        const n = world.chunk(cx + (k % 3) - 1, cz + ((k / 3) | 0) - 1);
        if (n) { buf.set(n.data, k * CHUNK_VOL); present |= 1 << k; }
      }
      const fresh = lightChunk(buf, present, H);
      let bad = 0;
      for (let i = 0; i < CHUNK_VOL; i++) if (fresh[i] !== c.light[i]) bad++;
      return bad;
    },

    debugChunk(cx, cz) {
      const s = slots[cx + cz * NCX], c = world.chunk(cx, cz);
      let sections = 0;
      if (c) for (let k = 0; k < NSEC; k++) if (c.count[k]) sections |= 1 << k;
      return { state: s.state, lit: !!c && !!c.light, version: s.ver.reduce((a, v) => a + v, 0),
        meshed: s.shown.reduce((a, v) => a + v, 0), sections, shown: [...s.shown],
        tris: [...s.meshes.map((m) => (m && m.geometry.index ? m.geometry.index.count / 3 : 0)), s.water ? s.water.index.length / 3 : 0] };
    },

    stats() {
      let loaded = 0, lit = 0, meshed = 0, visible = 0, edits = 0;
      const passes = [0, 0, 0];
      for (const s of slots) {
        if (s.state === LOADED) loaded++;
        if (hasMesh(s)) {
          meshed++;
          if (s.meshes.some((m) => m && m.visible) || (s.water && s.wvis)) visible++;
          s.meshes.forEach((m, p) => { if (m) passes[p]++; });
          if (s.water) passes[TRANSLUCENT]++;
        }
        if (s.urgent) edits++;
      }
      world.forEachChunk((c) => { if (c.light) lit++; });
      return { loaded, lit, meshed, visible, passes, queued: ready.length, edits,
        lightMs: lightJobs ? +(lightMs / lightJobs).toFixed(2) : 0, relightMs: +relightMs.toFixed(2), relit: relitCells };
    },
  };
}
