import * as THREE from 'three';

/* ============================ SHADING ============================ */
// How light (light.ts) becomes brightness on screen. Chunk meshes carry each vertex's skylight and
// block light (mesher.ts); the chunk shader turns them into a colour from a few uniforms, so the time
// of day never needs a re-mesh:
//   sky   = curve(skylight × daylight) × skyTint     daylight: 1 by day, low at night
//   torch = curve(block light × flicker) × warm      torches flicker a little
//   light = max(sky, torch, floor) per colour channel, then × face shading × AO × the texture
// curve() is Minecraft's: level l (0–1) → l / (4 − 3l), lifted toward 1 − (1 − b)⁴ by the
// Brightness setting; the floor keeps the darkest places just visible. lightColor() does the same
// on the CPU for things drawn without the chunk shader (break particles, the placement ghost).

/** Shared by every chunk material: change .value to change them all */
export const lightUniforms = {
  /** How much skylight counts now: 1 by day, low at night */
  daylight: { value: 1 },
  /** Colour of skylight now (warm at sunset, blue at night) */
  skyTint: { value: new THREE.Color(1, 1, 1) },
  /** Nothing is darker than this */
  lightFloor: { value: 0.06 },
  /** Brightness setting: 0 the plain curve, 1 lifted all the way */
  lift: { value: 0.35 },
  /** Seconds, for the torch flicker */
  time: { value: 0 },
};

/** The Brightness setting's steps */
export const BRIGHTNESS = [
  { name: 'MOODY', lift: 0, floor: 0.03 },
  { name: 'NORMAL', lift: 0.35, floor: 0.06 },
  { name: 'BRIGHT', lift: 0.7, floor: 0.1 },
];

const WARM = new THREE.Color(1, 0.8, 0.56);           // torchlight

/** Uniforms, varying and curve for the chunk vertex shader (after #include <common>) */
export const LIGHT_VERTEX_PARS = `
uniform float daylight;
uniform vec3 skyTint;
uniform float lightFloor;
uniform float lift;
uniform float time;
varying vec3 vLight;
float lightCurve( float l ) {
	float b = l / ( 4.0 - 3.0 * l ), c = 1.0 - b;
	return mix( b, 1.0 - c * c * c * c, lift );
}`;

/**
 * Per-vertex light (after #include <project_vertex>): vertex colour g = skylight, b = block light.
 * The flicker drifts slowly across space, so a room around one torch flickers together.
 */
export const LIGHT_VERTEX = `
	vec4 lightPos = modelMatrix * vec4( transformed, 1.0 );
	float flicker = 1.0 - 0.035 * ( sin( time * 8.3 + lightPos.x * 0.11 + lightPos.z * 0.07 ) + sin( time * 13.7 - lightPos.z * 0.09 ) );
	vec3 skyLight = skyTint * lightCurve( color.g * daylight );
	vec3 torchLight = vec3( ${WARM.r}, ${WARM.g}, ${WARM.b} ) * lightCurve( min( color.b * flicker, 1.0 ) );
	vLight = max( max( skyLight, torchLight ), vec3( lightFloor ) );`;

const curve = (l: number) => {
  const b = l / (4 - 3 * l), c = 1 - b, f = lightUniforms.lift.value;
  return b + (1 - c * c * c * c - b) * f;
};

/** The colour packed light `v` (skylight << 4 | block light) gives right now, as the chunk shader has it. */
export function lightColor(v: number, out: THREE.Color): THREE.Color {
  const s = curve(((v >> 4) / 15) * lightUniforms.daylight.value), t = curve((v & 15) / 15);
  const k = lightUniforms.skyTint.value, f = lightUniforms.lightFloor.value;
  return out.setRGB(Math.max(k.r * s, WARM.r * t, f), Math.max(k.g * s, WARM.g * t, f), Math.max(k.b * s, WARM.b * t, f));
}
