// Web Worker: chunk generation, lighting and meshing off the main thread. Pure functions only — no three.js, no DOM.
import { generator } from './gen';
import { meshSection } from './mesher';
import { lightChunk } from './light';
import { CS } from './config';
import type { WorkerRequest, WorkerResponse } from './workers';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerResponse, transfer: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'gen') {
    const data = generator(m.gen).generateChunk(m.seed, m.cx, m.cz);
    ctx.postMessage({ type: 'gen', id: m.id, cx: m.cx, cz: m.cz, data }, [data.buffer]);
  } else if (m.type === 'light') {
    const t0 = performance.now(), light = lightChunk(m.blocks, m.present, m.height), ms = performance.now() - t0;
    ctx.postMessage({ type: 'light', id: m.id, cx: m.cx, cz: m.cz, light, blocks: m.blocks, ms }, [light.buffer, m.blocks.buffer]);
  } else {
    const meshes = m.sections.map((sy) => meshSection(m.pad, m.light, m.state, m.cx * CS, m.cz * CS, sy, m.seed, m.opaqueLeaves, m.seaLevel));
    const transfer: Transferable[] = [m.pad.buffer, m.light.buffer];
    if (m.state) transfer.push(m.state.buffer);
    for (const mesh of meshes) for (const p of mesh) if (p) transfer.push(p.pos.buffer, p.col.buffer, p.uv.buffer, p.layer.buffer, p.index.buffer);
    ctx.postMessage({ type: 'mesh', id: m.id, cx: m.cx, cz: m.cz, meshes, pad: m.pad, light: m.light, state: m.state }, transfer);
  }
};
