import { NCX } from './config';
import { openDB, type DB } from './db';
import { rleEncode, rleDecode } from './rle';
import type { Chunk } from './world';
import type { Mode } from './ui';

/* ============================ SAVE FILES ============================ */
// IndexedDB "voxel-island":
//   worlds  keyPath id  → WorldRecord
//   chunks  key `${worldId}:${cx},${cz}` → ChunkRecord — only chunks the player edited; everything
//           else regenerates from the seed
// Bump SAVE_VERSION when the stored format changes, and teach migrateWorld/migrateChunk to bring
// older records up to date (they run on every record read, so old saves keep loading).
//
// History:
//   1  chunks { v: 1, rle } — block ids only
//   2  chunks { v: 2, rle, srle? } — plus the per-block state (torch facing, water level, …) as a
//      second RLE stream, omitted while every state byte is 0. World records are unchanged; the
//      hotbar grew, but new items go at the end so saved slot numbers still point at the same block.

export const SAVE_VERSION = 2;
const DB_NAME = 'voxel-island', DB_VERSION = 1;
/** Autosave runs at most this long after the first unsaved change. */
const AUTOSAVE_MS = 5000;

export interface PlayerState { x: number; y: number; z: number; yaw: number; pitch: number }
export interface WorldRecord {
  id: string;
  name: string;
  seed: number;
  createdAt: number;
  lastPlayed: number;
  saveVersion: number;
  /** null until the world is first played: start at the spawn point */
  player: PlayerState | null;
  /** Selected hotbar slot */
  slot: number;
  mode: Mode;
}
/** A saved chunk: block ids, and the per-block state when any of it is non-zero (both RLE). */
export interface ChunkRecord { v: number; rle: Uint8Array; srle?: Uint8Array }
/** A chunk's contents in memory. */
export interface ChunkData { data: Uint8Array; state: Uint8Array | null }

/** Bring a stored world record (any saveVersion up to SAVE_VERSION) up to date. */
export function migrateWorld(w: WorldRecord): WorldRecord {
  if (w.saveVersion > SAVE_VERSION) throw new Error(`world saved by a newer version (${w.saveVersion})`);
  // 1 → 2: nothing in the world record itself changed
  return w.saveVersion === SAVE_VERSION ? w : { ...w, saveVersion: SAVE_VERSION };
}

/** Bring a stored chunk record up to date. */
export function migrateChunk(r: ChunkRecord): ChunkRecord {
  if (r.v > SAVE_VERSION) throw new Error(`chunk saved by a newer version (${r.v})`);
  // 1 → 2: no state stream yet, i.e. every state byte is 0
  return r.v === SAVE_VERSION ? r : { v: SAVE_VERSION, rle: r.rle };
}

/** Encode a chunk for saving. */
export function encodeChunk(data: Uint8Array, state: Uint8Array | null): ChunkRecord {
  const r: ChunkRecord = { v: SAVE_VERSION, rle: rleEncode(data) };
  if (state && state.some((s) => s !== 0)) r.srle = rleEncode(state);
  return r;
}

/** Decode a saved chunk (of any version); throws if it is corrupt. */
export function decodeChunk(stored: ChunkRecord): ChunkData {
  const r = migrateChunk(stored);
  return { data: rleDecode(r.rle), state: r.srle ? rleDecode(r.srle) : null };
}

const chunkKey = (id: string, cx: number, cz: number) => `${id}:${cx},${cz}`;
const worldRange = (id: string) => IDBKeyRange.bound(`${id}:`, `${id}:￿`);

let db: DB | null = null;

/**
 * Open the save database. Resolves to false when saving is unavailable (no IndexedDB, private mode,
 * blocked); the game still runs, worlds just live in memory.
 */
export async function openSaves(): Promise<boolean> {
  try {
    db = await openDB(DB_NAME, DB_VERSION, (d) => {
      if (!d.objectStoreNames.contains('worlds')) d.createObjectStore('worlds', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks');
    });
  } catch (e) {
    db = null;
    return false;
  }
  // ask the browser not to evict our saves under storage pressure (no prompt; may be refused)
  try { void navigator.storage?.persist?.(); } catch (e) { /* not supported */ }
  return true;
}

/** Saved worlds, most recently played first. */
export async function listWorlds(): Promise<WorldRecord[]> {
  if (!db) return [];
  const all = await db.getAll<WorldRecord>('worlds');
  return all.filter((w) => w.saveVersion <= SAVE_VERSION).map(migrateWorld).sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export async function createWorld(name: string, seed: number): Promise<WorldRecord> {
  const now = Date.now();
  const w: WorldRecord = {
    id: now.toString(36) + Math.floor(Math.random() * 1e6).toString(36),
    name, seed, createdAt: now, lastPlayed: now, saveVersion: SAVE_VERSION, player: null, slot: 0, mode: 'break',
  };
  if (db) await db.write(['worlds'], (tx) => tx.objectStore('worlds').put(w));
  return w;
}

export async function deleteWorld(id: string): Promise<void> {
  if (!db) return;
  await db.write(['worlds', 'chunks'], (tx) => {
    tx.objectStore('worlds').delete(id);
    tx.objectStore('chunks').delete(worldRange(id));
  });
}

/* ======================= THE WORLD BEING PLAYED ======================= */
export interface WorldSave {
  readonly record: WorldRecord;
  /** Streamer source: edited contents of a chunk (saved or waiting to be), or null to generate it. */
  load(cx: number, cz: number): Promise<ChunkData> | null;
  /** Streamer source: a chunk is being dropped from memory; keeps its unsaved edits. */
  unload(c: Chunk): void;
  /** A block in chunk (cx, cz) changed. */
  touch(cx: number, cz: number): void;
  /** Something (e.g. the player state) changed: make sure an autosave runs soon. */
  requestSave(): void;
  /** Write every unsaved chunk plus the player state now. */
  save(): Promise<void>;
}

/**
 * `getState` reports the current player state for each save (null: not playing yet, keep the
 * stored one). `getChunk` returns the loaded chunk, if any.
 */
export async function openWorld(stored: WorldRecord, getChunk: (cx: number, cz: number) => Chunk | undefined,
  getState: () => Pick<WorldRecord, 'player' | 'slot' | 'mode'> | null): Promise<WorldSave> {
  const record = migrateWorld(stored), id = record.id;
  // chunks with saved edits
  const saved = new Set<number>();
  if (db) {
    for (const k of await db.keys('chunks', worldRange(id))) {
      const m = /:(\d+),(\d+)$/.exec(String(k));
      if (m) saved.add(+m[1] + +m[2] * NCX);
    }
  }
  const dirty = new Set<number>();                 // loaded chunks with unsaved edits
  const pending = new Map<number, ChunkRecord>();  // unloaded chunks with unsaved edits (encoded)
  let timer = 0, chain: Promise<void> = Promise.resolve();

  async function write(): Promise<void> {
    clearTimeout(timer);
    timer = 0;
    const st = getState();
    if (st) Object.assign(record, st, { lastPlayed: Date.now() });
    if (!db) return;                               // no saving: edits stay in memory (pending) for this session
    // snapshot everything now; edits made while the write runs are picked up next time
    const entries: [number, ChunkRecord][] = [...pending];
    pending.clear();
    for (const ci of dirty) {
      const c = getChunk(ci % NCX, Math.floor(ci / NCX));
      if (c) entries.push([ci, encodeChunk(c.data, c.state)]);
    }
    dirty.clear();
    try {
      await db.write(['worlds', 'chunks'], (tx) => {
        const chunks = tx.objectStore('chunks');
        for (const [ci, r] of entries) chunks.put(r, chunkKey(id, ci % NCX, Math.floor(ci / NCX)));
        tx.objectStore('worlds').put(record);
      });
      for (const [ci] of entries) saved.add(ci);
    } catch (e) {
      // try again next time: loaded chunks are simply dirty again, unloaded ones keep their snapshot
      for (const [ci, r] of entries) {
        if (getChunk(ci % NCX, Math.floor(ci / NCX))) dirty.add(ci);
        else if (!pending.has(ci)) pending.set(ci, r);
      }
      console.warn('Saving failed', e);
    }
  }

  const ws: WorldSave = {
    record,
    load(cx, cz) {
      const ci = cx + cz * NCX, p = pending.get(ci);
      if (p) {
        pending.delete(ci);
        dirty.add(ci);                             // still unsaved, now from the loaded chunk
        return Promise.resolve(decodeChunk(p));
      }
      if (!db || !saved.has(ci)) return null;
      return db.get<ChunkRecord>('chunks', chunkKey(id, cx, cz)).then((r) => {
        if (!r) throw new Error('missing chunk');
        return decodeChunk(r);
      });
    },
    unload(c) {
      const ci = c.cx + c.cz * NCX;
      if (!dirty.delete(ci)) return;
      pending.set(ci, encodeChunk(c.data, c.state));
      ws.requestSave();
    },
    touch(cx, cz) {
      dirty.add(cx + cz * NCX);
      ws.requestSave();
    },
    requestSave() {
      if (!timer) timer = window.setTimeout(() => void ws.save(), AUTOSAVE_MS);
    },
    save() {
      chain = chain.then(write, write);
      return chain;
    },
  };
  return ws;
}
