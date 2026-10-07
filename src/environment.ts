import * as THREE from 'three';
import { W, D, SEA, HORIZON, ZENITH } from './config';
import { rand } from './noise';
import { boxesGeometry } from './meshing';

/* ======================= SKY, SUN, OCEAN, CLOUDS ======================= */
export interface Environment {
  /** Drift the clouds and keep sky + sun centred on the camera. */
  update(dt: number, camera: THREE.Camera): void;
}

export function createEnvironment(scene: THREE.Scene): Environment {
  const skyGeo = new THREE.SphereGeometry(250, 32, 16);
  {
    const p = skyGeo.attributes.position, cols: number[] = [];
    const cz = new THREE.Color(ZENITH), ch = new THREE.Color(HORIZON), tc = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      tc.copy(ch).lerp(cz, Math.pow(Math.max(0, p.getY(i) / 250), 0.6));
      cols.push(tc.r, tc.g, tc.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  }
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);
  const SUN_DIR = new THREE.Vector3(0.55, 0.62, -0.56).normalize();
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0xfff6c8, fog: false }));
  scene.add(sun);
  {
    // ocean: four big quads around the island at sea level
    const OC = 300, pos: number[] = [], ind: number[] = [];
    for (const [x0, z0, x1, z1] of [[-OC, -OC, W + OC, 0], [-OC, D, W + OC, D + OC], [-OC, 0, 0, D], [W, 0, W + OC, D]]) {
      const b = pos.length / 3;
      pos.push(x0, SEA, z1, x1, SEA, z1, x1, SEA, z0, x0, SEA, z0);
      ind.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(ind);
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x3b86cc })));
  }
  const cloudMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const clouds: THREE.Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const boxes: number[][] = [], n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const w = 4 + rand() * 7, d = 3 + rand() * 5, ox = (rand() - 0.5) * 8, oz = (rand() - 0.5) * 6;
      boxes.push([ox, 0, oz, ox + w, 1.2, oz + d]);
    }
    const c = new THREE.Mesh(boxesGeometry(boxes), cloudMat);
    c.position.set(-80 + rand() * 190, 44 + rand() * 7, -70 + rand() * 170);
    scene.add(c);
    clouds.push(c);
  }

  return {
    update(dt, camera) {
      for (const c of clouds) { c.position.x += dt * 0.9; if (c.position.x > W + 100) c.position.x -= 220; }
      sky.position.copy(camera.position);
      sun.position.copy(camera.position).addScaledVector(SUN_DIR, 210);
      sun.lookAt(camera.position);
    },
  };
}
