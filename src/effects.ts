import * as THREE from 'three';
import { AIR, B, T_DIRT, T_GRASS_SIDE } from './blocks';
import { boxesGeometry } from './meshing';
import { world } from './world';
import { radialFog } from './fog';

/* ===================== TARGET OUTLINE, GHOST, PARTICLES ===================== */
export interface Effects {
  /** Dark wireframe cube around the targeted block (position = block min corner). */
  outline: THREE.Mesh;
  /** Translucent preview of the block about to be placed (position = block centre). */
  ghost: THREE.Mesh;
  ghostMat: THREE.MeshBasicMaterial;
  /** Spray of little cubes textured like block `id` from the block at (x, y, z). */
  burst(x: number, y: number, z: number, id: number): void;
  updateParticles(dt: number): void;
}

interface Particle { m: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>; v: number[]; life: number; max: number }

export function createEffects(scene: THREE.Scene, tex: THREE.Texture[]): Effects {
  const beams: number[][] = [], bt = 0.012, be = 0.012;
  for (const a of [0, 1]) for (const b of [0, 1]) {
    beams.push([-be, a - bt, b - bt, 1 + be, a + bt, b + bt]); // along X
    beams.push([a - bt, -be, b - bt, a + bt, 1 + be, b + bt]); // along Y
    beams.push([a - bt, b - bt, -be, a + bt, b + bt, 1 + be]); // along Z
  }
  const outline = new THREE.Mesh(boxesGeometry(beams), radialFog(new THREE.MeshBasicMaterial({ color: 0x151515 })));
  outline.visible = false;
  scene.add(outline);
  const ghostMat = radialFog(new THREE.MeshBasicMaterial({ map: tex[T_GRASS_SIDE], transparent: true, opacity: 0.5, depthWrite: false }));
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.98, 0.98), ghostMat);
  ghost.visible = false;
  scene.add(ghost);

  const pGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16), parts: Particle[] = [];
  for (let i = 0; i < 36; i++) {
    const m = new THREE.Mesh(pGeo, radialFog(new THREE.MeshBasicMaterial({ map: tex[T_DIRT] })));
    m.visible = false;
    scene.add(m);
    parts.push({ m, v: [0, 0, 0], life: 0, max: 1 });
  }

  function burst(x: number, y: number, z: number, id: number): void {
    const map = tex[B[id].t[0]];
    let n = 0;
    for (const p of parts) {
      if (p.life > 0) continue;
      p.m.position.set(x + 0.15 + Math.random() * 0.7, y + 0.15 + Math.random() * 0.7, z + 0.15 + Math.random() * 0.7);
      p.v[0] = (Math.random() - 0.5) * 4.5; p.v[1] = 1.5 + Math.random() * 3.5; p.v[2] = (Math.random() - 0.5) * 4.5;
      p.life = p.max = 0.5 + Math.random() * 0.4;
      const k = 0.7 + Math.random() * 0.4;
      p.m.material.map = map;
      p.m.material.color.setScalar(k);
      p.m.scale.setScalar(1);
      p.m.visible = true;
      if (++n >= 12) break;
    }
  }
  function updateParticles(dt: number): void {
    for (const p of parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.m.visible = false; continue; }
      const q = p.m.position;
      p.v[1] -= 20 * dt;
      q.x += p.v[0] * dt; q.z += p.v[2] * dt;
      const ny = q.y + p.v[1] * dt;
      if (p.v[1] < 0 && world.getBlock(Math.floor(q.x), Math.floor(ny - 0.08), Math.floor(q.z)) !== AIR) {
        q.y = Math.floor(ny - 0.08) + 1.08; p.v[1] *= -0.3; p.v[0] *= 0.6; p.v[2] *= 0.6;
      } else q.y = ny;
      p.m.scale.setScalar(Math.min(1, (p.life / p.max) * 1.6));
    }
  }

  return { outline, ghost, ghostMat, burst, updateParticles };
}
