import * as THREE from 'three';
import { radialFogVertex } from './fog';
import { lightColor } from './shading';
import { COVER, SNOW_BOX, SNOW_BELOW, SNOW_WIND, createCover, flakeLayout, type Cover } from './snow';

/* ============================ SNOWFALL ============================ */
// Falling snow round the camera: one Points draw call. Each flake has a place in a box (SNOW_BOX)
// and a way of falling (flakeLayout); the vertex shader moves it on with the time (falling, swaying,
// the wind) and wraps it into the box round the camera, so flakes stay put in the world as the
// camera moves and the box never runs out. It reads the column's ceiling (snow.ts: the cover grid,
// a COVER × COVER texture that repeats, uploaded when it changes) and hides flakes below it, fading
// them out over the last half block, so no snow falls under a roof, a tree or glass, in a cave or
// under water. The flakes are soft round dots, coloured like full skylight now (lit by the time of
// day, but never darker than the sky behind them, or they'd look like ash against a sunset), fogged
// like everything else, and drawn after the water. How hard it snows is how many of them are drawn.

/** Flakes at full snow */
const FLAKES = 2400;
/** Flake size (PointsMaterial units: blocks seen at a distance, roughly) */
const SIZE = 0.11;
/** The snow's clock wraps round this often (s), keeping the shader's numbers small */
const WRAP = 3600;
/** Seconds the snowfall takes to set in or stop completely */
const EASE = 2;
/** The flakes are never darker than moonlit snow */
const MOONLIT = [0.3, 0.33, 0.43];

const f = (v: number) => v.toFixed(3);
const VERTEX_PARS = `
uniform float snowTime;
uniform vec3 snowEye;
uniform sampler2D snowCover;
attribute vec4 flake;
varying float vSnow;`;
// where the flake is now: fallen, swayed and blown from where it started, wrapped into the box
// round the camera; then how much of it shows (ground, box edges)
const VERTEX = `
	vec3 transformed = position + vec3(
		${f(SNOW_WIND[0])} * snowTime + flake.z * sin( snowTime * 0.8 + flake.y ),
		- flake.x * snowTime,
		${f(SNOW_WIND[1])} * snowTime + flake.z * 0.6 * sin( snowTime * 0.55 + flake.y * 2.3 ) );
	vec3 box = vec3( ${f(SNOW_BOX[0])}, ${f(SNOW_BOX[1])}, ${f(SNOW_BOX[2])} );
	vec3 lo = snowEye - vec3( box.x * 0.5, ${f(SNOW_BELOW)}, box.z * 0.5 );
	transformed = lo + mod( transformed - lo, box );
	float ceiling = texture2D( snowCover, ( floor( transformed.xz ) + 0.5 ) / ${f(COVER)} ).r * 255.0;
	vec2 side = abs( transformed.xz - snowEye.xz ) / ( box.xz * 0.5 );
	float up = transformed.y - lo.y;
	vSnow = clamp( ( transformed.y - ceiling ) * 2.0, 0.0, 1.0 )      // melts into what it lands on
		* ( 1.0 - smoothstep( 0.7, 1.0, max( side.x, side.y ) ) )          // fades out toward the box's sides,
		* smoothstep( 0.0, 3.0, up ) * smoothstep( 0.0, 3.0, box.y - up );  // its top and its bottom`;
// near flakes grow, but not without end, and none right in front of the eye; hidden ones are clipped away
const POINT_SIZE = `
	gl_PointSize = size * flake.w * scale / max( - mvPosition.z, 2.0 );
	vSnow *= smoothstep( 0.3, 1.0, - mvPosition.z );
	if ( vSnow < 0.01 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );`;
// a soft round flake
const FRAGMENT = `
	vec2 pc = gl_PointCoord - 0.5;
	diffuseColor.a *= vSnow * ( 1.0 - smoothstep( 0.08, 0.25, dot( pc, pc ) ) );`;

export interface Snowfall {
  /** Where snow reaches: the ceilings round the camera (main.ts tells it about edits and chunks that load) */
  readonly cover: Cover;
  /**
   * Move the snow on: `amount` is how hard it should snow (0–1; the snowfall eases toward it), `under`
   * says the camera is in water (no snow).
   */
  update(dt: number, camera: THREE.Camera, amount: number, under: boolean): void;
  /** Draw the snow or not, whatever the setting (to time it or compare pictures) */
  show(on: boolean): void;
  /** How hard it snows now, how many flakes are drawn, and whether they are */
  stats(): { amount: number; flakes: number; visible: boolean };
}

/** `seed` places the flakes; `column` gives a column's ceiling (snow.ts columnCeiling). */
export function createSnowfall(scene: THREE.Scene, seed: number, column: (x: number, z: number) => number): Snowfall {
  const cover = createCover(column);
  const tex = new THREE.DataTexture(cover.data, COVER, COVER, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;

  const { pos, flake } = flakeLayout(FLAKES, seed), geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('flake', new THREE.BufferAttribute(flake, 4));
  geo.setDrawRange(0, 0);
  const u = { snowTime: { value: 0 }, snowEye: { value: new THREE.Vector3() }, snowCover: { value: tex } };
  const mat = new THREE.PointsMaterial({ size: SIZE, sizeAttenuation: false, transparent: true, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    radialFogVertex(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + VERTEX_PARS)
      .replace('#include <begin_vertex>', VERTEX)
      .replace('gl_PointSize = size;', POINT_SIZE);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSnow;')
      .replace('#include <map_particle_fragment>', FRAGMENT);
  };
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;                      // the shader puts the flakes where they are
  points.renderOrder = 1;                            // after the water (its groups' renderOrder is ≤ 0)
  points.visible = false;
  scene.add(points);

  let amount = 0, time = 0, shown = true;
  return {
    cover,
    update(dt, camera, target, under) {
      amount += Math.max(-dt / EASE, Math.min(dt / EASE, target - amount));
      const cam = camera.position, n = Math.round(FLAKES * amount);
      cover.recenter(cam.x, cam.z);
      points.visible = n > 0 && !under && shown;
      if (!points.visible) return;
      geo.setDrawRange(0, n);
      if (cover.dirty) { tex.needsUpdate = true; cover.dirty = false; }
      time = (time + dt) % WRAP;
      u.snowTime.value = time;
      u.snowEye.value.copy(cam);
      // as lit as full skylight now (white by day), but at least as bright as the sky low down (the
      // fog's colour), and moonlit snow
      const c = lightColor(0xf0, mat.color), sky = (scene.fog as THREE.Fog).color;
      c.setRGB(Math.max(c.r, sky.r * 1.1, MOONLIT[0]), Math.max(c.g, sky.g * 1.1, MOONLIT[1]), Math.max(c.b, sky.b * 1.1, MOONLIT[2]));
    },
    show(on) { shown = on; },
    stats: () => ({ amount: +amount.toFixed(3), flakes: points.visible ? geo.drawRange.count : 0, visible: points.visible }),
  };
}
