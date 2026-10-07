import * as THREE from 'three';
import { mulberry, sstep } from './noise';

/* ================= PROCEDURAL PIXEL-ART TEXTURES (32×32) ================= */
const TS = 32;
const trand = mulberry(20240607);              // fixed seed: same textures every time

type RGB = [number, number, number];
type Put = (x: number, y: number, c: RGB, k?: number) => void;
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
  const put: Put = (x, y, c, k = 1) => {
    x = ((x % TS) + TS) % TS; y = ((y % TS) + TS) % TS;
    const i = (y * TS + x) * 4;
    d[i] = c[0] * k; d[i + 1] = c[1] * k; d[i + 2] = c[2] * k; d[i + 3] = 255;
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

// Order must match the T_* tile ids in blocks.ts. Painting order also matters:
// all tiles share `trand`, so reordering would change every texture.
const TILE_PAINTERS: Painter[] = [grassTop, grassSide, dirt, stone, sand, logSide, logTop, planks, leaves, brick, bedrock];

export interface Textures {
  /** Source canvases (also used for the hotbar icons) */
  canvases: HTMLCanvasElement[];
  textures: THREE.CanvasTexture[];
  /** One material per tile; chunk meshes use the whole array with draw groups */
  materials: THREE.MeshBasicMaterial[];
}

/** Paint every tile and wrap it in a texture + material. Call exactly once. */
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
  const materials = textures.map((t) => new THREE.MeshBasicMaterial({ map: t, vertexColors: true }));
  return { canvases, textures, materials };
}
