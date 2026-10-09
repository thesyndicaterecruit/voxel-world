import { NCX } from './config';
import { openDB, type DB } from './db';
import { rleEncode, rleDecode } from './rle';
import { floodSea } from './gen';
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
//   3  world records gain `time` (days since the world began; the fraction is the time of day).
//      Older worlds start at NEW_WORLD_TIME. Chunks are unchanged apart from the version.
//   4  the sea is water blocks (before, one surface was drawn over the world, which held air below
//      it): chunks saved earlier get water in the air below sea level that is open to the sea
//      (floodSea in gen.ts) when they are read. World records are unchanged apart from the version.
//   5  chunks { v: 5, rle, srle?, flow? }: `flow` lists the blocks (CI indices) whose water updates
//      were still pending (water.ts), omitted when there are none. Earlier chunks have none.

export const SAVE_VERSION = 5;
/** When a new world's clock starts: day 1, a little after sunrise (0.25 = 6:00) */
export const NEW_WORLD_TIME = 0.3;
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
  /** Days since the world began: the fraction is the time of day (0 midnight, 0.5 noon) */
  time: number;
}
/** A world record as stored by any version (older ones have no `time`). */
export type StoredWorld = Omit<WorldRecord, 'time'> & { time?: number };
/**
 * A saved chunk: block ids, and the per-block state when any of it is non-zero (both RLE); the blocks
 * with pending water updates, if any.
 */
export interface ChunkRecord { v: number; rle: Uint8Array; srle?: Uint8Array; flow?: Uint16Array }
/** A chunk's contents in memory, and its pending water updates. */
export interface ChunkData { data: Uint8Array; state: Uint8Array | null; flow: Uint16Array | null }
/** Which world (seed) and chunk a record belongs to: migrating chunks from before version 4 needs it. */
export interface ChunkAt { seed: number; cx: number; cz: number }

/** Bring a stored world record (any saveVersion up to SAVE_VERSION) up to date. */
export function migrateWorld(w: StoredWorld): WorldRecord {
  if (w.saveVersion > SAVE_VERSION) throw new Error(`world saved by a newer version (${w.saveVersion})`);
  if (w.saveVersion === SAVE_VERSION) return w as WorldRecord;
  // 1 → 2: nothing in the world record itself changed; 2 → 3: the clock starts in the morning; 3 → 4, 4 → 5: unchanged
  return { ...w, time: w.time ?? NEW_WORLD_TIME, saveVersion: SAVE_VERSION };
}

/**
 * Bring a stored chunk record up to date. Records from before version 4 get the sea (see the
 * history) when `at` says where they are.
 */
export function migrateChunk(r: ChunkRecord, at?: ChunkAt): ChunkRecord {
  if (r.v > SAVE_VERSION) throw new Error(`chunk saved by a newer version (${r.v})`);
  if (r.v === SAVE_VERSION) return r;
  // 1 → 2: no state stream yet, i.e. every state byte is 0; 2 → 3: unchanged; 3 → 4: the sea; 4 → 5: no pending water
  let rle = r.rle;
  if (r.v < 4 && at) {
    const data = rleDecode(rle);
    if (floodSea(data, at.seed, at.cx, at.cz)) rle = rleEncode(data);
  }
  return r.srle ? { v: SAVE_VERSION, rle, srle: r.srle } : { v: SAVE_VERSION, rle };   // no flow before 5
}

/** Encode a chunk for saving, with the blocks that have pending water updates (`flow`). */
export function encodeChunk(data: Uint8Array, state: Uint8Array | null, flow: Uint16Array | null = null): ChunkRecord {
  const r: ChunkRecord = { v: SAVE_VERSION, rle: rleEncode(data) };
  if (state && state.some((s) => s !== 0)) r.srle = rleEncode(state);
  if (flow && flow.length) r.flow = flow.slice();
  return r;
}

/** Decode a saved chunk (of any version; `at`: see migrateChunk); throws if it is corrupt. */
export function decodeChunk(stored: ChunkRecord, at?: ChunkAt): ChunkData {
  const r = migrateChunk(stored, at);
  return { data: rleDecode(r.rle), state: r.srle ? rleDecode(r.srle) : null, flow: r.flow ? Uint16Array.from(r.flow) : null };
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
  const all = await db.getAll<StoredWorld>('worlds');
  return all.filter((w) => w.saveVersion <= SAVE_VERSION).map(migrateWorld).sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export async function createWorld(name: string, seed: number): Promise<WorldRecord> {
  const now = Date.now();
  const w: WorldRecord = {
    id: now.toString(36) + Math.floor(Math.random() * 1e6).toString(36),
    name, seed, createdAt: now, lastPlayed: now, saveVersion: SAVE_VERSION, player: null, slot: 0, mode: 'break',
    time: NEW_WORLD_TIME,
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
 * stored one). `getChunk` returns the loaded chunk, if any; `getFlow` its pending water updates.
 */
export async function openWorld(stored: StoredWorld, getChunk: (cx: number, cz: number) => Chunk | undefined,
  getState: () => Pick<WorldRecord, 'player' | 'slot' | 'mode' | 'time'> | null,
  getFlow: (cx: number, cz: number) => Uint16Array | null = () => null): Promise<WorldSave> {
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
      if (c) entries.push([ci, encodeChunk(c.data, c.state, getFlow(c.cx, c.cz))]);
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
        return decodeChunk(r, { seed: record.seed, cx, cz });
      });
    },
    unload(c) {
      const ci = c.cx + c.cz * NCX;
      if (!dirty.delete(ci)) return;
      pending.set(ci, encodeChunk(c.data, c.state, getFlow(c.cx, c.cz)));
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
