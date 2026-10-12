import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHUNK_VOL, CI } from '../src/config';
import { STONE } from '../src/blocks';
import { world } from '../src/world';
import { lightColor, lightUniforms } from '../src/shading';
import { createEntities, type EntityFx } from '../src/entities';
import { BENTLEY, BENTLEY_MODEL, bentleyPose } from '../src/bentley';
import { restPose, poseModel, vertexCount } from '../src/boxmodel';

// a stone floor (its top at y = 30) over chunks 10–12 × 10–12, lit: full skylight above it
const FLOOR = 30;
beforeAll(() => {
  for (let cz = 10; cz <= 12; cz++) for (let cx = 10; cx <= 12; cx++) {
    const d = new Uint8Array(CHUNK_VOL), light = new Uint8Array(CHUNK_VOL);
    for (let y = 0; y < 128; y++) for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      if (y < FLOOR) d[CI(lx, y, lz)] = STONE; else light[CI(lx, y, lz)] = 0xf0;
    }
    world.setChunk(cx, cz, d).light = light;
  }
});

const zs: number[][] = [], fx: EntityFx = { zzz: (x, y, z) => { zs.push([x, y, z]); } };
/** Entities over that floor; `loaded` can be switched off to unload the chunks under them */
function setup() {
  const scene = new THREE.Scene(), on = { loaded: true };
  const ents = createEntities(scene, fx, (x, z) => on.loaded && world.isLoaded(Math.floor(x), Math.floor(z)));
  return { scene, ents, on };
}
const frames = (ents: ReturnType<typeof setup>['ents'], n: number, paused = false) => { for (let i = 0; i < n; i++) ents.update(1 / 60, paused); };

describe('entities', () => {
  it('are one mesh each (one draw call), posed from their box model, falling onto the ground like the player', () => {
    const { scene, ents } = setup();
    const e = ents.add(BENTLEY, 180.5, FLOOR + 3, 180.5, 0);
    expect(scene.children).toEqual([e.mesh]);
    expect(e.mesh.geometry.attributes.position.count).toBe(vertexCount(BENTLEY_MODEL));
    expect(Array.isArray(e.mesh.material)).toBe(false);
    expect(e.state).toBe('idle');
    frames(ents, 60);
    expect(e.body.p[1]).toBe(FLOOR);
    expect(e.body.onGround).toBe(true);
    expect(e.mesh.position.toArray()).toEqual(e.body.p);
    expect(e.age).toBeCloseTo(1, 6);
  });

  it('are lit like the block they stand in, following the time of day and torchlight', () => {
    const { ents } = setup();
    const e = ents.add(BENTLEY, 175.5, FLOOR, 175.5, 0);
    frames(ents, 2);
    expect(e.mesh.material.color.toArray()).toEqual(lightColor(0xf0, new THREE.Color()).toArray());
    lightUniforms.daylight.value = 0.38;                       // night
    frames(ents, 1);
    const night = e.mesh.material.color.clone();
    expect(night.r).toBeLessThan(0.6);
    // a torch's light (block light 14) in his block: warm
    const c = world.chunk(10, 10)!;
    c.light![CI(175 & 15, FLOOR, 175 & 15)] = 0x0e;
    frames(ents, 1);
    const torch = e.mesh.material.color;
    expect(torch.r).toBeGreaterThan(night.r);
    expect(torch.r).toBeGreaterThan(torch.b + 0.2);
    lightUniforms.daylight.value = 1;
    c.light![CI(175 & 15, FLOOR, 175 & 15)] = 0xf0;
  });

  it('freeze, unseen, while the chunks under them are not loaded, and stand still while paused', () => {
    const { ents, on } = setup();
    const e = ents.add(BENTLEY, 170.5, FLOOR + 2, 170.5, 0);
    on.loaded = false;
    frames(ents, 30);
    expect(e.frozen).toBe(true);
    expect(e.mesh.visible).toBe(false);
    expect([e.body.p[1], e.age]).toEqual([FLOOR + 2, 0]);
    on.loaded = true;
    frames(ents, 1);
    expect(e.frozen).toBe(false);
    expect(e.mesh.visible).toBe(true);
    expect(e.body.p[1]).toBeLessThan(FLOOR + 2);
    const at = e.body.p.slice(), age = e.age;
    frames(ents, 30, true);                                    // the menu is open
    expect(e.body.p).toEqual(at);
    expect(e.age).toBe(age);
  });

  it('ease into a new state, and only states their kind has', () => {
    const { ents } = setup();
    const e = ents.add(BENTLEY, 165.5, FLOOR, 165.5, 0.5);
    frames(ents, 10);
    ents.setState(e, 'nap');
    expect(e.state).toBe('idle');
    ents.setState(e, 'sleep');
    expect([e.state, e.t]).toEqual(['sleep', 0]);
    const pos = e.mesh.geometry.attributes.position.array as Float32Array;
    /** Bentley's sleeping pose now, on its own */
    const asleep = () => {
      const n = vertexCount(BENTLEY_MODEL), out = new Float32Array(n * 3), p = restPose(BENTLEY_MODEL);
      bentleyPose('sleep', e.age, p);
      poseModel(BENTLEY_MODEL, p, e.yaw, out, new Float32Array(n * 3), new Float64Array(BENTLEY_MODEL.parts.length * 12));
      return out;
    };
    const off = (a: Float32Array) => Math.max(...a.map((v, i) => Math.abs(v - pos[i])));
    frames(ents, 3);
    expect(off(asleep())).toBeGreaterThan(0.1);                // still flopping over
    frames(ents, 30);
    expect(off(asleep())).toBeLessThan(1e-6);                  // asleep
    frames(ents, 10);
    expect(zs.length).toBeGreaterThan(0);                      // and a Z on its way up (0.6 s in)
  });

  it('walking, hop up a step they walk into (Bentley)', () => {
    // a platform a block high just ahead of him (he faces −z)
    for (let x = 178; x <= 192; x++) for (let z = 176; z <= 184; z++) world.setBlock(x, FLOOR, z, STONE);
    const { ents } = setup();
    const e = ents.add(BENTLEY, 185.5, FLOOR, 185.5, 0);
    ents.setState(e, 'walk');
    let top = 0;
    for (let i = 0; i < 120; i++) { ents.update(1 / 60, false); if (e.body.onGround) top = Math.max(top, e.body.p[1]); }
    expect(top).toBe(FLOOR + 1);
    for (let x = 178; x <= 192; x++) for (let z = 176; z <= 184; z++) world.setBlock(x, FLOOR, z, 0);
  });

  it('can be removed', () => {
    const { scene, ents } = setup();
    const e = ents.add(BENTLEY, 160.5, FLOOR, 160.5, 0);
    ents.remove(e);
    expect(scene.children).toEqual([]);
    expect(ents.list).toEqual([]);
    frames(ents, 2);
  });
});
