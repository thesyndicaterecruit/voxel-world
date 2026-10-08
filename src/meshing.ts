import * as THREE from 'three';
import { CS, H, CI } from './config';
import type { World } from './world';
import { FACES, PI, type PassMesh } from './mesher';

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

/**
 * Turn one pass of mesher output into a geometry. Positions are relative to the chunk origin in 1/FP
 * block, so the mesh is scaled by 1/FP; the material divides the texel uvs by TEX.
 */
export function chunkGeometry(m: PassMesh): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(m.col, 3, true));
  geo.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  geo.setAttribute('layer', new THREE.BufferAttribute(m.layer, 1));
  geo.setIndex(new THREE.BufferAttribute(m.index, 1));
  geo.computeBoundingSphere();
  return geo;
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
