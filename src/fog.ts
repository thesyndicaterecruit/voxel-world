import type * as THREE from 'three';

/* ============================ RADIAL FOG ============================ */
// three r128 fogs by view depth (-mvPosition.z), so terrain toward the sides of the view would still
// be partly visible at the distance where chunks stop being drawn, and pop in. These patches fog
// by true distance from the camera instead, so everything is fully fogged at fog.far in every
// direction.

/** Rewrite a built-in material's vertex shader to use radial fog distance. */
export function radialFogVertex(sh: { vertexShader: string }): void {
  sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', '#ifdef USE_FOG\n\tfogDepth = length( mvPosition.xyz );\n#endif');
}

// One named function shared by every plain fogged material, so they share compiled programs
// (r128 keys programs on onBeforeCompile's source).
function patchFog(sh: { vertexShader: string }): void { radialFogVertex(sh); }

/** Make a built-in material use radial fog. */
export function radialFog<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = patchFog;
  return m;
}
