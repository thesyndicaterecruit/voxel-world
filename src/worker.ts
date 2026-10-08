// Web Worker: chunk generation off the main thread. Pure functions only — no three.js, no DOM.
import { generateChunk } from './gen';
import type { WorkerRequest, WorkerResponse } from './workers';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerResponse, transfer: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'gen') {
    const data = generateChunk(m.seed, m.cx, m.cz);
    ctx.postMessage({ type: 'gen', id: m.id, cx: m.cx, cz: m.cz, data }, [data.buffer]);
  }
};
