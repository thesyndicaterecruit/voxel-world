import * as THREE from 'three';
import { mulberry, sstep } from './noise';
import { radialFogVertex } from './fog';
import { B } from './blocks';
import { TEX } from './mesher';
import { coverageMips, bleedColors } from './mipmaps';

/* ================= PROCEDURAL PIXEL-ART TEXTURES (32×32) ================= */
const TS = 32;
const trand = mulberry(20240607);              // fixed seed: same textures every time

type RGB = [number, number, number];
/** Set a texel: colour c × brightness k, alpha a (0 = clear, for cutout and translucent tiles) */
type Put = (x: number, y: number, c: RGB, k?: number, a?: number) => void;
type Each = (f: (x: number, y: number) => void) => void;
type Painter = (put: Put, each: Each) => void;

const hx = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const pal = (...a: number[]) => a.map(hx);
function thash(x: number, y: number, s: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(s, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// tileable value noise with cx×cy pixel cells (wraps every TS px so tiles repeat seamlessly)
function tn(x: number, y: number, cx: number, cy: number, s: number): number {
  const px = TS / cx, py = TS / cy, fx = x / cx, fy = y / cy, ix = Math.floor(fx), iy = Math.floor(fy);
  const ux = sstep(fx - ix), uy = sstep(fy - iy);
  const h = (a: number, b: number) => thash(((a % px) + px) % px, ((b % py) + py) % py, s);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const pick = (p: RGB[], v: number) => p[Math.max(0, Math.min(p.length - 1, Math.floor(v * p.length)))];
const rx = () => Math.floor(trand() * TS);
function tile(paint: Painter): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TS;
  const g = cv.getContext('2d')!, img = g.createImageData(TS, TS), d = img.data;
  const put: Put = (x, y, c, k = 1, a = 255) => {
    x = ((x % TS) + TS) % TS; y = ((y % TS) + TS) % TS;
    const i = (y * TS + x) * 4;
    d[i] = c[0] * k; d[i + 1] = c[1] * k; d[i + 2] = c[2] * k; d[i + 3] = a;
  };
  const each: Each = (f) => { for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) f(x, y); };
  paint(put, each);
  g.putImageData(img, 0, 0);
  return cv;
}
const P_DIRT = pal(0x573822, 0x664429, 0x744f30, 0x825a36, 0x91663e);
const P_GRASS = pal(0x3a7b21, 0x448b28, 0x4f9a2f, 0x5aa837, 0x66b63f, 0x76c54b);
const P_STONE = pal(0x66666a, 0x737377, 0x7f7f84, 0x8b8b90, 0x98989d, 0xa6a6ab);
const P_SAND = pal(0xcab47a, 0xd5c289, 0xddcc96, 0xe5d6a3, 0xede0b2);
const P_BARK = pal(0x3b2a19, 0x4a351f, 0x594027, 0x684c2f, 0x775837);
const P_WOOD = pal(0x98723f, 0xa67e48, 0xb38a51, 0xc0975b, 0xcca566);
const P_LEAF = pal(0x1d4b14, 0x28611c, 0x337423, 0x3e872b, 0x4a9933, 0x59ac3d);
const P_BRICK = pal(0x83332a, 0x933c2f, 0xa14434, 0xad4d3a, 0x973a2d);
const P_BED = pal(0x19191b, 0x2a2a2e, 0x404045, 0x59595e, 0x74747a);

const dirt: Painter = (put, each) => {
  each((x, y) => put(x, y, pick(P_DIRT, 0.45 * tn(x, y, 8, 8, 1) + 0.25 * tn(x, y, 4, 4, 2) + 0.3 * trand())));
  for (let i = 0; i < 24; i++) {               // pebbles and dark crumbs
    const x = rx(), y = rx(), light = trand() < 0.5, c = hx(light ? 0xa18c73 : 0x432d1b);
    put(x, y, c);
    if (trand() < 0.5) put(x + 1, y, c, light ? 0.85 : 1.15);
  }
};
const grassTop: Painter = (put, each) => {
  each((x, y) => put(x, y, pick(P_GRASS, 0.4 * tn(x, y, 8, 8, 3) + 0.25 * tn(x, y, 4, 4, 4) + 0.35 * trand())));
  for (let i = 0; i < 80; i++) {               // tiny blades: bright tip over a darker root
    const x = rx(), y = rx();
    put(x, y, P_GRASS[5], 1.06); put(x, y + 1, P_GRASS[1]);
  }
};
const grassSide: Painter = (put, each) => {
  dirt(put, each);
  for (let x = 0; x < TS; x++) {               // ragged grass overhang dripping over the dirt
    const len = 5 + Math.floor(tn(x, 0, 4, 32, 5) * 5) + (trand() < 0.3 ? Math.floor(trand() * 5) : 0);
    for (let y = 0; y < len; y++) put(x, y, pick(P_GRASS, y === len - 1 ? 0.1 : 0.25 + 0.75 * trand()));
    put(x, len, hx(0x47301c));                  // shadow under the grass
  }
};
const stone: Painter = (put, each) => {
  each((x, y) => put(x, y, pick(P_STONE, 0.5 * tn(x, y, 16, 16, 6) + 0.3 * tn(x, y, 4, 4, 7) + 0.2 * trand())));
  for (let i = 0; i < 6; i++) {                // hairline cracks
    let x = rx(), y = rx();
    for (let j = 0, n = 4 + Math.floor(trand() * 8); j < n; j++) {
      put(x, y, hx(0x545458));
      if (trand() < 0.5) x += trand() < 0.5 ? 1 : -1; else y += 1;
    }
  }
  for (let i = 0; i < 20; i++) put(rx(), rx(), hx(0xbababf)); // mineral glints
};
const sand: Painter = (put, each) => {
  each((x, y) => put(x, y, pick(P_SAND, 0.3 * tn(x, y, 8, 8, 8) + 0.7 * trand())));
  for (let i = 0; i < 30; i++) put(rx(), rx(), hx(trand() < 0.6 ? 0xb0985f : 0xf8f0d4));
};
const logSide: Painter = (put, each) => {
  each((x, y) => put(x, y, pick(P_BARK, 0.55 * tn(x, y, 2, 16, 9) + 0.25 * tn(x, y, 4, 8, 10) + 0.2 * trand())));
  for (let i = 0; i < 8; i++) {                // deep vertical furrows
    let x = rx();
    const y0 = rx();
    for (let j = 0, n = 8 + Math.floor(trand() * 18); j < n; j++) {
      put(x, y0 + j, P_BARK[0], 0.75);
      if (trand() < 0.15) x += trand() < 0.5 ? 1 : -1;
    }
  }
};
const logTop: Painter = (put, each) => {
  each((x, y) => {
    const dx = x - 15.5, dy = y - 15.5, edge = Math.max(Math.abs(dx), Math.abs(dy));
    if (edge > 13.5) { put(x, y, pick(P_BARK, 0.3 + 0.7 * trand())); return; } // bark rim
    const r = 0.55 * Math.hypot(dx, dy) + 0.45 * edge + tn(x, y, 8, 8, 11) * 1.8;
    put(x, y, pick(P_WOOD, 0.1 + 0.6 * (0.5 + 0.5 * Math.sin(r * 1.9)) + 0.3 * trand())); // growth rings
  });
  put(15, 15, P_WOOD[0], 0.8); put(16, 16, P_WOOD[0], 0.8); put(15, 16, P_WOOD[0], 0.9); put(16, 15, P_WOOD[0], 0.9);
};
const planks: Painter = (put, each) => {
  const tone = [0.08, -0.06, 0.04, -0.1].map((v) => v + (trand() - 0.5) * 0.1), joint = [5, 21, 13, 27];
  each((x, y) => {
    const b = y >> 3, yy = y & 7;
    if (yy === 7) { put(x, y, hx(0x664624)); return; }        // seam between boards
    if (x === joint[b]) { put(x, y, hx(0x76532d)); return; }   // board end
    const v = 0.5 + tone[b] + 0.4 * (tn(x, y, 16, 2, 12 + b) - 0.5) + 0.25 * (trand() - 0.5); // long grain
    put(x, y, pick(P_WOOD, v), yy === 0 ? 1.08 : 1);
  });
  joint.forEach((j, b) => { put(j + 2, b * 8 + 3, hx(0x3e2b17)); put(j - 2, b * 8 + 3, hx(0x3e2b17)); }); // nails
};
const leaves: Painter = (put, each) => {
  each((x, y) => {
    if (thash(x, y, 77) < 0.13) { put(x, y, hx(0x112e0b)); return; } // dark gaps between leaves
    put(x, y, pick(P_LEAF, 0.45 * tn(x, y, 4, 4, 13) + 0.2 * tn(x, y, 8, 8, 14) + 0.35 * trand()));
  });
  for (let i = 0; i < 34; i++) { const x = rx(), y = rx(); put(x, y, P_LEAF[5], 1.12); put(x + 1, y + 1, P_LEAF[1]); }
};
const brick: Painter = (put, each) => {
  each((x, y) => {
    const row = y >> 3, yy = y & 7, sx = (x + (row & 1) * 8) & 31, bx = sx & 15;
    if (yy >= 6 || bx >= 14) { put(x, y, hx(0xb1a794), 0.86 + 0.2 * trand()); return; } // mortar
    let k = 0.9 + 0.18 * trand();
    if (yy === 0) k *= 1.12; else if (yy === 5) k *= 0.84;  // bevel: lit top edge, shaded bottom
    if (bx === 0) k *= 1.06; else if (bx === 13) k *= 0.9;
    put(x, y, P_BRICK[Math.floor(thash(sx >> 4, row, 15) * P_BRICK.length)], k);
  });
};
const bedrock: Painter = (put, each) => {
  each((x, y) => put(x, y, pick(P_BED, 0.6 * tn(x, y, 4, 4, 16) + 0.4 * trand())));
};
const P_WATER = pal(0x2c69ad, 0x3274bb, 0x3b80c6, 0x448bcf, 0x5299d8);
const water: Painter = (put, each) => {
  // see-through blue with soft horizontal swells and a few light glints
  each((x, y) => put(x, y, pick(P_WATER, 0.6 * tn(x, y, 16, 4, 21) + 0.4 * tn(x, y, 8, 8, 22)), 1, 165));
  for (let i = 0; i < 7; i++) {
    const x = rx(), y = rx(), n = 3 + Math.floor(trand() * 5);
    for (let j = 0; j < n; j++) put(x + j, y, hx(0x9fd0f2), 1, 190);
  }
};

const glass: Painter = (put, each) => {
  each((x, y) => put(x, y, hx(0xd6eaf3), 1, 0));                     // clear centre
  // a light frame two texels wide: pale outer edge, bright inner edge, a little shading bottom-right
  each((x, y) => {
    const e = Math.min(x, y, TS - 1 - x, TS - 1 - y);
    if (e > 1) return;
    const c = e === 0 ? 0xb9d0db : x === TS - 2 || y === TS - 2 ? 0xd3e5ee : 0xf0f8fc;
    put(x, y, hx(c), 0.97 + 0.05 * trand());
  });
  // diagonal glare streaks: a long double one, a short single one, and a glint low on the right
  const streak = (x: number, y: number, n: number, w: number) => {
    for (let i = 0; i < n; i++) for (let j = 0; j < w; j++) put(x + i + j, y - i, hx(0xf7fcff));
  };
  streak(5, 14, 9, 2);
  streak(5, 19, 5, 1);
  streak(21, 26, 4, 1);
};
const leavesCut: Painter = (put, each) => {
  // leaf clusters with see-through gaps between them, and a darker rim around each cluster
  const n = (x: number, y: number) => 0.62 * tn(x, y, 4, 4, 31) + 0.38 * tn(x, y, 8, 8, 32);
  each((x, y) => {
    const v = n(x, y);
    if (v < 0.4) put(x, y, P_LEAF[1], 1, 0);
    else if (v < 0.46) put(x, y, pick(P_LEAF, 0.18 * trand()));
    else put(x, y, pick(P_LEAF, 0.25 + 0.45 * tn(x, y, 4, 4, 33) + 0.3 * trand()));
  });
  for (let i = 0; i < 30; i++) {                // glossy leaf tips, only on leaves
    const x = rx(), y = rx();
    if (n(x, y) >= 0.5) put(x, y, P_LEAF[5], 1.12);
  }
};
const torch: Painter = (put, each) => {
  // a side view, uv = texel position: the stick (x 14–17, y 0–19, y up from the tile's bottom)
  // with a glowing tip, and the flame above it (x 11–20, y 18–29); clear elsewhere
  const at = (x: number, y: number, c: number, k = 1) => put(x, TS - 1 - y, hx(c), k);
  each((x, y) => put(x, y, hx(0x6a4826), 1, 0));
  const wood = [0x5a3d1e, 0x7b5631, 0x8d653a, 0x6b4927];
  for (let y = 0; y < 16; y++) for (let x = 14; x < 18; x++) at(x, y, wood[x - 14], 0.9 + 0.18 * trand());
  for (let y = 16; y < 20; y++) for (let x = 14; x < 18; x++) at(x, y, y >= 18 ? 0xfff0a8 : 0xffb43c);
  for (let y = 18; y < 30; y++) {
    const t = (y - 18) / 11, w = 4.2 * Math.sqrt(Math.sin(Math.PI * (0.12 + 0.88 * t))) * (1 - 0.45 * t);   // teardrop
    for (let x = 11; x < 21; x++) {
      const d = Math.abs(x + 0.5 - 16) / Math.max(w, 0.01);
      if (d > 1) continue;
      at(x, y, d < 0.4 && t < 0.75 ? 0xfffbe2 : d < 0.75 ? 0xffd43c : 0xff8b1e);
    }
  }
};

// Order must match the T_* tile ids in blocks.ts, and new tiles go at the end: all tiles share
// `trand`, so inserting or reordering would change every texture after that point.
const TILE_PAINTERS: Painter[] = [grassTop, grassSide, dirt, stone, sand, logSide, logTop, planks, leaves, brick, bedrock, water,
  glass, leavesCut, torch];

export interface Textures {
  /** Source canvases (also used for the hotbar icons) */
  canvases: HTMLCanvasElement[];
  /** One texture per tile (particles, placement ghost) */
  textures: THREE.CanvasTexture[];
  /** Every tile as one layer of a texture array (RGBA), layer = tile id */
  tileArray: THREE.DataTexture2DArray;
  /**
   * Chunk materials per render pass — opaque, cutout, translucent. Each samples tileArray with the
   * per-vertex `layer`, so every pass of a chunk is one draw call.
   */
  chunkMaterials: THREE.MeshBasicMaterial[];
}

/**
 * Chunk material for render pass `pass`: 0 opaque (alpha ignored), 1 cutout (alpha-tested at 0.5,
 * writes depth), 2 translucent (alpha-blended, no depth writes, drawn after the rest).
 */
function chunkMaterial(tileArray: THREE.DataTexture2DArray, pass: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, alphaTest: pass === 1 ? 0.5 : 0, transparent: pass === 2, depthWrite: pass !== 2 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tiles = { value: tileArray };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float layer;\nvarying vec3 vTile;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n\tvTile = vec3( uv * ${1 / TEX}, layer );`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray tiles;\nvarying vec3 vTile;')
      .replace('#include <map_fragment>', pass === 0 ? 'diffuseColor.rgb *= texture( tiles, vTile ).rgb;' : 'diffuseColor *= texture( tiles, vTile );');
    radialFogVertex(sh);
  };
  m.customProgramCacheKey = () => 'tiles' + pass;
  return m;
}

/** Paint every tile and wrap it in textures + the chunk materials. Call exactly once. */
export function createTextures(renderer: THREE.WebGLRenderer): Textures {
  const canvases = TILE_PAINTERS.map(tile);
  const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const textures = canvases.map((cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter;               // crisp pixels up close
    t.minFilter = THREE.LinearMipmapLinearFilter;    // smooth (no shimmer) in the distance
    t.anisotropy = aniso;
    return t;
  });

  // The same pixels as a texture array (WebGL2; three r128 calls it DataTexture2DArray). Rows are
  // flipped so that v = 1 is the top of the canvas, as with the flipY canvas textures.
  const row = TS * 4, layer = row * TS, data = new Uint8Array(layer * canvases.length);
  canvases.forEach((cv, l) => {
    const px = cv.getContext('2d')!.getImageData(0, 0, TS, TS).data;
    for (let y = 0; y < TS; y++) data.set(px.subarray(y * row, (y + 1) * row), (l * TS + TS - 1 - y) * row);
  });
  // Tiles of cutout blocks that have see-through texels get colour bleeding (no dark fringes) and
  // coverage-preserving mip levels (they don't fade away in the distance). GL generates the mips of
  // every tile; onUpdate then overwrites these tiles' levels.
  const cutout = new Map<number, Uint8Array[]>();
  for (const b of B) {
    if (!b || b.renderPass !== 'cutout') continue;
    for (const t of b.tex) {
      const px = data.subarray(t * layer, (t + 1) * layer);
      if (cutout.has(t) || !px.some((v, i) => (i & 3) === 3 && v < 255)) continue;
      bleedColors(px, TS);
      cutout.set(t, coverageMips(px, TS));
    }
  }
  const tileArray = new THREE.DataTexture2DArray(data, TS, TS, canvases.length);
  tileArray.magFilter = THREE.NearestFilter;
  tileArray.minFilter = THREE.LinearMipmapLinearFilter;
  tileArray.generateMipmaps = true;
  tileArray.anisotropy = aniso;
  tileArray.onUpdate = () => {
    // three has just uploaded level 0 and generated the mips, with the array still bound
    const gl = renderer.getContext() as WebGL2RenderingContext;
    for (const [t, mips] of cutout) mips.forEach((m, i) => {
      const s = TS >> (i + 1);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, i + 1, 0, 0, t, s, s, 1, gl.RGBA, gl.UNSIGNED_BYTE, m);
    });
  };
  tileArray.needsUpdate = true;

  return { canvases, textures, tileArray, chunkMaterials: [0, 1, 2].map((p) => chunkMaterial(tileArray, p)) };
}
