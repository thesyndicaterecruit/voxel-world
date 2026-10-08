import * as THREE from 'three';
import { B, SOLID, MODEL, T_DIRT, T_GRASS_SIDE } from './blocks';
import { boxesGeometry } from './meshing';
import { TEX } from './mesher';
import { TORCH_MODELS, type TorchQuad } from './torch';
import { world } from './world';
import { radialFog } from './fog';

/* ===================== TARGET OUTLINE, GHOST, PARTICLES ===================== */
export interface Effects {
  /** Dark wireframe box around the targeted block (position = the block's min corner). */
  outline: THREE.Mesh;
  /** Translucent preview of the block about to be placed (position = the block's min corner). */
  ghost: THREE.Mesh;
  ghostMat: THREE.MeshBasicMaterial;
  /** Show the outline around box b = [x0, y0, z0, x1, y1, z1] (block units) of block (x, y, z). */
  showOutline(x: number, y: number, z: number, b: number[]): void;
  /** Show the placement ghost of block `id` with block state `state` at (x, y, z): a cube or its model. */
  showGhost(x: number, y: number, z: number, id: number, state: number): void;
  /** Spray of little cubes textured like block `id` from the block at (x, y, z). */
  burst(x: number, y: number, z: number, id: number): void;
  updateParticles(dt: number): void;
}

/** A torch model (texels, see torch.ts) as a geometry in block units, for the placement ghost. */
function modelGeometry(quads: TorchQuad[]): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], index: number[] = [];
  for (const q of quads) {
    const n = pos.length / 3;
    for (let i = 0; i < 4; i++) { pos.push(q.p[i][0] / TEX, q.p[i][1] / TEX, q.p[i][2] / TEX); uv.push(q.uv[i][0] / TEX, q.uv[i][1] / TEX); }
    index.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

interface Particle { m: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>; v: number[]; life: number; max: number }

export function createEffects(scene: THREE.Scene, tex: THREE.Texture[]): Effects {
  // the outline is thin beams along the 12 edges of a box, built once per box (a cube, the torch boxes)
  // so the lines keep their thickness on small boxes
  const outlines = new Map<string, THREE.BufferGeometry>(), t = 0.012;
  function outlineGeometry(b: number[]): THREE.BufferGeometry {
    let g = outlines.get(b.join());
    if (!g) {
      const [x0, y0, z0, x1, y1, z1] = b, beams: number[][] = [];
      for (const p of [0, 1]) for (const q of [0, 1]) {
        const x = p ? x1 : x0, y = q ? y1 : y0, yy = p ? y1 : y0, z = q ? z1 : z0;
        beams.push([x0 - t, yy - t, z - t, x1 + t, yy + t, z + t]);   // along X
        beams.push([x - t, y0 - t, z - t, x + t, y1 + t, z + t]);     // along Y
        beams.push([x - t, y - t, z0 - t, x + t, y + t, z1 + t]);     // along Z
      }
      outlines.set(b.join(), (g = boxesGeometry(beams)));
    }
    return g;
  }
  const outline = new THREE.Mesh(outlineGeometry([0, 0, 0, 1, 1, 1]), radialFog(new THREE.MeshBasicMaterial({ color: 0x151515 })));
  outline.visible = false;
  scene.add(outline);
  const ghostMat = radialFog(new THREE.MeshBasicMaterial({ map: tex[T_GRASS_SIDE], transparent: true, opacity: 0.5, depthWrite: false }));
  const cube = new THREE.BoxGeometry(0.98, 0.98, 0.98).translate(0.5, 0.5, 0.5), torches = TORCH_MODELS.map(modelGeometry);
  const ghost = new THREE.Mesh(cube, ghostMat);
  ghost.visible = false;
  scene.add(ghost);

  const pGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16), parts: Particle[] = [];
  for (let i = 0; i < 36; i++) {
    const m = new THREE.Mesh(pGeo, radialFog(new THREE.MeshBasicMaterial({ map: tex[T_DIRT], alphaTest: 0.5 })));
    m.visible = false;
    scene.add(m);
    parts.push({ m, v: [0, 0, 0], life: 0, max: 1 });
  }

  function burst(x: number, y: number, z: number, id: number): void {
    const map = tex[B[id].particle];
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
      if (p.v[1] < 0 && SOLID[world.getBlock(Math.floor(q.x), Math.floor(ny - 0.08), Math.floor(q.z))]) {
        q.y = Math.floor(ny - 0.08) + 1.08; p.v[1] *= -0.3; p.v[0] *= 0.6; p.v[2] *= 0.6;
      } else q.y = ny;
      p.m.scale.setScalar(Math.min(1, (p.life / p.max) * 1.6));
    }
  }

  function showOutline(x: number, y: number, z: number, b: number[]): void {
    outline.visible = true;
    outline.geometry = outlineGeometry(b);
    outline.position.set(x, y, z);
  }
  function showGhost(x: number, y: number, z: number, id: number, state: number): void {
    ghost.visible = true;
    ghost.geometry = MODEL[id] === 1 ? torches[state <= 4 ? state : 0] : cube;
    ghost.position.set(x, y, z);
  }

  return { outline, ghost, ghostMat, showOutline, showGhost, burst, updateParticles };
}
