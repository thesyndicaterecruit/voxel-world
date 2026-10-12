import * as THREE from 'three';
import { OPAQUE } from './blocks';
import { world } from './world';
import { stepBody, type Body } from './physics';
import { modelBuffers, vertexCount, restPose, resetPose, blendPose, poseModel, type BoxModel, type Skin } from './boxmodel';
import { radialFog } from './fog';
import { lightColor } from './shading';

/* ============================ ENTITIES ============================ */
// Things that move about in the world and aren't blocks: Bentley now; NPCs, props and pickups later.
// An entity is a body (physics.ts, the same falling and colliding as the player) with a yaw, an
// animation state and a box model (boxmodel.ts) posed on the CPU every frame into one geometry: one
// mesh, one draw call. Its kind says what it looks like and does (`think` before physics, `pose`
// after). It is lit like the block it stands in (lightColor, every frame, so it follows the time of
// day and torchlight), stands still while the menu is open, and freezes (and isn't drawn) while
// the chunks under it aren't loaded. A new state eases in over BLEND seconds (he flops over to sleep).

/** What a kind's behaviour and poses see of an entity (pure: no three.js) */
export interface Creature {
  body: Body;
  /** Which way it faces (0: toward −z, like the player's yaw) */
  yaw: number;
  /** What it's doing: one of its kind's states (its animation) */
  state: string;
  /** Seconds in this state, and seconds alive (animations run on it); neither moves while it is frozen or paused */
  t: number;
  age: number;
  /** It walked into something last frame */
  bumped: boolean;
}
/** The effects a kind can make (effects.ts) */
export interface EntityFx { zzz(x: number, y: number, z: number): void }
/** A kind of entity: its look, size and behaviour */
export interface EntityKind {
  name: string;
  model: BoxModel;
  /** Paint its skin (once, for the first one made) */
  paint(): Skin;
  /** Its body's half-width and height (blocks) */
  r: number;
  h: number;
  /** Its states (animations); the first is the one it starts in */
  states: readonly string[];
  /** Each frame before physics: what it wants (its body's horizontal velocity, its yaw), what it shows */
  think(c: Creature, dt: number, fx: EntityFx): void;
  /** Its pose now, into `out` (a rest pose) */
  pose(c: Creature, out: Float32Array): void;
}
export interface Entity extends Creature {
  readonly kind: EntityKind;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** The chunks under it aren't loaded: it doesn't move and isn't drawn */
  frozen: boolean;
}
export interface Entities {
  readonly list: readonly Entity[];
  /** A new entity of `kind` with its feet at (x, y, z), facing `yaw` */
  add(kind: EntityKind, x: number, y: number, z: number, yaw: number): Entity;
  remove(e: Entity): void;
  /** Set what e is doing (one of its kind's states); it eases into the new pose */
  setState(e: Entity, state: string): void;
  /** Each frame: think, move and pose them (not while `paused`: the menu is open), and light them */
  update(dt: number, paused: boolean): void;
}

/** Seconds a new state takes to ease in */
const BLEND = 0.35;
const ease = (k: number) => k * k * (3 - 2 * k);

/** What an entity needs that the outside doesn't */
interface Inner { pose: Float32Array; from: Float32Array; shown: Float32Array; blend: number; mats: Float64Array }

/** `loaded(x, z)`: are the chunks round column (x, z) loaded (streamer.areaLoaded)? */
export function createEntities(scene: THREE.Scene, fx: EntityFx, loaded: (x: number, z: number) => boolean): Entities {
  const list: Entity[] = [], inner = new Map<Entity, Inner>(), skins = new Map<EntityKind, THREE.DataTexture>();
  const skin = (kind: EntityKind) => {
    let t = skins.get(kind);
    if (!t) {
      const s = kind.paint();
      t = new THREE.DataTexture(new Uint8Array(s.data), s.w, s.h, THREE.RGBAFormat);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.needsUpdate = true;
      skins.set(kind, t);
    }
    return t;
  };

  /** Pose e now (blending into a new state) into its geometry */
  function pose(e: Entity, m: Inner): void {
    resetPose(m.pose);
    e.kind.pose(e, m.pose);
    if (m.blend < 1) blendPose(m.from, m.pose, ease(m.blend), m.shown);
    else m.shown.set(m.pose);
    const g = e.mesh.geometry, pos = g.attributes.position as THREE.BufferAttribute, col = g.attributes.color as THREE.BufferAttribute;
    poseModel(e.kind.model, m.shown, e.yaw, pos.array as Float32Array, col.array as Float32Array, m.mats);
    pos.needsUpdate = col.needsUpdate = true;
  }

  return {
    list,
    add(kind, x, y, z, yaw) {
      const n = vertexCount(kind.model), { uv, index } = modelBuffers(kind.model), g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(index, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.4, 0), 1.2);   // whatever the pose (it fits in a block or so)
      const mesh = new THREE.Mesh(g, radialFog(new THREE.MeshBasicMaterial({ map: skin(kind), vertexColors: true })));
      scene.add(mesh);
      const e: Entity = { kind, mesh, body: { p: [x, y, z], v: [0, 0, 0], r: kind.r, h: kind.h, onGround: false }, yaw, state: kind.states[0],
        t: 0, age: 0, bumped: false, frozen: false };
      const p = restPose(kind.model);
      const m: Inner = { pose: p, from: p.slice(), shown: p.slice(), blend: 1, mats: new Float64Array(kind.model.parts.length * 12) };
      list.push(e);
      inner.set(e, m);
      pose(e, m);
      mesh.position.set(x, y, z);
      return e;
    },
    remove(e) {
      const i = list.indexOf(e);
      if (i < 0) return;
      list.splice(i, 1);
      inner.delete(e);
      scene.remove(e.mesh);
      e.mesh.geometry.dispose();
      e.mesh.material.dispose();
    },
    setState(e, state) {
      const m = inner.get(e);
      if (!m || state === e.state || !e.kind.states.includes(state)) return;
      m.from.set(m.shown);              // ease on from wherever it is now
      m.blend = 0;
      e.state = state;
      e.t = 0;
    },
    update(dt, paused) {
      for (const e of list) {
        const m = inner.get(e)!, p = e.body.p;
        e.frozen = !loaded(p[0], p[2]);
        e.mesh.visible = !e.frozen;
        if (e.frozen) continue;
        if (!paused) {
          e.t += dt; e.age += dt;
          e.kind.think(e, dt, fx);
          e.bumped = stepBody(e.body, dt) !== 0;
          if (m.blend < 1) m.blend = Math.min(1, m.blend + dt / BLEND);
          pose(e, m);
          e.mesh.position.set(p[0], p[1], p[2]);
        }
        // as lit as the block it stands in (the one above if that's solid), now
        const x = Math.floor(p[0]), z = Math.floor(p[2]);
        let y = Math.floor(p[1] + 0.05);
        if (OPAQUE[world.getBlock(x, y, z)]) y++;
        lightColor(world.getLight(x, y, z), e.mesh.material.color);
      }
    },
  };
}
