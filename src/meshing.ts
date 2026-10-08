import * as THREE from 'three';
import { CS, H, NCX } from './config';
import { CI, world, type World } from './world';
import { FACES, PAD_VOL, PI, meshChunk, type MeshData } from './mesher';

/**
 * Copy chunk (cx, cz) plus a one-block border from its 8 neighbours into `out` (PI layout).
 * Missing neighbours and columns outside the world are left as air.
 */
export function paddedCopy(w: World, cx: number, cz: number, out: Uint8Array): void {
  out.fill(0);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const c = w.chunk(cx + dx, cz + dz);
    if (!c) continue;
    // local range copied from this neighbour, and where it lands in the padded volume
    const lx0 = dx < 0 ? CS - 1 : 0, lx1 = dx > 0 ? 1 : CS, lz0 = dz < 0 ? CS - 1 : 0, lz1 = dz > 0 ? 1 : CS;
    const ox = 1 + dx * CS, oz = 1 + dz * CS, len = lx1 - lx0, d = c.data;
    for (let y = 0; y < H; y++) for (let lz = lz0; lz < lz1; lz++) {
      const s = CI(lx0, y, lz), t = PI(lx0 + ox, y, lz + oz);
      if (len === 1) out[t] = d[s];
      else out.set(d.subarray(s, s + len), t);
    }
  }
}

/** Turn mesher output into a geometry (positions are relative to the chunk origin). */
export function chunkGeometry(m: MeshData): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(m.col, 3, true));
  geo.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  geo.setIndex(new THREE.BufferAttribute(m.index, 1));
  for (let i = 0; i < m.groups.length; i += 3) geo.addGroup(m.groups[i], m.groups[i + 1], m.groups[i + 2]);
  geo.computeBoundingSphere();
  return geo;
}

export interface ChunkMesher {
  /** Mark the chunks touched by a change at (x, z) — including neighbours, for AO — for rebuilding. */
  markDirty(x: number, z: number): void;
  /** Rebuild every dirty chunk. Called once per frame. */
  flush(): void;
}

/** Builds one mesh per loaded chunk (adding them to `scene`) and returns the rebuild API. */
export function createChunkMesher(scene: THREE.Scene, materials: THREE.Material[]): ChunkMesher {
  const meshes = new Map<number, THREE.Mesh>(), dirty = new Set<number>(), pad = new Uint8Array(PAD_VOL);

  function buildChunk(ci: number): void {
    const cx = ci % NCX, cz = Math.floor(ci / NCX);
    if (!world.chunk(cx, cz)) return;
    paddedCopy(world, cx, cz, pad);
    const geo = chunkGeometry(meshChunk(pad, cx * CS, cz * CS));
    let m = meshes.get(ci);
    if (!m) {
      m = new THREE.Mesh(geo, materials);
      m.position.set(cx * CS, 0, cz * CS);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      meshes.set(ci, m);
      scene.add(m);
    } else { m.geometry.dispose(); m.geometry = geo; }
  }
  world.forEachChunk((c) => buildChunk(c.cx + c.cz * NCX));

  return {
    markDirty(x, z) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const X = x + dx, Z = z + dz;
        if (world.isLoaded(X, Z)) dirty.add(Math.floor(X / CS) + Math.floor(Z / CS) * NCX);
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
