/* ============================ WORKER POOL ============================ */
// A few Web Workers running worker.ts (chunk generation and meshing). Typed arrays travel as
// transferables (moved, not copied).

import type { MeshData } from './mesher';

export type WorkerRequest =
  | { type: 'gen'; id: number; seed: number; cx: number; cz: number }
  /** `pad` is the chunk plus a one-block border (see paddedCopy); it comes back with the result for reuse */
  | { type: 'mesh'; id: number; seed: number; cx: number; cz: number; pad: Uint8Array };
export type WorkerResponse =
  | { type: 'gen'; id: number; cx: number; cz: number; data: Uint8Array }
  | { type: 'mesh'; id: number; cx: number; cz: number; mesh: MeshData; pad: Uint8Array };

/** Jobs in flight per worker: enough to keep a worker busy while its last result travels back. */
const MAX_INFLIGHT = 2;

export interface WorkerPool {
  /** How many more jobs can be started right now. */
  free(): number;
  /** Start a job on the least busy worker; `done` gets the worker's reply. */
  run(msg: WorkerRequest, transfer: Transferable[], done: (res: WorkerResponse) => void): void;
}

/** `onError` hears about workers that fail to start or throw. */
export function createWorkerPool(onError: (msg: string) => void,
  size = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1))): WorkerPool {
  let nextId = 1;
  const workers = Array.from({ length: size }, () => {
    const w = { worker: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }), busy: 0 };
    w.worker.onerror = (e) => onError(e.message || 'A background worker failed to start.');
    w.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      w.busy--;
      const cb = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (cb) cb(e.data);
    };
    return w;
  });
  const pending = new Map<number, (res: WorkerResponse) => void>();

  return {
    free: () => workers.reduce((n, w) => n + MAX_INFLIGHT - w.busy, 0),
    run(msg, transfer, done) {
      let w = workers[0];
      for (const o of workers) if (o.busy < w.busy) w = o;
      msg.id = nextId++;
      pending.set(msg.id, done);
      w.busy++;
      w.worker.postMessage(msg, transfer);
    },
  };
}
