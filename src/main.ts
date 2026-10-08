import * as THREE from 'three';
import { CS, NCX, EYE, HORIZON } from './config';
import { B, HOTBAR } from './blocks';
import { urlSeed, randomSeed } from './noise';
import { createTextures } from './textures';
import { world } from './world';
import { columnHeight, findSpawn } from './gen';
import { createWorkerPool } from './workers';
import { createStreamer, RENDER_DISTANCE } from './streaming';
import { createEnvironment } from './environment';
import { createEffects } from './effects';
import { P, V, player, spawn, update, collides } from './player';
import { createInteraction } from './interact';
import { initInput, readControls, setSensitivity } from './input';
import { els, hud, initHotbar, initMenu, initStartScreen, showError } from './ui';

/** Play is enabled once everything within this many blocks of the spawn point is meshed. */
const READY_RADIUS = 24;
const RD_KEY = 'voxel-island.renderDistance';

function savedRenderDistance(): number {
  try {
    const r = Number(localStorage.getItem(RD_KEY));
    if (r >= RENDER_DISTANCE.min && r <= RENDER_DISTANCE.max) return r;
  } catch (e) { /* storage unavailable */ }
  return RENDER_DISTANCE.def;
}

function boot(): void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    showError('WEBGL UNAVAILABLE', 'This browser could not start WebGL. Try enabling hardware acceleration.');
    return;
  }
  if (!renderer.capabilities.isWebGL2) {
    showError('WEBGL 2 NEEDED', 'This browser only has WebGL 1. Try a newer browser or enable hardware acceleration.');
    return;
  }

  const seed = urlSeed() ?? randomSeed();
  world.seed = seed;
  const [sx, sz] = findSpawn(seed);
  const { canvases, textures, chunkMaterial } = createTextures(renderer);

  /* ============================ RENDERER ============================ */
  let pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  renderer.setClearColor(HORIZON);
  document.body.insertBefore(renderer.domElement, document.body.firstChild);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 320);
  camera.rotation.order = 'YXZ';

  const pool = createWorkerPool((msg) => showError('COULD NOT START WORKERS', msg));
  // edited chunks that stream out are kept in memory, so edits survive walking away and back
  const kept = new Map<number, Uint8Array>();
  const streamer = createStreamer(scene, chunkMaterial, pool, {
    load(cx, cz) {
      const d = kept.get(cx + cz * NCX);
      if (!d) return null;
      kept.delete(cx + cz * NCX);
      return Promise.resolve(d);
    },
    unload(c) { if (c.edited) kept.set(c.cx + c.cz * NCX, c.data); },
  });
  world.onChange = (x, _y, z) => streamer.markDirty(x, z);
  const env = createEnvironment(scene, renderer, seed, sx, sz);
  const fx = createEffects(scene, textures);

  // view distance: how far chunks are streamed, and where the fog ends
  const setRenderDistance = (r: number) => { streamer.setRenderDistance(r); env.setFog(r * CS * 0.35, r * CS); };
  const rd = savedRenderDistance();
  setRenderDistance(rd);
  initMenu(rd, RENDER_DISTANCE.min, RENDER_DISTANCE.max, (r) => {
    setRenderDistance(r);
    try { localStorage.setItem(RD_KEY, String(r)); } catch (e) { /* storage unavailable */ }
  });

  const interaction = createInteraction(fx);
  initHotbar(canvases, (i) => { fx.ghostMat.map = textures[B[HOTBAR[i]].t[0]]; });

  let playing = false, ready = false;
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

  // the title fly-around circles the spawn point, high enough to clear the hills on its path
  let orbitY = columnHeight(seed, sx, sz) + 12;
  for (let a = 0; a < 64; a++) {
    const x = Math.round(sx + Math.sin(a / 64 * Math.PI * 2) * 30), z = Math.round(sz + Math.cos(a / 64 * Math.PI * 2) * 30);
    orbitY = Math.max(orbitY, columnHeight(seed, x, z) + 6);
  }
  els.play.textContent = 'GENERATING ISLANDS…';

  /* ============================ LOOP ============================ */
  const look = new THREE.Vector3();
  let last = performance.now(), orbit = 0, fpsT = 0, fpsN = 0, streamMs = 0;
  function frame(now: number): void {
    requestAnimationFrame(frame);
    const raw = Math.max(0, (now - last) / 1000);
    last = now;
    const dt = Math.min(raw, 0.08);
    if (playing) {
      // physics waits until the chunks under the player are loaded (unloaded chunks are solid)
      if (streamer.areaLoaded(P[0], P[2])) update(dt, readControls());
      camera.position.set(P[0], P[1] + EYE, P[2]);
      camera.rotation.set(player.pitch, player.yaw, 0);
    } else { // slow fly-around behind the title card
      orbit += dt * 0.12;
      camera.position.set(sx + Math.sin(orbit) * 30, orbitY, sz + Math.cos(orbit) * 30);
      camera.lookAt(sx, orbitY - 14, sz);
    }
    camera.getWorldDirection(look);
    const t0 = performance.now();
    streamer.update(playing ? P[0] : sx + 0.5, playing ? P[2] : sz + 0.5, look.x, look.z);
    streamMs = Math.max(streamMs * 0.98, performance.now() - t0);
    if (!ready && streamer.isReady(sx + 0.5, sz + 0.5, READY_RADIUS)) {
      ready = true;
      spawn(sx, sz);
      initStartScreen(() => { playing = true; });
    }
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
    P, V, world, get: world.getBlock.bind(world), setBlock: world.setBlock.bind(world),
    act: interaction.act, collides, step: (dt: number) => update(dt, readControls()), SEED: seed,
    get yaw() { return player.yaw; }, get pitch() { return player.pitch; }, get mode() { return hud.mode; },
    get onGround() { return player.onGround; }, get pixelRatio() { return pr; }, get ready() { return ready; },
    count: () => world.count(),
    stream: () => ({ ...streamer.stats(), updateMs: +streamMs.toFixed(2), calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
    setRenderDistance, chunk: (cx: number, cz: number) => streamer.debugChunk(cx, cz),
  };
}

try {
  boot();
} catch (err) {
  showError('SOMETHING WENT WRONG', String((err as Error)?.message || err));
}
