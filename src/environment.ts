import * as THREE from 'three';
import { WATER_Y, HORIZON, ZENITH } from './config';
import { rand } from './noise';
import { boxesGeometry } from './meshing';
import { ISLAND_X, ISLAND_Z, ISLAND_LIFT } from './world';

// the island's footprint: ocean and clouds are laid out around it
const X0 = ISLAND_X, Z0 = ISLAND_Z, X1 = ISLAND_X + 32, Z1 = ISLAND_Z + 32;

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
    // ocean: four big quads around the island at the water surface
    const OC = 300, pos: number[] = [], ind: number[] = [];
    for (const [x0, z0, x1, z1] of [[X0 - OC, Z0 - OC, X1 + OC, Z0], [X0 - OC, Z1, X1 + OC, Z1 + OC], [X0 - OC, Z0, X0, Z1], [X1, Z0, X1 + OC, Z1]]) {
      const b = pos.length / 3;
      pos.push(x0, WATER_Y, z1, x1, WATER_Y, z1, x1, WATER_Y, z0, x0, WATER_Y, z0);
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
    c.position.set(X0 - 80 + rand() * 190, ISLAND_LIFT + 44 + rand() * 7, Z0 - 70 + rand() * 170);
    scene.add(c);
    clouds.push(c);
  }

  return {
    update(dt, camera) {
      for (const c of clouds) { c.position.x += dt * 0.9; if (c.position.x > X1 + 100) c.position.x -= 220; }
      sky.position.copy(camera.position);
      sun.position.copy(camera.position).addScaledVector(SUN_DIR, 210);
      sun.lookAt(camera.position);
    },
  };
}
