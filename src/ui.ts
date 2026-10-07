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
    el.dataset.act = 'slot';
    el.dataset.i = String(i);
    el.style.backgroundImage = `url(${tileCanvas[B[id].t[0]].toDataURL()})`; // same pixel art as the block
    els.hotbar.appendChild(el);
    return el;
  });
  selectSlot(0);
}

export function selectSlot(i: number): void {
  hud.sel = i;
  slots.forEach((el, k) => el.classList.toggle('sel', k === i));
  onSelect(i);
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

/** Enable the play button; `onStart` runs once, on the first tap of the start screen. */
export function initStartScreen(onStart: () => void): void {
  let started = false;
  if (!canFS) els.fs.style.display = 'none';
  els.play.disabled = false;
  els.play.textContent = 'TAP TO PLAY';
  els.start.addEventListener('click', () => {
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
