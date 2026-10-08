import { B, HOTBAR } from './blocks';
import { player, bufferJump, type Controls } from './player';
import { els, hud, setMode, selectSlot, toast, toggleFullscreen, showMenu, menuOpen, stepRenderDistance } from './ui';

/* ======================= TOUCH CONTROLS ======================= */
// Left half = floating joystick, right half = drag-to-look (+ tap to act), buttons handled by data-act.
const JR = 62, JMAX = 48;
const joy = { id: null as PointerId | null, ox: 0, oy: 0, x: 0, y: 0, run: false };
const look = { id: null as PointerId | null, sx: 0, sy: 0, lx: 0, ly: 0, t: 0, far: 0, yaw: 0, pitch: 0 };
const held = new Map<PointerId, HTMLElement>(); // pointer id -> pressed button element
/** Keyboard state by KeyboardEvent.code */
const keys: Record<string, boolean> = {};
let jumpHeld = false;
let sens = 0.005;                                  // look sensitivity (radians per CSS px)

/** Touch identifier, or 'm' for the mouse. */
type PointerId = number | 'm';

/** Look sensitivity is scaled to the screen size (see resize in main.ts). */
export function setSensitivity(s: number): void { sens = s; }

/** Movement intent for this frame: keyboard overrides the joystick. */
export function readControls(): Controls {
  if (menuOpen()) return { x: 0, z: 0, run: false, jump: false };
  let x = joy.x, z = joy.y;
  const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const kz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  if (kx || kz) { const l = Math.hypot(kx, kz); x = kx / l; z = kz / l; }
  return { x, z, run: !!(joy.run || keys.ShiftLeft), jump: !!(jumpHeld || keys.Space) };
}

export interface InputOptions {
  canvas: HTMLCanvasElement;
  isPlaying: () => boolean;
  act: () => void;
  /** Menu → Save & exit */
  quit: () => void;
}

export function initInput({ canvas, isPlaying, act, quit }: InputOptions): void {
  const { joy: joyEl, knob } = els;

  function down(id: PointerId, x: number, y: number, target: EventTarget | null, ts: number): void {
    const el = target && (target as Element).closest ? (target as Element).closest<HTMLElement>('[data-act]') : null;
    if (el) {
      held.set(id, el);
      el.classList.add('down');
      const a = el.dataset.act;
      if (a === 'jump') { jumpHeld = true; bufferJump(); }
      else if (a === 'mode') { setMode(hud.mode === 'break' ? 'place' : 'break'); toast(hud.mode === 'break' ? 'Break mode' : 'Place mode: ' + B[HOTBAR[hud.sel]].name, 900); }
      else if (a === 'slot') { selectSlot(+el.dataset.i!); setMode('place'); toast(B[HOTBAR[hud.sel]].name, 900); }
      else if (a === 'menu') showMenu(true);
      else if (a === 'resume') showMenu(false);
      else if (a === 'rd-' || a === 'rd+') stepRenderDistance(a === 'rd+' ? 1 : -1);
      else if (a === 'quit') quit();
      return;
    }
    if (x < window.innerWidth * 0.5) {
      if (joy.id !== null) return;
      joy.id = id; joy.ox = x; joy.oy = y; joy.x = joy.y = 0; joy.run = false;
      joyEl.style.left = x - JR + 'px';
      joyEl.style.top = y - JR + 'px';
      joyEl.style.bottom = 'auto';
      joyEl.classList.add('on');
      knob.style.transform = '';
    } else {
      if (look.id !== null) return;
      look.id = id; look.sx = look.lx = x; look.sy = look.ly = y;
      look.t = ts; look.far = 0; look.yaw = player.yaw; look.pitch = player.pitch;
    }
  }
  function move(id: PointerId, x: number, y: number): void {
    if (id === joy.id) {
      const dx = x - joy.ox, dy = y - joy.oy, d = Math.hypot(dx, dy), c = d > JMAX ? JMAX / d : 1;
      knob.style.transform = `translate(${dx * c}px,${dy * c}px)`;
      let m = Math.min(1, d / JMAX);
      m = m < 0.15 ? 0 : (m - 0.15) / 0.85; // dead zone
      joy.x = d ? (dx / d) * m : 0;
      joy.y = d ? (dy / d) * m : 0;
      joy.run = d > JMAX * 1.35;            // drag past the ring to sprint
      knob.classList.toggle('run', joy.run);
    } else if (id === look.id) {
      player.yaw -= (x - look.lx) * sens;
      player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - (y - look.ly) * sens));
      look.lx = x; look.ly = y;
      look.far = Math.max(look.far, Math.hypot(x - look.sx, y - look.sy));
    }
  }
  function up(id: PointerId, cancel: boolean, ts?: number): void {
    const el = held.get(id);
    if (el) {
      held.delete(id);
      el.classList.remove('down');
      if (el.dataset.act === 'jump') jumpHeld = [...held.values()].some((e) => e.dataset.act === 'jump');
      else if (el.dataset.act === 'fs' && !cancel) toggleFullscreen(false);
      return;
    }
    if (id === joy.id) {
      joy.id = null; joy.x = joy.y = 0; joy.run = false;
      joyEl.style.left = joyEl.style.top = joyEl.style.bottom = '';
      joyEl.classList.remove('on');
      knob.style.transform = '';
      knob.classList.remove('run');
    } else if (id === look.id) {
      look.id = null;
      // a short, still touch is a tap: undo the tiny jitter and act at the crosshair
      // (duration uses event timestamps, so a quick tap still counts on a laggy phone)
      if (!cancel && look.far < 14 && ts! - look.t < 450) { player.yaw = look.yaw; player.pitch = look.pitch; act(); }
    }
  }
  function releaseAll(): void {
    for (const k in keys) keys[k] = false;
    [...held.keys()].forEach((id) => up(id, true));
    if (joy.id !== null) up(joy.id, true);
    if (look.id !== null) up(look.id, true);
    jumpHeld = false;
  }

  // ---- gesture prevention: no scrolling, zooming, pull-to-refresh, long-press menus ----
  const stop = (e: Event) => { if (e.cancelable) e.preventDefault(); };
  for (const el of [canvas, els.ui]) {
    for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) el.addEventListener(t, stop, { passive: false });
    el.addEventListener('contextmenu', stop);
  }
  // (scrollable lists on the start card, [data-scroll], may still scroll)
  document.addEventListener('touchmove', (e) => {
    if (!(e.target as Element).closest?.('[data-scroll]')) stop(e);
  }, { passive: false });
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  document.addEventListener('contextmenu', stop);
  document.addEventListener('selectstart', stop);
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) stop(e); }, { passive: false });

  // ---- touch routing (each finger tracked by its identifier → true multi-touch) ----
  let lastTouch = -1e9;
  document.addEventListener('touchstart', (e) => {
    lastTouch = performance.now();
    if (!isPlaying()) return;
    stop(e);
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      down(t.identifier, t.clientX, t.clientY, t.target, e.timeStamp);
    }
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    lastTouch = performance.now();
    if (!isPlaying()) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      move(t.identifier, t.clientX, t.clientY);
    }
  }, { passive: false });
  const touchEnd = (e: TouchEvent) => {
    lastTouch = performance.now();
    if (!isPlaying()) return;
    stop(e);
    for (let i = 0; i < e.changedTouches.length; i++) up(e.changedTouches[i].identifier, e.type === 'touchcancel', e.timeStamp);
  };
  document.addEventListener('touchend', touchEnd, { passive: false });
  document.addEventListener('touchcancel', touchEnd, { passive: false });

  // ---- optional desktop fallback (same zones with the mouse, WASD/Space/Q/1-8) ----
  // mouse events that the browser synthesises from touches are ignored
  const realMouse = (e: MouseEvent) => {
    const caps = (e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities;
    return isPlaying() && performance.now() - lastTouch > 800 && !(caps && caps.firesTouchEvents);
  };
  document.addEventListener('mousedown', (e) => { if (e.button === 0 && realMouse(e)) down('m', e.clientX, e.clientY, e.target, e.timeStamp); });
  window.addEventListener('mousemove', (e) => { if (realMouse(e)) move('m', e.clientX, e.clientY); });
  window.addEventListener('mouseup', (e) => { if (realMouse(e)) up('m', false, e.timeStamp); });
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (!isPlaying()) return;
    if (e.code === 'Escape' || e.code === 'KeyM') showMenu(!menuOpen());
    if (menuOpen()) return;
    if (/^Digit[1-8]$/.test(e.code)) { selectSlot(+e.code.slice(5) - 1); setMode('place'); }
    if (e.code === 'KeyQ' || e.code === 'KeyE') setMode(hud.mode === 'break' ? 'place' : 'break');
    if (e.code === 'KeyF' || e.code === 'Enter') act();
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
}
