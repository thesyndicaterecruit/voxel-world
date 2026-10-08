import * as THREE from 'three';
import { CB, NCX, NCZ, EYE, HORIZON } from './config';
import { B, HOTBAR } from './blocks';
import { urlSeed, randomSeed } from './noise';
import { createTextures } from './textures';
import { world } from './world';
import { columnHeight, findSpawn } from './gen';
import { createWorkerPool } from './workers';
import { createChunkMesher } from './meshing';
import { createEnvironment } from './environment';
import { createEffects } from './effects';
import { P, V, player, spawn, update, collides } from './player';
import { createInteraction } from './interact';
import { initInput, readControls, setSensitivity } from './input';
import { els, hud, initHotbar, initStartScreen, showError } from './ui';

/** Chunks generated around the spawn point (square radius, in chunks). */
const LOAD_RADIUS = 4;

function boot(): void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    showError('WEBGL UNAVAILABLE', 'This browser could not start WebGL. Try enabling hardware acceleration.');
    return;
  }

  const seed = urlSeed() ?? randomSeed();
  world.seed = seed;
  const [sx, sz] = findSpawn(seed);
  const { canvases, textures, materials } = createTextures(renderer);

  /* ============================ RENDERER ============================ */
  let pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  renderer.setClearColor(HORIZON);
  document.body.insertBefore(renderer.domElement, document.body.firstChild);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 320);
  camera.rotation.order = 'YXZ';

  const mesher = createChunkMesher(scene, materials);
  world.onChange = (x, _y, z) => mesher.markDirty(x, z);
  const env = createEnvironment(scene, renderer, seed, sx, sz);
  env.setFog(24, (LOAD_RADIUS + 0.5) * 16 - 8);   // hide where the generated area ends
  const fx = createEffects(scene, textures);

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

  /* ============================ WORLD LOADING ============================ */
  // Generate the chunks around the spawn point in workers, nearest first, then mesh them a few per
  // frame behind the title card. Play is enabled once everything is built.
  const pool = createWorkerPool((msg) => showError('COULD NOT START WORKERS', msg));
  const scx = sx >> CB, scz = sz >> CB, queue: [number, number][] = [];
  for (let cz = scz - LOAD_RADIUS; cz <= scz + LOAD_RADIUS; cz++) for (let cx = scx - LOAD_RADIUS; cx <= scx + LOAD_RADIUS; cx++)
    if (cx >= 0 && cx < NCX && cz >= 0 && cz < NCZ) queue.push([cx, cz]);
  queue.sort((a, b) => Math.hypot(a[0] - scx, a[1] - scz) - Math.hypot(b[0] - scx, b[1] - scz));
  const total = queue.length;
  let generated = 0, ready = false;
  const pump = () => {
    while (pool.free() > 0 && queue.length) {
      const [cx, cz] = queue.shift()!;
      pool.run({ type: 'gen', id: 0, seed, cx, cz }, [], (res) => {
        world.setChunk(res.cx, res.cz, res.data);
        if (++generated === total) world.forEachChunk((c) => mesher.addChunk(c.cx, c.cz));
        pump();
      });
    }
  };
  pump();
  // the title fly-around circles the spawn point, high enough to clear the hills on its path
  let orbitY = columnHeight(seed, sx, sz) + 12;
  for (let a = 0; a < 64; a++) {
    const x = Math.round(sx + Math.sin(a / 64 * Math.PI * 2) * 30), z = Math.round(sz + Math.cos(a / 64 * Math.PI * 2) * 30);
    orbitY = Math.max(orbitY, columnHeight(seed, x, z) + 6);
  }

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
      camera.position.set(sx + Math.sin(orbit) * 30, orbitY, sz + Math.cos(orbit) * 30);
      camera.lookAt(sx, orbitY - 14, sz);
    }
    mesher.flush(playing ? 2 : 6);
    if (!ready) {
      const built = generated < total ? 0 : total - mesher.pending();
      els.play.textContent = `GENERATING ISLANDS… ${Math.floor(((generated + built) / (2 * total)) * 100)}%`;
      if (built === total) {
        ready = true;
        spawn(sx, sz);
        initStartScreen(() => { playing = true; });
      }
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
  };
}

try {
  boot();
} catch (err) {
  showError('SOMETHING WENT WRONG', String((err as Error)?.message || err));
}
