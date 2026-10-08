// Web Worker: chunk generation and meshing off the main thread. Pure functions only — no three.js, no DOM.
import { generateChunk } from './gen';
import { meshChunk } from './mesher';
import { CS } from './config';
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
  } else {
    const mesh = meshChunk(m.pad, m.cx * CS, m.cz * CS, m.seed);
    ctx.postMessage({ type: 'mesh', id: m.id, cx: m.cx, cz: m.cz, mesh, pad: m.pad },
      [mesh.pos.buffer, mesh.col.buffer, mesh.uv.buffer, mesh.layer.buffer, mesh.index.buffer, m.pad.buffer]);
  }
};
