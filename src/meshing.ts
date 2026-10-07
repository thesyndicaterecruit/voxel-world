import * as THREE from 'three';
import { H, CS, NCX, NCZ } from './config';
import { AIR, B, NT, ROT } from './blocks';
import { hash3 } from './noise';
import { vox, I, inXZ } from './world';

/* ======================= CHUNK MESHING (+AO) ======================= */
type V3 = [number, number, number];
interface Face {
  /** Normal */
  n: V3;
  /** Face kind: 0 side, 1 top, 2 bottom (indexes BlockDef.t) */
  k: number;
  /** Baked "sunlight" */
  s: number;
  /** Corners, CCW seen from outside */
  v: V3[];
  /** Per corner: the 3 neighbour offsets (side1, side2, diagonal) that occlude it, flattened */
  ao: number[][];
  /** Per corner texture coords */
  uv: [number, number][];
}

export const FACES: Face[] = ([
  { n: [1, 0, 0],  k: 0, s: 0.84, v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], k: 0, s: 0.62, v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0],  k: 1, s: 1.0,  v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], k: 2, s: 0.5,  v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1],  k: 0, s: 0.68, v: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], k: 0, s: 0.76, v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
] as Omit<Face, 'ao' | 'uv'>[]).map((F) => {
  // precompute the 3 neighbour offsets that occlude each corner
  const a = F.n[0] ? 0 : F.n[1] ? 1 : 2, u = (a + 1) % 3, w = (a + 2) % 3;
  const ao = F.v.map((c) => {
    const s1 = F.n.slice(), s2 = F.n.slice();
    s1[u] += c[u] ? 1 : -1; s2[w] += c[w] ? 1 : -1;
    const cr = s1.slice(); cr[w] += c[w] ? 1 : -1;
    return s1.concat(s2, cr);
  });
  // texture coords per corner (v follows +Y on side faces so grass overhang stays on top)
  const uv = F.v.map((c): [number, number] =>
    (F.n[1] ? [c[0], c[2]] : F.n[0] ? [F.n[0] > 0 ? 1 - c[2] : c[2], c[1]] : [F.n[2] > 0 ? c[0] : 1 - c[0], c[1]]));
  return { ...F, ao, uv };
});

const AO = [0.5, 0.68, 0.85, 1];
const occ = (x: number, y: number, z: number) => (inXZ(x, z) && y >= 0 && y < H && vox[I(x, y, z)] !== AIR ? 1 : 0);
function aoAt(x: number, y: number, z: number, o: number[]): number {
  const s1 = occ(x + o[0], y + o[1], z + o[2]), s2 = occ(x + o[3], y + o[4], z + o[5]);
  return s1 && s2 ? AO[0] : AO[3 - s1 - s2 - occ(x + o[6], y + o[7], z + o[8])];
}

export interface ChunkMesher {
  /** Mark the chunks touched by a change at (x, z) — including neighbours, for AO — for rebuilding. */
  markDirty(x: number, z: number): void;
  /** Rebuild every dirty chunk. Called once per frame. */
  flush(): void;
}

/** Builds one mesh per CS×H×CS chunk (adding them to `scene`) and returns the rebuild API. */
export function createChunkMesher(scene: THREE.Scene, materials: THREE.Material[]): ChunkMesher {
  const chunks: THREE.Mesh[] = [], dirty = new Set<number>();

  function buildChunk(ci: number): void {
    const x0 = (ci % NCX) * CS, z0 = Math.floor(ci / NCX) * CS;
    const pos: number[] = [], col: number[] = [], uv: number[] = [], lists: number[][] = [];
    for (let t = 0; t < NT; t++) lists.push([]);   // one index list per texture → one draw group each
    const quad = (x: number, y: number, z: number, F: Face, tl: number, rot: number,
      l0: number, l1: number, l2: number, l3: number, sh: number) => {
      const base = pos.length / 3, L = [l0, l1, l2, l3], list = lists[tl];
      for (let i = 0; i < 4; i++) {
        const v = F.v[i], k = sh * L[i], q = F.uv[(i + rot) & 3];
        pos.push(x + v[0], y + v[1], z + v[2]);
        col.push(k, k, k);                         // baked light + AO tints the texture
        uv.push(q[0], q[1]);
      }
      // flip the quad diagonal so AO interpolates smoothly
      if (l0 + l2 > l1 + l3) list.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      else list.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (let y = 0; y < H; y++) for (let z = z0; z < z0 + CS; z++) for (let x = x0; x < x0 + CS; x++) {
      const id = vox[I(x, y, z)];
      if (id === AIR) continue;
      const b = B[id], j = 1 - b.jit * hash3(x, y, z);
      for (let f = 0; f < 6; f++) {
        const F = FACES[f], nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
        if (ny < 0 || (ny < H && inXZ(nx, nz) && vox[I(nx, ny, nz)] !== AIR)) continue; // hidden face
        const o = F.ao;
        const l0 = aoAt(x, y, z, o[0]), l1 = aoAt(x, y, z, o[1]), l2 = aoAt(x, y, z, o[2]), l3 = aoAt(x, y, z, o[3]);
        const tl = b.t[F.k];
        const rot = ROT.has(tl) ? Math.floor(hash3(x * 3 + f, y, z - f) * 4) : 0;
        quad(x, y, z, F, tl, rot, l0, l1, l2, l3, F.s * j);
      }
    }
    const geo = new THREE.BufferGeometry(), all: number[] = [];
    for (let t = 0; t < NT; t++) {
      const l = lists[t];
      if (!l.length) continue;
      geo.addGroup(all.length, l.length, t);
      for (let i = 0; i < l.length; i++) all.push(l[i]);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(all);
    geo.computeBoundingSphere();
    let m = chunks[ci];
    if (!m) { m = chunks[ci] = new THREE.Mesh(geo, materials); m.matrixAutoUpdate = false; scene.add(m); }
    else { m.geometry.dispose(); m.geometry = geo; }
  }
  for (let ci = 0; ci < NCX * NCZ; ci++) buildChunk(ci);

  return {
    markDirty(x, z) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const X = x + dx, Z = z + dz;
        if (inXZ(X, Z)) dirty.add(Math.floor(X / CS) + Math.floor(Z / CS) * NCX);
      }
    },
    flush() {
      if (dirty.size) { dirty.forEach(buildChunk); dirty.clear(); }
    },
  };
}

/** Many axis-aligned boxes [x0,y0,z0,x1,y1,z1] in one vertex-coloured geometry (outline, clouds). */
export function boxesGeometry(list: number[][]): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], ind: number[] = [];
  for (const b of list) for (const F of FACES) {
    const base = pos.length / 3, k = 0.82 + 0.18 * F.s;
    for (const c of F.v) { pos.push(c[0] ? b[3] : b[0], c[1] ? b[4] : b[1], c[2] ? b[5] : b[2]); col.push(k, k, k); }
    ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(ind);
  return g;
}
