import * as THREE from 'three';
import { CB, CS, NCX, NCZ, inWorld } from './config';
import { world, type Chunk } from './world';
import { PAD_VOL, type MeshData } from './mesher';
import { paddedCopy, chunkGeometry } from './meshing';
import type { WorkerPool } from './workers';

/* ============================ CHUNK STREAMING ============================ */
// Keeps the chunks around the player loaded and meshed. Distances are measured from the streaming
// centre to the nearest point of each chunk, in blocks:
//   ≤ R·CS          mesh region: meshed and drawn (fog hides everything beyond R·CS)
//   ≤ R·CS + 24     load region: loaded, so every meshed chunk has its 8 neighbours for face
//                   culling and AO at its borders (a diagonal neighbour is ≤ 16√2 further away);
//                   meshes that drift out of it are disposed
//   ≤ R·CS + 48     keep region: still loaded (hysteresis); anything further is unloaded, saved
//                   first if it was edited
// Generation and meshing run in workers. The main thread only copies a padded chunk per mesh job,
// uploads at most UPLOADS_PER_FRAME new meshes a frame, and lets edits jump the queue.

export const RENDER_DISTANCE = { def: 6, min: 3, max: 10 };
const LOAD_MARGIN = 24, KEEP_MARGIN = 48;
const UPLOADS_PER_FRAME = 2;
/** Most normal jobs started per frame (bounds the main-thread copying) */
const DISPATCH_PER_FRAME = 8;

const NONE = 0, LOADING = 1, LOADED = 2;
interface Slot {
  state: number;
  /** Bumped on every (un)load, so late worker results for an old load are ignored */
  epoch: number;
  /** Bumped whenever the mesh inputs change: an edit in this chunk or on a neighbour's border */
  version: number;
  /** Version of the mesh being shown (-1: none yet) */
  meshed: number;
  /** Latest version sent to a worker (-1: none in flight) */
  sent: number;
  /** An edit is waiting for its re-mesh */
  urgent: boolean;
  mesh: THREE.Mesh | null;
  /** Nearest distance from the streaming centre in blocks, refreshed every frame */
  dist: number;
  score: number;
}
interface Ready { ci: number; epoch: number; version: number; urgent: boolean; data: MeshData }

export interface ChunkSource {
  /** Edited contents of chunk (cx, cz) kept from earlier, or null to generate it from the seed. */
  load?(cx: number, cz: number): Promise<{ data: Uint8Array; state: Uint8Array | null }> | null;
  /** Called with a chunk that is about to be dropped from memory (keep it if it was edited). */
  unload?(c: Chunk): void;
}

export interface Streamer {
  /** Once per frame: stream around (x, z), preferring chunks in view direction (fx, fz). */
  update(x: number, z: number, fx: number, fz: number): void;
  /** A block changed at (x, z): re-mesh the chunks it touches ahead of everything else. */
  markDirty(x: number, z: number): void;
  setRenderDistance(r: number): void;
  /** Are all chunks within `radius` blocks of (x, z) loaded and meshed? */
  isReady(x: number, z: number, radius: number): boolean;
  /** Are the chunks under and right around (x, z) loaded? (physics only runs when they are) */
  areaLoaded(x: number, z: number): boolean;
  /** Debugging: one chunk's streaming state (0 none, 1 loading, 2 loaded), mesh versions and triangles */
  debugChunk(cx: number, cz: number): { state: number; version: number; meshed: number; tris: number };
  /** Counts for debugging: loaded chunks, meshes, visible meshes, finished meshes waiting, edits waiting */
  stats(): { loaded: number; meshed: number; visible: number; queued: number; edits: number };
}

export function createStreamer(scene: THREE.Scene, material: THREE.Material, pool: WorkerPool, source: ChunkSource = {}): Streamer {
  const slots: Slot[] = Array.from({ length: NCX * NCZ }, () =>
    ({ state: NONE, epoch: 0, version: 0, meshed: -1, sent: -1, urgent: false, mesh: null, dist: Infinity, score: 0 }));
  let R = RENDER_DISTANCE.def;
  const ready: Ready[] = [], urgentQ: number[] = [], pads: Uint8Array[] = [];
  let fresh: THREE.Mesh[] = [];                 // meshes added last frame (frustum culling off once)
  let urgentScheduled = false;

  const neighboursLoaded = (cx: number, cz: number) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, z = cz + dz;
      if (x >= 0 && x < NCX && z >= 0 && z < NCZ && slots[x + z * NCX].state !== LOADED) return false;
    }
    return true;
  };

  function dispatchLoad(ci: number): void {
    const s = slots[ci], cx = ci % NCX, cz = (ci / NCX) | 0, epoch = ++s.epoch;
    s.state = LOADING;
    const done = (data: Uint8Array, state: Uint8Array | null, edited: boolean) => {
      if (s.epoch !== epoch || s.state !== LOADING) return;   // unloaded meanwhile
      world.setChunk(cx, cz, data, state, edited);
      s.state = LOADED; s.version = 0; s.meshed = -1; s.sent = -1; s.urgent = false;
    };
    const gen = () => pool.run({ type: 'gen', id: 0, seed: world.seed, cx, cz }, [], (res) => { if (res.type === 'gen') done(res.data, null, false); });
    const saved = source.load ? source.load(cx, cz) : null;
    if (saved) saved.then((c) => done(c.data, c.state, true), gen);
    else gen();
  }

  function dispatchMesh(ci: number, urgent: boolean): void {
    const s = slots[ci], cx = ci % NCX, cz = (ci / NCX) | 0, epoch = s.epoch, version = s.version;
    const pad = pads.pop() || new Uint8Array(PAD_VOL);
    paddedCopy(world, cx, cz, pad);
    s.sent = version;
    pool.run({ type: 'mesh', id: 0, seed: world.seed, cx, cz, pad }, [pad.buffer], (res) => {
      if (res.type !== 'mesh') return;
      pads.push(res.pad);
      if (s.sent === version) s.sent = -1;
      if (s.epoch === epoch) ready.push({ ci, epoch, version, urgent, data: res.mesh });
    });
  }

  // edits: coalesce the setBlock calls of one action, then send them straight to the workers
  function pumpUrgent(): void {
    urgentScheduled = false;
    while (urgentQ.length) {
      const ci = urgentQ.shift()!, s = slots[ci];
      if (s.state === LOADED && s.urgent && s.sent !== s.version) dispatchMesh(ci, true);
    }
  }

  function applyMesh(r: Ready): void {
    const s = slots[r.ci];
    if (s.epoch !== r.epoch || s.state !== LOADED || r.version <= s.meshed) return;   // stale
    s.meshed = r.version;
    if (r.version === s.version) s.urgent = false;
    if (!r.data.index.length) { if (s.mesh) disposeMesh(s); return; }
    const geo = chunkGeometry(r.data);
    if (s.mesh) { s.mesh.geometry.dispose(); s.mesh.geometry = geo; return; }
    const m = new THREE.Mesh(geo, material), cx = r.ci % NCX, cz = (r.ci / NCX) | 0;
    m.position.set(cx * CS, 0, cz * CS);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.frustumCulled = false;                 // draw (= upload) it this frame even if out of view
    fresh.push(m);
    scene.add(m);
    s.mesh = m;
  }

  function disposeMesh(s: Slot): void {
    if (!s.mesh) return;
    scene.remove(s.mesh);
    s.mesh.geometry.dispose();
    s.mesh = null;
  }

  function unload(ci: number): void {
    const s = slots[ci], cx = ci % NCX, cz = (ci / NCX) | 0, c = world.chunk(cx, cz);
    if (c && source.unload) source.unload(c);
    world.removeChunk(cx, cz);
    disposeMesh(s);
    s.state = NONE; s.epoch++; s.version = 0; s.meshed = -1; s.sent = -1; s.urgent = false;
  }

  return {
    update(px, pz, fx, fz) {
      for (const m of fresh) m.frustumCulled = true;
      fresh = [];
      // finished meshes: every edit re-mesh now, new chunks within the upload budget, nearest first
      if (ready.length) {
        ready.sort((a, b) => (a.urgent !== b.urgent ? (a.urgent ? -1 : 1) : slots[a.ci].score - slots[b.ci].score));
        let uploads = 0;
        for (let i = 0; i < ready.length; i++) {
          const r = ready[i], s = slots[r.ci];
          if (!r.urgent && !s.mesh && s.epoch === r.epoch && r.version > s.meshed && r.data.index.length) {
            if (uploads >= UPLOADS_PER_FRAME) continue;
            uploads++;
          }
          applyMesh(r);
          ready.splice(i--, 1);
        }
      }

      const meshD = R * CS, loadD = meshD + LOAD_MARGIN, keepD = meshD + KEEP_MARGIN;
      const fl = Math.sqrt(fx * fx + fz * fz), ux = fl > 1e-3 ? fx / fl : 0, uz = fl > 1e-3 ? fz / fl : 0;
      const cands: number[] = [];
      for (let ci = 0; ci < slots.length; ci++) {
        const s = slots[ci], x0 = (ci % NCX) * CS, z0 = ((ci / NCX) | 0) * CS;
        const dx = Math.max(x0 - px, 0, px - x0 - CS), dz = Math.max(z0 - pz, 0, pz - z0 - CS);
        const d = s.dist = Math.sqrt(dx * dx + dz * dz);
        if (s.state !== NONE && d > keepD) { unload(ci); continue; }
        if (s.mesh) {
          if (d > loadD) { disposeMesh(s); s.meshed = -1; }
          else s.mesh.visible = d <= meshD;
        }
        // priority: nearest first, chunks in front of the camera before those behind
        const cx = x0 + CS / 2 - px, cz = z0 + CS / 2 - pz, cl = Math.sqrt(cx * cx + cz * cz);
        s.score = d < CS ? d * 0.5 : d * (1 - 0.45 * (cl > 1e-3 ? (cx * ux + cz * uz) / cl : 0));
        if (s.state === NONE ? d <= loadD
          : s.state === LOADED && d <= meshD && s.meshed < s.version && s.sent < s.version && !s.urgent && neighboursLoaded(ci % NCX, (ci / NCX) | 0)) cands.push(ci);
      }
      // brand-new chunks start at version 0 with meshed = -1, so they count as needing a mesh
      cands.sort((a, b) => slots[a].score - slots[b].score);
      for (let i = 0, n = 0; i < cands.length && n < DISPATCH_PER_FRAME && pool.free() > 0; i++, n++) {
        const ci = cands[i];
        if (slots[ci].state === NONE) dispatchLoad(ci);
        else dispatchMesh(ci, false);
      }
    },

    markDirty(x, z) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Z = z + dz;
        if (!inWorld(X, Z)) continue;
        const ci = (X >> CB) + (Z >> CB) * NCX, s = slots[ci];
        if (s.state !== LOADED || urgentQ.includes(ci)) continue;
        s.version++;
        s.urgent = true;
        urgentQ.push(ci);
      }
      if (!urgentScheduled) { urgentScheduled = true; queueMicrotask(pumpUrgent); }
    },

    setRenderDistance(r) { R = Math.max(RENDER_DISTANCE.min, Math.min(RENDER_DISTANCE.max, r)); },

    isReady(x, z, radius) {
      for (let ci = 0; ci < slots.length; ci++) {
        const s = slots[ci], x0 = (ci % NCX) * CS, z0 = ((ci / NCX) | 0) * CS;
        const dx = Math.max(x0 - x, 0, x - x0 - CS), dz = Math.max(z0 - z, 0, z - z0 - CS);
        if (dx * dx + dz * dz <= radius * radius && (s.state !== LOADED || s.meshed < 0)) return false;
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

    debugChunk(cx, cz) {
      const s = slots[cx + cz * NCX], idx = s.mesh && s.mesh.geometry.index;
      return { state: s.state, version: s.version, meshed: s.meshed, tris: idx ? idx.count / 3 : 0 };
    },

    stats() {
      let loaded = 0, meshed = 0, visible = 0, edits = 0;
      for (const s of slots) {
        if (s.state === LOADED) loaded++;
        if (s.mesh) { meshed++; if (s.mesh.visible) visible++; }
        if (s.urgent) edits++;
      }
      return { loaded, meshed, visible, queued: ready.length, edits };
    },
  };
}
