import * as THREE from 'three';
import { W, D, EYE, HORIZON } from './config';
import { B, HOTBAR } from './blocks';
import { SEED } from './noise';
import { createTextures } from './textures';
import { vox, get, setBlock, onBlockChange, generateWorld } from './world';
import { createChunkMesher } from './meshing';
import { createEnvironment } from './environment';
import { createEffects } from './effects';
import { P, V, player, spawn, update, collides } from './player';
import { createInteraction } from './interact';
import { initInput, readControls, setSensitivity } from './input';
import { hud, initHotbar, initStartScreen, showError } from './ui';

function boot(): void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    showError('WEBGL UNAVAILABLE', 'This browser could not start WebGL. Try enabling hardware acceleration.');
    return;
  }

  // Creation order below (textures → world → chunks → sky/clouds → effects) is deliberate:
  // the world PRNG is shared by trees and clouds, and material ids follow creation order.
  const { canvases, textures, materials } = createTextures(renderer);
  generateWorld();

  /* ============================ RENDERER ============================ */
  let pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  renderer.setClearColor(HORIZON);
  document.body.insertBefore(renderer.domElement, document.body.firstChild);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON, 34, 110);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 320);
  camera.rotation.order = 'YXZ';

  const mesher = createChunkMesher(scene, materials);
  onBlockChange((x, _y, z) => mesher.markDirty(x, z));
  const env = createEnvironment(scene);
  const fx = createEffects(scene, textures);

  spawn();
  const interaction = createInteraction(fx);
  initHotbar(canvases, (i) => { fx.ghostMat.map = textures[B[HOTBAR[i]].t[0]]; });

  let playing = false;
  initInput({ canvas: renderer.domElement, isPlaying: () => playing, act: interaction.act });

  /* ============================ RESIZE ============================ */
  function resize(): void {
    const w = window.innerWidth, h = window.innerHeight, a = w / h;
    renderer.setSize(w, h);
    camera.aspect = a;
    // keep a usable horizontal field of view when the phone is held upright
    camera.fov = a >= 1 ? 70 : Math.min(95, (2 * Math.atan(Math.tan((35 * Math.PI) / 180) / a) * 180) / Math.PI);
    camera.updateProjectionMatrix();
    setSensitivity(Math.min(0.0065, Math.max(0.0035, 4.6 / Math.max(w, h))));
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 150));
  resize();

  /* ============================ START ============================ */
  initStartScreen(() => { playing = true; });

  /* ============================ LOOP ============================ */
  let last = performance.now(), orbit = 0, fpsT = 0, fpsN = 0;
  function frame(now: number): void {
    requestAnimationFrame(frame);
    const raw = Math.max(0, (now - last) / 1000);
    last = now;
    const dt = Math.min(raw, 0.08);
    if (playing) {
      update(dt, readControls());
      camera.position.set(P[0], P[1] + EYE, P[2]);
      camera.rotation.set(player.pitch, player.yaw, 0);
    } else { // slow fly-around behind the title card
      orbit += dt * 0.12;
      camera.position.set(W / 2 + Math.sin(orbit) * 30, 24, D / 2 + Math.cos(orbit) * 30);
      camera.lookAt(W / 2, 9, D / 2);
    }
    mesher.flush();
    interaction.updateTarget(playing);
    fx.updateParticles(dt);
    env.update(dt, camera);
    renderer.render(scene, camera);

    // adaptive resolution: drop pixel ratio on slow phones
    if (raw < 0.25) { fpsT += raw; fpsN++; }
    if (fpsT > 2) {
      const fps = fpsN / fpsT;
      fpsT = fpsN = 0;
      if (fps < 40 && pr > 1) { pr = Math.max(1, pr - 0.25); renderer.setPixelRatio(pr); resize(); }
    }
  }
  requestAnimationFrame(frame);

  // small debug handle (handy for testing from the console)
  (window as unknown as { __voxel: unknown }).__voxel = {
    P, V, get, setBlock, act: interaction.act, collides, step: (dt: number) => update(dt, readControls()), SEED,
    get yaw() { return player.yaw; }, get pitch() { return player.pitch; }, get mode() { return hud.mode; },
    get onGround() { return player.onGround; }, get pixelRatio() { return pr; },
    count: () => vox.reduce((a, v) => a + (v ? 1 : 0), 0),
  };
}

try {
  boot();
} catch (err) {
  showError('SOMETHING WENT WRONG', String((err as Error)?.message || err));
}
