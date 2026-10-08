import { B, HOTBAR } from './blocks';

/* ============================ HUD ============================ */
export type Mode = 'break' | 'place';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

/** Elements of the in-game HUD (see index.html). */
export const els = {
  play: $('play') as HTMLButtonElement,
  start: $('start'),
  note: $('note'),
  ui: $('ui'),
  toast: $('toast'),
  mode: $('mode'),
  joy: $('joy'),
  knob: $('knob'),
  fs: $('fs'),
  hotbar: $('hotbar'),
  rd: $('rd'),
  worlds: $('worlds'),
  newWorld: $('newWorld') as HTMLButtonElement,
  leavesBtn: $('leavesBtn'),
};

/** HUD state: current tool mode and selected hotbar slot. */
export const hud = { mode: 'break' as Mode, sel: 0 };

let toastTimer = 0;
export function toast(msg: string, ms = 1300): void {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), ms);
}

export function setMode(m: Mode): void {
  hud.mode = m;
  els.mode.classList.toggle('break', m === 'break');
  els.mode.classList.toggle('place', m === 'place');
  els.mode.querySelector('.ic')!.textContent = m === 'break' ? '⛏️' : '🧱';
  els.mode.querySelector('.lb')!.textContent = m === 'break' ? 'BREAK' : 'PLACE';
}

let slots: HTMLElement[] = [];
let onSelect: (i: number) => void = () => {};

/**
 * Build the hotbar from the block tile canvases and select slot 0.
 * `select` is told about every selection (used to retexture the placement ghost).
 */
export function initHotbar(tileCanvas: HTMLCanvasElement[], select: (i: number) => void): void {
  onSelect = select;
  slots = HOTBAR.map((id, i) => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.i = String(i);
    el.title = B[id].name;
    el.style.backgroundImage = `url(${tileCanvas[B[id].icon].toDataURL()})`; // same pixel art as the block
    els.hotbar.appendChild(el);
    return el;
  });
  // when not every slot fits, fade the end(s) with more slots past them, as a hint that it scrolls
  const bar = els.hotbar, fade = () => {
    const more = bar.scrollWidth - bar.clientWidth;
    bar.classList.toggle('fade-l', more > 1 && bar.scrollLeft > 1);
    bar.classList.toggle('fade-r', more > 1 && bar.scrollLeft < more - 1);
  };
  bar.addEventListener('scroll', fade);
  window.addEventListener('resize', fade);
  new ResizeObserver(fade).observe(bar);
  selectSlot(0);
}

/** The slot nearest to screen x, so a tap in the gap between two slots still picks one. */
export function slotAt(x: number): number {
  let best = -1, bd = Infinity;
  slots.forEach((el, i) => {
    const r = el.getBoundingClientRect(), d = Math.abs(x - (r.left + r.right) / 2);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

export function selectSlot(i: number): void {
  hud.sel = i;
  slots.forEach((el, k) => el.classList.toggle('sel', k === i));
  // keep the selected slot in view when the hotbar scrolls
  const el = slots[i], bar = els.hotbar, pad = 6;
  if (el && bar.scrollWidth > bar.clientWidth) {
    if (el.offsetLeft - pad < bar.scrollLeft) bar.scrollLeft = el.offsetLeft - pad;
    else if (el.offsetLeft + el.offsetWidth + pad > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = el.offsetLeft + el.offsetWidth + pad - bar.clientWidth;
  }
  onSelect(i);
}

/* ============================ MENU ============================ */
let renderDistance = 6, onRenderDistance: (r: number) => void = () => {};
let rdMin = 3, rdMax = 10;

/** Wire the menu's view-distance stepper. `apply` is told about every change. */
export function initMenu(r: number, min: number, max: number, apply: (r: number) => void): void {
  renderDistance = r; rdMin = min; rdMax = max; onRenderDistance = apply;
  els.rd.textContent = String(r);
}
let fancyLeaves = true, onFancyLeaves: (on: boolean) => void = () => {};
/** Wire the menu's Fancy leaves toggle. `apply` is told about every change. */
export function initLeavesToggle(on: boolean, apply: (on: boolean) => void): void {
  onFancyLeaves = apply;
  setFancyLeaves(on, false);
}
/** Turn Fancy leaves on or off (updating the menu button); `notify` passes it on to `apply`. */
export function setFancyLeaves(on: boolean, notify = true): void {
  fancyLeaves = on;
  els.leavesBtn.textContent = on ? 'ON' : 'OFF';
  els.leavesBtn.classList.toggle('off', !on);
  els.leavesBtn.setAttribute('aria-pressed', String(on));
  if (notify) onFancyLeaves(on);
}
export const toggleFancyLeaves = () => setFancyLeaves(!fancyLeaves);
export const menuOpen = () => document.body.classList.contains('menu');
export function showMenu(open: boolean): void { document.body.classList.toggle('menu', open); }
export function stepRenderDistance(delta: number): void {
  const r = Math.max(rdMin, Math.min(rdMax, renderDistance + delta));
  if (r === renderDistance) return;
  renderDistance = r;
  els.rd.textContent = String(r);
  onRenderDistance(r);
}

/* ============================ FULLSCREEN ============================ */
// Prefixed APIs for iOS/older Safari
type FsElement = HTMLElement & { webkitRequestFullscreen?: (o?: FullscreenOptions) => Promise<void> | void };
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };

const fsEl = document.documentElement as FsElement;
export const canFS = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);

export function toggleFullscreen(forceOn: boolean): void {
  const doc = document as FsDocument;
  try {
    const on = doc.fullscreenElement || doc.webkitFullscreenElement;
    let p: Promise<void> | void | undefined;
    if (on && !forceOn) p = (doc.exitFullscreen || doc.webkitExitFullscreen)!.call(doc);
    else if (!on) p = (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen)!.call(fsEl, { navigationUI: 'hide' });
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* not allowed here */ }
}

/* ============================ START SCREEN ============================ */
/** Show a fatal error on the start card (the play button stays disabled). */
export function showError(button: string, note: string): void {
  els.play.textContent = button;
  els.note.textContent = note;
}

/** Note under the play button (e.g. when saving is unavailable). */
export function setNote(text: string): void { els.note.textContent = text; }

export interface WorldEntry { id: string; name: string; seed: number; lastPlayed: number; played: boolean }
export interface WorldActions { open(id: string): void; remove(id: string): void; create(): void }

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} day${d > 1 ? 's' : ''} ago` : new Date(t).toLocaleDateString();
};

/**
 * List the saved worlds on the start card; `current` is the one loaded behind it. Tapping another
 * world opens it, ✕ asks for a second tap before deleting.
 */
export function showWorlds(list: WorldEntry[], current: string, act: WorldActions): void {
  els.worlds.textContent = '';
  for (const w of list) {
    const row = document.createElement('div'), text = document.createElement('div');
    const name = document.createElement('span'), meta = document.createElement('span'), del = document.createElement('button');
    row.className = 'wrow' + (w.id === current ? ' sel' : '');
    text.className = 'wtext';
    name.className = 'wname'; name.textContent = w.name;
    meta.className = 'wmeta'; meta.textContent = `${w.played ? ago(w.lastPlayed) : 'new'} · seed ${w.seed}`;
    del.className = 'wdel'; del.textContent = '✕'; del.setAttribute('aria-label', 'Delete ' + w.name);
    text.append(name, meta);
    row.append(text, del);
    row.addEventListener('click', () => { if (w.id !== current) act.open(w.id); });
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!del.classList.contains('arm')) { del.classList.add('arm'); del.textContent = 'DELETE?'; return; }
      act.remove(w.id);
    });
    els.worlds.appendChild(row);
    if (w.id === current) requestAnimationFrame(() => row.scrollIntoView({ block: 'nearest' }));
  }
  els.newWorld.hidden = false;
  els.newWorld.onclick = () => act.create();
}

/** Enable the play button; `onStart` runs once, on the first tap of the start screen. */
export function initStartScreen(onStart: () => void): void {
  let started = false;
  if (!canFS) els.fs.style.display = 'none';
  els.play.disabled = false;
  els.play.textContent = 'TAP TO PLAY';
  els.start.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-ui]')) return;     // world list, new island
    if (started) return;
    started = true;
    onStart();
    document.body.classList.add('playing');
    els.start.classList.add('hide');
    setTimeout(() => { els.start.style.display = 'none'; }, 400);
    if (canFS) toggleFullscreen(true);
    toast('Tap to break · pick a block up top to build', 3000);
  });
}
