import * as THREE from 'three';
import { CB, CS, EYE, HORIZON } from './config';
import { B, HOTBAR } from './blocks';
import { urlSeed, randomSeed } from './noise';
import { createTextures, setUnderwater } from './textures';
import { world, inWater } from './world';
import { columnHeight, findSpawn } from './gen';
import { createWorkerPool } from './workers';
import { createStreamer, RENDER_DISTANCE } from './streaming';
import { createEnvironment } from './environment';
import { createEffects } from './effects';
import { createWater } from './water';
import { P, V, player, spawn, update, collides, aim } from './player';
import { createInteraction } from './interact';
import { initInput, readControls, setSensitivity } from './input';
import { els, hud, initHotbar, initMenu, initLeavesToggle, initBrightness, initDayLength, initAlwaysDay, initStartScreen, selectSlot,
  setFancyLeaves, setMode, setNote, setClock, showError, showWorlds, toast, menuOpen } from './ui';
import { lightUniforms, BRIGHTNESS } from './shading';
import { openSaves, listWorlds, createWorld, deleteWorld, openWorld, type WorldRecord } from './saves';

/** Play is enabled once everything within this many blocks of the start point is meshed. */
const READY_RADIUS = 24;
const RD_KEY = 'voxel-island.renderDistance', LEAVES_KEY = 'voxel-island.fancyLeaves', BRIGHT_KEY = 'voxel-island.brightness';
const DAY_KEY = 'voxel-island.dayLength', ALWAYS_DAY_KEY = 'voxel-island.alwaysDay';
/** Day length setting: real minutes for a whole day */
const DAY_MINUTES = [5, 10, 20, 40, 60], DEFAULT_DAY = 2;

function savedRenderDistance(): number {
  try {
    const r = Number(localStorage.getItem(RD_KEY));
    if (r >= RENDER_DISTANCE.min && r <= RENDER_DISTANCE.max) return r;
  } catch (e) { /* storage unavailable */ }
  return RENDER_DISTANCE.def;
}

/** Reload the page into world `id` (or the most recently played one). Switching worlds is a reload. */
function reopen(id: string | null): void {
  location.replace(location.pathname + (id ? '?world=' + encodeURIComponent(id) : ''));
}

/** Which world to load: ?seed=N (a world for that seed), ?world=id, the most recent, or a new one. */
async function pickWorld(): Promise<{ record: WorldRecord; list: WorldRecord[] }> {
  const params = new URLSearchParams(location.search), forced = urlSeed(), wanted = params.get('world');
  let list = await listWorlds(), record: WorldRecord | undefined;
  if (forced !== null) record = list.find((w) => w.seed === forced && w.name === `Seed ${forced}`);
  else record = list.find((w) => w.id === wanted) ?? list[0];
  if (!record) {
    record = await createWorld(forced !== null ? `Seed ${forced}` : nextName(list), forced ?? randomSeed());
    list = [record, ...list];
  }
  if (wanted) history.replaceState(null, '', location.pathname);   // a refresh reopens the most recent world
  return { record, list };
}
const nextName = (list: WorldRecord[]) =>
  `Island ${list.reduce((n, w) => Math.max(n, +(/^Island (\d+)$/.exec(w.name)?.[1] ?? 0)), 0) + 1}`;

async function boot(): Promise<void> {
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

  /* ============================ SAVE FILES ============================ */
  if (!(await openSaves())) setNote('Saving is not available in this browser (private mode?), so this island will not be kept.');
  const { record, list } = await pickWorld();
  const seed = record.seed;
  world.seed = seed;
  const [sx, sz] = findSpawn(seed);
  // where the player starts: the saved position, or the spawn point of a new world
  const home = record.player ? { x: record.player.x, z: record.player.z } : { x: sx + 0.5, z: sz + 0.5 };
  showWorlds(list.map((w) => ({ id: w.id, name: w.name, seed: w.seed, lastPlayed: w.lastPlayed, played: !!w.player })), record.id, {
    open: (id) => reopen(id),
    remove: (id) => void deleteWorld(id).then(() => reopen(id === record.id ? null : record.id)),
    create: () => void createWorld(nextName(list), randomSeed()).then((w) => reopen(w.id)),
  });

  const { canvases, textures, chunkMaterials } = createTextures(renderer);

  /* ============================ RENDERER ============================ */
  let pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  renderer.setClearColor(HORIZON);
  document.body.insertBefore(renderer.domElement, document.body.firstChild);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 320);
  camera.rotation.order = 'YXZ';

  let playing = false, ready = false;
  /** The world clock: days since the world began (the fraction is the time of day), saved with it */
  let days = record.time;
  const save = await openWorld(record, (cx, cz) => world.chunk(cx, cz),
    () => (playing ? { player: { x: P[0], y: P[1], z: P[2], yaw: player.yaw, pitch: player.pitch }, slot: hud.sel, mode: hud.mode, time: days } : null),
    (cx, cz) => water.pendingIn(cx, cz));
  const pool = createWorkerPool((msg) => showError('COULD NOT START WORKERS', msg));
  // edited chunks come from the save; everything else is generated
  const streamer = createStreamer(scene, chunkMaterials, pool, save);
  const env = createEnvironment(scene, renderer, seed, home.x, home.z);
  const fx = createEffects(scene, textures);
  // flowing water: torches it reaches pop off; a chunk with water updates pending has something to save
  const water = createWater(world, { onWash: (x, y, z, id) => fx.burst(x, y, z, id), onPending: (cx, cz) => save.touch(cx, cz) });
  // block changes: the water around them moves, and all the changes made together (one action, one
  // tick of water) are relit and re-meshed in one go, right after
  const changes: number[] = [];
  let flushing = false;
  world.onChange = (x, y, z, old) => {
    changes.push(x, y, z, old);
    save.touch(x >> CB, z >> CB);
    water.blockChanged(x, y, z, old);
    if (!flushing) { flushing = true; queueMicrotask(() => { flushing = false; streamer.blocksChanged(changes.splice(0)); }); }
  };
  world.onLoad = (c, flow) => { if (flow) water.restore(c.cx, c.cz, flow); };

  // view distance: how far chunks are streamed, and where the fog ends
  const setRenderDistance = (r: number) => { streamer.setRenderDistance(r); env.setFog(r * CS * 0.35, r * CS); };
  const rd = savedRenderDistance();
  setRenderDistance(rd);
  initMenu(rd, RENDER_DISTANCE.min, RENDER_DISTANCE.max, (r) => {
    setRenderDistance(r);
    try { localStorage.setItem(RD_KEY, String(r)); } catch (e) { /* storage unavailable */ }
  });
  // Fancy leaves (default on): see-through cutout leaves; off meshes them as plain opaque cubes
  let fancy = true;
  try { fancy = localStorage.getItem(LEAVES_KEY) !== '0'; } catch (e) { /* storage unavailable */ }
  streamer.setOpaqueLeaves(!fancy);
  initLeavesToggle(fancy, (on) => {
    streamer.setOpaqueLeaves(!on);
    try { localStorage.setItem(LEAVES_KEY, on ? '1' : '0'); } catch (e) { /* storage unavailable */ }
  });

  // Brightness: how far the light curve is lifted, and how dark the darkest places get
  let bright = 1;
  try { const v = localStorage.getItem(BRIGHT_KEY); if (v !== null && BRIGHTNESS[+v]) bright = +v; } catch (e) { /* storage unavailable */ }
  const setBrightness = (i: number) => { lightUniforms.lift.value = BRIGHTNESS[i].lift; lightUniforms.lightFloor.value = BRIGHTNESS[i].floor; };
  setBrightness(bright);
  initBrightness(bright, BRIGHTNESS.map((b) => b.name), (i) => {
    setBrightness(i);
    try { localStorage.setItem(BRIGHT_KEY, String(i)); } catch (e) { /* storage unavailable */ }
  });

  // Day length and Always day (which holds the sun at noon)
  let dayMin = DAY_MINUTES[DEFAULT_DAY], alwaysDay = false;
  try {
    const v = localStorage.getItem(DAY_KEY);
    if (v !== null && DAY_MINUTES.includes(+v)) dayMin = +v;
    alwaysDay = localStorage.getItem(ALWAYS_DAY_KEY) === '1';
  } catch (e) { /* storage unavailable */ }
  initDayLength(DAY_MINUTES.indexOf(dayMin), DAY_MINUTES.map((m) => `${m} MIN`), (i) => {
    dayMin = DAY_MINUTES[i];
    try { localStorage.setItem(DAY_KEY, String(dayMin)); } catch (e) { /* storage unavailable */ }
  });
  initAlwaysDay(alwaysDay, (on) => {
    alwaysDay = on;
    try { localStorage.setItem(ALWAYS_DAY_KEY, on ? '1' : '0'); } catch (e) { /* storage unavailable */ }
  });

  const interaction = createInteraction(fx);
  initHotbar(canvases, (i) => { const b = B[HOTBAR[i]]; fx.ghostMat.map = textures[b.model === 'liquid' ? b.icon : b.tex[0]]; });

  // autosave: within 5 s of a change, and right away when the app is hidden, closed or exited
  let quitting = false;
  const quit = () => {
    if (quitting) return;
    quitting = true;
    toast('Saving…', 5000);
    void save.save().finally(() => reopen(record.id));
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) void save.save(); });
  window.addEventListener('pagehide', () => { if (playing) void save.save(); });
  initInput({ canvas: renderer.domElement, isPlaying: () => playing, act: interaction.act, quit });

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

  // the title fly-around circles the start point, high enough to clear the hills on its path
  const hx = Math.floor(home.x), hz = Math.floor(home.z);
  let orbitY = columnHeight(seed, hx, hz) + 12;
  for (let a = 0; a < 64; a++) {
    const x = Math.round(hx + Math.sin(a / 64 * Math.PI * 2) * 30), z = Math.round(hz + Math.cos(a / 64 * Math.PI * 2) * 30);
    orbitY = Math.max(orbitY, columnHeight(seed, x, z) + 6);
  }
  els.play.textContent = record.player ? 'LOADING ISLAND…' : 'GENERATING ISLANDS…';

  /* ============================ LOOP ============================ */
  const look = new THREE.Vector3(), lastState = [NaN, NaN, NaN, NaN, NaN];
  let last = performance.now(), orbit = 0, fpsT = 0, fpsN = 0, streamMs = 0;
  function frame(now: number): void {
    requestAnimationFrame(frame);
    const raw = Math.max(0, (now - last) / 1000);
    last = now;
    const dt = Math.min(raw, 0.08);
    if (playing) {
      // physics waits until the chunks under the player are loaded (unloaded chunks are solid)
      if (streamer.areaLoaded(P[0], P[2])) update(dt, readControls());
      if (!menuOpen()) water.update(dt);
      camera.position.set(P[0], P[1] + EYE, P[2]);
      camera.rotation.set(player.pitch, player.yaw, 0);
      // moving or looking around counts as a change worth saving
      const st = [P[0], P[1], P[2], player.yaw, player.pitch];
      if (st.some((v, i) => Math.abs(v - lastState[i]) > 0.01)) { st.forEach((v, i) => (lastState[i] = v)); save.requestSave(); }
    } else { // slow fly-around behind the title card
      orbit += dt * 0.12;
      camera.position.set(hx + Math.sin(orbit) * 30, orbitY, hz + Math.cos(orbit) * 30);
      camera.lookAt(hx, orbitY - 14, hz);
    }
    camera.getWorldDirection(look);
    const t0 = performance.now();
    streamer.update(playing ? P[0] : home.x, playing ? P[2] : home.z, look.x, look.z, !ready ? 'first' : playing ? 'play' : 'title');
    streamMs = Math.max(streamMs * 0.98, performance.now() - t0);
    if (!ready && streamer.isReady(home.x, home.z, READY_RADIUS)) {
      ready = true;
      const ps = record.player;
      if (ps) {
        P[0] = ps.x; P[1] = ps.y; P[2] = ps.z;
        player.yaw = ps.yaw; player.pitch = ps.pitch;
      } else spawn(sx, sz);
      selectSlot(record.slot);
      setMode(record.mode);
      initStartScreen(() => { playing = true; save.requestSave(); });
    }
    lightUniforms.time.value = now / 1000;           // torch flicker
    // the clock runs while playing (not while the menu is open); Always day holds it at noon
    if (playing && !menuOpen()) days = alwaysDay ? Math.floor(days) + 0.5 : days + dt / (dayMin * 60);
    env.setTime(days % 1);
    if (menuOpen()) setClock(days);
    interaction.updateTarget(playing);
    fx.updateParticles(dt);
    const under = inWater(camera.position.x, camera.position.y, camera.position.z);
    env.update(dt, camera, under);
    setUnderwater(chunkMaterials[2], under);
    streamer.sortTranslucent(camera.position);
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
    P, V, world, get: world.getBlock.bind(world), setBlock: world.setBlock.bind(world), getState: world.getState.bind(world),
    light: (x: number, y: number, z: number) => { const v = world.getLight(x, y, z); return [v >> 4, v & 15]; },
    act: interaction.act, collides, step: (dt: number) => update(dt, readControls()), SEED: seed,
    get yaw() { return player.yaw; }, get pitch() { return player.pitch; }, get mode() { return hud.mode; },
    get onGround() { return player.onGround; }, get pixelRatio() { return pr; }, get ready() { return ready; },
    count: () => world.count(),
    stream: () => ({ ...streamer.stats(), updateMs: +streamMs.toFixed(2), calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
    setRenderDistance, chunk: (cx: number, cz: number) => streamer.debugChunk(cx, cz),
    verifyLight: (cx: number, cz: number) => streamer.verifyLight(cx, cz),
    water: () => water.stats(), waterTick: () => water.tick(),
    get time() { return days; },
    setTime: (t: number) => { days = Math.floor(days) + t; },
    setFancyLeaves: (on: boolean) => setFancyLeaves(on), tiles: canvases,
    look: (yaw: number, pitch: number) => { player.yaw = yaw; player.pitch = pitch; },
    target: () => { const h = aim(); return h && { ...h, id: world.getBlock(h.x, h.y, h.z) }; },
    worldId: record.id, save: () => save.save(),
  };
}

boot().catch((err) => showError('SOMETHING WENT WRONG', String((err as Error)?.message || err)));
