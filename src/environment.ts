import * as THREE from 'three';
import { WATER_Y, HORIZON, ZENITH } from './config';
import { mulberry } from './noise';
import { boxesGeometry } from './meshing';

/* ======================= SKY, SUN, WATER, CLOUDS ======================= */
const WATER = 0x3b86cc;
// Under water: short blue fog, blue background, and a CSS tint over the view (body.under)
const UNDER = 0x1f5f94, UNDER_NEAR = -4, UNDER_FAR = 20;
// Clouds live in a box around the camera and wrap around it as it moves
const CLOUD_BOX = 320;

export interface Environment {
  /** Drift the clouds, keep sky, sun and water centred on the camera, switch the underwater look. */
  update(dt: number, camera: THREE.Camera): void;
  /** Fog for normal (above-water) viewing: terrain fades from `near` to fully hidden at `far`. */
  setFog(near: number, far: number): void;
}

/**
 * `seed` lays out the clouds (same seed, same sky); (x, z) is where they start out, around the
 * spawn point.
 */
export function createEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, seed: number, x: number, z: number): Environment {
  const fog = new THREE.Fog(HORIZON, 34, 110);
  scene.fog = fog;
  let fogNear = fog.near, fogFar = fog.far, under = false;

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

  // one water surface over the whole world (it follows the camera, so it never ends); seen from
  // both sides, and slightly see-through so shallow seabeds show
  const waterGeo = new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, new THREE.MeshBasicMaterial({ color: WATER, side: THREE.DoubleSide, transparent: true, opacity: 0.82 }));
  water.position.y = WATER_Y;
  scene.add(water);

  const rand = mulberry(seed ^ 0x5bd1e995);
  const cloudMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const clouds: THREE.Mesh[] = [];
  for (let i = 0; i < 14; i++) {
    const boxes: number[][] = [], n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const w = 4 + rand() * 7, d = 3 + rand() * 5, ox = (rand() - 0.5) * 8, oz = (rand() - 0.5) * 6;
      boxes.push([ox, 0, oz, ox + w, 1.2, oz + d]);
    }
    const c = new THREE.Mesh(boxesGeometry(boxes), cloudMat);
    c.position.set(x + (rand() - 0.5) * CLOUD_BOX, 64 + rand() * 8, z + (rand() - 0.5) * CLOUD_BOX);
    scene.add(c);
    clouds.push(c);
  }
  const wrap = (v: number, around: number) => v - Math.round((v - around) / CLOUD_BOX) * CLOUD_BOX;
  const tint = document.body.classList;

  return {
    update(dt, camera) {
      const cam = camera.position;
      for (const c of clouds) {
        c.position.x = wrap(c.position.x + dt * 0.9, cam.x);
        c.position.z = wrap(c.position.z, cam.z);
      }
      sky.position.copy(cam);
      sun.position.copy(cam).addScaledVector(SUN_DIR, 210);
      sun.lookAt(cam);
      water.position.x = cam.x;
      water.position.z = cam.z;

      const u = cam.y < WATER_Y;
      if (u !== under) {
        under = u;
        fog.color.setHex(u ? UNDER : HORIZON);
        fog.near = u ? UNDER_NEAR : fogNear;
        fog.far = u ? UNDER_FAR : fogFar;
        renderer.setClearColor(u ? UNDER : HORIZON);
        sky.visible = sun.visible = !u;
        for (const c of clouds) c.visible = !u;
        tint.toggle('under', u);
      }
    },
    setFog(near, far) {
      fogNear = near; fogFar = far;
      if (!under) { fog.near = near; fog.far = far; }
    },
  };
}
