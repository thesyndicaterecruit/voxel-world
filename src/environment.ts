import * as THREE from 'three';
import { W, D } from './config';
import { mulberry } from './noise';
import { boxesGeometry } from './meshing';
import { radialFogVertex } from './fog';
import { lightUniforms } from './shading';

/* ======================= SKY, SUN, MOON, STARS, SEA, CLOUDS ======================= */
// Everything here follows the time of day (setTime): where the sun and moon are, the sky gradient
// and the glow around a low sun, fog, sea and cloud colours, the stars, and the light uniforms
// the chunk shader reads (daylight, sky tint, the sky colour water reflects). Time of day t:
// 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
// The sea inside the world is water blocks (chunk meshes); beyond the world's edge a flat sea
// carries on to the horizon.
// Under water: short blue fog, blue background, and a CSS tint over the view (body.under), all darker
// the deeper the camera is (down to DEEP blocks) and at night
const UNDER = new THREE.Color(0x1f5f94), UNDER_NIGHT = new THREE.Color(0x07182c), UNDER_NEAR = -4, UNDER_FAR = 20, DEEP = 24;
// Clouds live in a box around the camera and wrap around it as it moves
const CLOUD_BOX = 320;
/** The sun's path is tilted this far toward −z (north of overhead at noon) */
const TILT = (30 * Math.PI) / 180;
/** Skylight at night (moonlight): enough to see by */
const NIGHT_LIGHT = 0.38;

const col = (hex: number) => new THREE.Color(hex);
// colours by day, around sunrise/sunset, and at night
const SKY = {
  horizon: [col(0xcde6f7), col(0xe7a47e), col(0x16213a)],
  zenith: [col(0x4a95e3), col(0x47629e), col(0x050a18)],
  water: [col(0x3b86cc), col(0x3f6c98), col(0x0b1c34)],
  cloud: [col(0xffffff), col(0xffd2bd), col(0x252c3d)],
  tint: [col(0xffffff), col(0xffdcb8), col(0x9eb4ff)],
  sun: [col(0xfff6c8), col(0xffad62)],
};

const SKY_VERTEX = `
varying vec3 vDir;
void main() {
	vDir = position;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
const SKY_FRAGMENT = `
uniform vec3 horizon, zenith, glow, sunDir;
varying vec3 vDir;
void main() {
	vec3 d = normalize( vDir );
	float h = max( d.y, 0.0 );
	vec3 c = mix( horizon, zenith, pow( h, 0.6 ) );
	c += glow * pow( max( dot( d, sunDir ), 0.0 ), 6.0 ) * ( 1.0 - h );   // around a low sun
	gl_FragColor = vec4( c, 1.0 );
}`;
const STAR_VERTEX = `
attribute float size;
attribute float bright;
uniform float alpha, scale;
varying float vAlpha;
void main() {
	vec4 wp = modelMatrix * vec4( position, 1.0 );
	vAlpha = alpha * bright * smoothstep( 0.02, 0.2, normalize( wp.xyz - cameraPosition ).y );   // fade toward the horizon
	gl_PointSize = size * scale;
	gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const STAR_FRAGMENT = `
varying float vAlpha;
void main() { gl_FragColor = vec4( 1.0, 0.97, 0.9, vAlpha ); }`;

/** A small pixel-art moon: pale, with a few darker patches */
function moonTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#e9edf5'; g.fillRect(2, 2, 12, 12);
  g.fillStyle = '#c9d0de';
  for (const [x, y, w, h] of [[4, 4, 3, 2], [9, 6, 2, 3], [5, 9, 2, 2], [10, 11, 2, 1], [7, 7, 1, 1]]) g.fillRect(x, y, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  return t;
}

export interface Environment {
  /**
   * Drift the clouds, keep sky, sun and sea centred on the camera, switch the underwater look:
   * `depth` is how far the camera is below the water's surface (−1: not in water).
   */
  update(dt: number, camera: THREE.Camera, depth: number): void;
  /** Fog for normal (above-water) viewing: terrain fades from `near` to fully hidden at `far`. */
  setFog(near: number, far: number): void;
  /** Time of day, 0–1 (0 midnight, 0.5 noon): moves the sun, recolours everything, sets the light uniforms. */
  setTime(t: number): void;
  /** The biome haze where the camera is: fog and sky lean toward `color` by `amount` (0–1), easing over a second or two */
  setHaze(color: THREE.Color, amount: number): void;
}

/**
 * `seed` lays out the clouds and the stars (same seed, same sky); (x, z) is where the clouds start
 * out, around the spawn point. The sea beyond the world's edge is at `seaLevel`; the clouds float
 * from `cloudY` up.
 */
export function createEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, seed: number, x: number, z: number,
  seaLevel: number, cloudY: number): Environment {
  const fog = new THREE.Fog(SKY.horizon[0].getHex(), 34, 110);
  scene.fog = fog;
  let fogNear = fog.near, fogFar = fog.far, under = false;

  const skyU = {
    horizon: { value: new THREE.Color() }, zenith: { value: new THREE.Color() },
    glow: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(250, 32, 16), new THREE.ShaderMaterial({
    uniforms: skyU, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false,
  }));
  sky.renderOrder = -1;
  scene.add(sky);

  const sunMat = new THREE.MeshBasicMaterial({ color: SKY.sun[0], fog: false });
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), sunMat);
  const moonMat = new THREE.MeshBasicMaterial({ map: moonTexture(), transparent: true, fog: false });
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), moonMat);
  scene.add(sun, moon);

  // stars: fixed points on a sphere around the camera, turning with the sky; they fade in at dusk
  const rand = mulberry(seed ^ 0x5bd1e995), N = 700;
  const pos = new Float32Array(N * 3), size = new Float32Array(N), bright = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * r * 230, u * 230, Math.sin(a) * r * 230], i * 3);
    const big = rand() < 0.08;
    size[i] = big ? 2.6 : 1.2 + rand() * 0.9;
    bright[i] = big ? 1 : 0.45 + rand() * 0.5;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  starGeo.setAttribute('bright', new THREE.BufferAttribute(bright, 1));
  const starU = { alpha: { value: 0 }, scale: { value: 1 } };
  const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({
    uniforms: starU, vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT, transparent: true, depthWrite: false,
  }));
  stars.frustumCulled = false;
  scene.add(stars);
  /** The axis the sky turns around (normal to the sun's path) */
  const axis = new THREE.Vector3(0, Math.sin(TILT), Math.cos(TILT));

  // the sea beyond the world's edge: a plane at the sea's surface that follows the camera, cut out
  // over the world (which has its own water), reflecting the sky like the water blocks do
  const seaMat = new THREE.MeshBasicMaterial({ color: SKY.water[0] });
  seaMat.onBeforeCompile = (sh) => {
    sh.uniforms.skyColor = lightUniforms.skyColor;
    radialFogVertex(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\nvarying vec3 vView;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvView = mvPosition.xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\nvarying vec3 vView;\nuniform vec3 skyColor;')
      .replace('#include <color_fragment>', `#include <color_fragment>
	if ( vWorld.x > 0.0 && vWorld.x < ${W}.0 && vWorld.z > 0.0 && vWorld.z < ${D}.0 ) discard;
	float facing = abs( dot( normalize( cross( dFdx( vView ), dFdy( vView ) ) ), normalize( vView ) ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, skyColor, 0.1 + 0.75 * pow( 1.0 - facing, 4.0 ) );`);
  };
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), seaMat);
  sea.position.y = seaLevel - 0.125;                   // a source block's surface
  scene.add(sea);

  const cloudMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const clouds: THREE.Mesh[] = [];
  for (let i = 0; i < 14; i++) {
    const boxes: number[][] = [], n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const w = 4 + rand() * 7, d = 3 + rand() * 5, ox = (rand() - 0.5) * 8, oz = (rand() - 0.5) * 6;
      boxes.push([ox, 0, oz, ox + w, 1.2, oz + d]);
    }
    const c = new THREE.Mesh(boxesGeometry(boxes), cloudMat);
    c.position.set(x + (rand() - 0.5) * CLOUD_BOX, cloudY + rand() * 8, z + (rand() - 0.5) * CLOUD_BOX);
    scene.add(c);
    clouds.push(c);
  }
  const wrap = (v: number, around: number) => v - Math.round((v - around) / CLOUD_BOX) * CLOUD_BOX;
  const tint = document.body.classList;

  const sunDir = new THREE.Vector3(0, 1, 0), horizon = new THREE.Color(), underCol = new THREE.Color();
  let day = 1, deep = 0, dim = -1;
  // biome haze: what the fog and sky lean toward, easing to the target set by setHaze
  const haze = new THREE.Color(), hazeTo = new THREE.Color(), hazeLit = new THREE.Color();
  let hazeAmt = 0, hazeAmtTo = 0;
  const DAY_LUMA = SKY.horizon[0].r * 0.3 + SKY.horizon[0].g * 0.59 + SKY.horizon[0].b * 0.11;
  /** c = by-day colour blended toward night by `day`, then toward the sunrise/sunset one by `dusk` */
  const blend = (out: THREE.Color, set: THREE.Color[], dusk: number) =>
    out.copy(set[2]).lerp(set[0], day).lerp(set[1], dusk);
  const applyFog = () => {
    const c = under ? underCol.copy(UNDER_NIGHT).lerp(UNDER, day).multiplyScalar(1 - 0.65 * deep) : horizon;
    fog.color.copy(c);
    renderer.setClearColor(c);
    // the CSS tint darkens with depth and at night too
    const d = under ? +(1 - (0.35 + 0.65 * day) * (1 - 0.65 * deep)).toFixed(2) : 0;
    if (d !== dim) { dim = d; document.body.style.setProperty('--dim', String(d)); }
  };

  const env: Environment = {
    update(dt, camera, depth) {
      const u = depth >= 0, ease = 1 - Math.exp(-dt / 1.2);
      haze.lerp(hazeTo, ease);
      hazeAmt += (hazeAmtTo - hazeAmt) * ease;
      const cam = camera.position;
      for (const c of clouds) {
        c.position.x = wrap(c.position.x + dt * 0.9, cam.x);
        c.position.z = wrap(c.position.z, cam.z);
      }
      sky.position.copy(cam);
      stars.position.copy(cam);
      sun.position.copy(cam).addScaledVector(sunDir, 210);
      sun.lookAt(cam);
      moon.position.copy(cam).addScaledVector(sunDir, -210);
      moon.lookAt(cam);
      sea.position.x = cam.x;
      sea.position.z = cam.z;
      // only near the edge, where it isn't all fogged out
      sea.visible = !u && Math.min(cam.x, cam.z, W - cam.x, D - cam.z) < fogFar + 8;
      starU.scale.value = renderer.getPixelRatio();

      const entered = u && !under;
      if (u !== under) {
        under = u;
        fog.near = u ? UNDER_NEAR : fogNear;
        fog.far = u ? UNDER_FAR : fogFar;
        sky.visible = stars.visible = !u;
        for (const c of clouds) c.visible = !u;
        tint.toggle('under', u);
        applyFog();
      }
      // deeper is darker and murkier
      const dp = u ? THREE.MathUtils.smoothstep(depth, 0, DEEP) : 0;
      if (u && (entered || Math.abs(dp - deep) > 0.004)) {
        deep = dp;
        fog.far = UNDER_FAR - 6 * deep;
        applyFog();
      }
    },
    setHaze(color, amount) {
      if (hazeAmt < 0.002 && hazeAmtTo < 0.002) haze.copy(color);      // no haze yet: take its colour straight away
      hazeTo.copy(color);
      hazeAmtTo = amount;
    },
    setFog(near, far) {
      fogNear = near; fogFar = far;
      if (!under) { fog.near = near; fog.far = far; }
    },
    setTime(t) {
      // the sun rises in +x (t = 0.25), is highest at noon (toward −z), sets in −x; the moon opposite
      const a = Math.PI * 2 * (t - 0.25);
      sunDir.set(Math.cos(a), Math.sin(a) * Math.cos(TILT), -Math.sin(a) * Math.sin(TILT));
      const h = sunDir.y, dusk = Math.max(0, 1 - Math.abs(h + 0.04) / 0.32) * 0.85;
      day = THREE.MathUtils.smoothstep(h, -0.16, 0.22);
      blend(horizon, SKY.horizon, dusk);
      blend(skyU.zenith.value, SKY.zenith, dusk * 0.6);
      if (hazeAmt > 0.002) {
        // the haze darkens with the sky at dusk and at night
        const lum = Math.min(1, (horizon.r * 0.3 + horizon.g * 0.59 + horizon.b * 0.11) / DAY_LUMA);
        horizon.lerp(hazeLit.copy(haze).multiplyScalar(lum), hazeAmt);
        skyU.zenith.value.lerp(hazeLit, hazeAmt * 0.35);
      }
      skyU.horizon.value.copy(horizon);
      skyU.glow.value.setRGB(0.55, 0.25, 0.08).multiplyScalar(dusk);
      skyU.sunDir.value.copy(sunDir);
      blend(seaMat.color, SKY.water, dusk * 0.5);
      // what water reflects: the sky low down, where a glancing look across it meets it
      lightUniforms.skyColor.value.copy(horizon).lerp(skyU.zenith.value, 0.25);
      blend(cloudMat.color, SKY.cloud, dusk);
      sunMat.color.copy(SKY.sun[0]).lerp(SKY.sun[1], Math.min(1, dusk * 1.4));
      moonMat.opacity = 1 - day * 0.85;
      // below the horizon they'd show through the sea
      sun.visible = !under && h > -0.06;
      moon.visible = !under && h < 0.06;
      starU.alpha.value = Math.max(0, 1 - day * 1.6);
      stars.quaternion.setFromAxisAngle(axis, a);
      // the light the chunks get: skylight strength, and its colour (warm low sun, cool moonlight)
      lightUniforms.daylight.value = NIGHT_LIGHT + (1 - NIGHT_LIGHT) * day;
      blend(lightUniforms.skyTint.value, SKY.tint, dusk * 0.7);
      applyFog();
    },
  };
  env.setTime(0.5);
  return env;
}
