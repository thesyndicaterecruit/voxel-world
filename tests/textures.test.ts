import { describe, expect, it } from 'vitest';
import { B, NT, PRESENT, PRESENTS, CANDY_CANE, PINK_CANDY_CANE, GINGERBREAD, ICING, ICED_GINGERBREAD, SNOW_BRICKS, FROSTED_GLASS,
  PUZZLE_ICE, SNOW, T_PRESENT, PAW_PRINTS, BAUBLE, BAUBLES, FAIRY_LIGHTS, WREATH, STOCKING, STAR, T_PAW_PRINTS, T_PAW_ICON, T_BAUBLE,
  T_FAIRY_LIGHTS, T_STAR } from '../src/blocks';
import { TILE_PAINTERS, paintTile } from '../src/textures';

// Every tile painted the way the game paints them (in order: they share one random sequence), as
// 32 × 32 RGBA, rows top down.
const tiles = TILE_PAINTERS.map(paintTile);
const TS = 32;
const px = (t: number, x: number, y: number) => Array.from(tiles[t].subarray((y * TS + x) * 4, (y * TS + x) * 4 + 4));
/** f holds for every texel (x, y) */
const all = (f: (x: number, y: number) => boolean) => { for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) if (!f(x, y)) return false; return true; };
/** Share of texels (x, y) for which f holds, within the box x0 … x1 − 1, y0 … y1 − 1 */
function share(t: number, f: (c: number[]) => boolean, x0 = 0, y0 = 0, x1 = TS, y1 = TS): number {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (f(px(t, x, y))) n++;
  return n / ((x1 - x0) * (y1 - y0));
}
/** Average colour of the texels in a box */
function mean(t: number, x0 = 0, y0 = 0, x1 = TS, y1 = TS): number[] {
  const s = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px(t, x, y).slice(0, 3).forEach((v, i) => (s[i] += v));
  return s.map((v) => v / ((x1 - x0) * (y1 - y0)));
}
const luma = ([r, g, b]: number[]) => 0.299 * r + 0.587 * g + 0.114 * b;
const white = (c: number[]) => Math.min(c[0], c[1], c[2]) > 200;
const edge = (x: number, y: number) => Math.min(x, y, TS - 1 - x, TS - 1 - y);
const side = (id: number) => B[id].tex[0];

describe('tiles', () => {
  it('has a painter per tile, and paints every tile approved so far exactly as before (new tiles go at the end)', () => {
    expect(tiles.length).toBe(NT);
    const fnv = (n: number) => {                               // FNV-1a of every texel of tiles 0 … n − 1
      let h = 0x811c9dc5;
      for (const t of tiles.slice(0, n)) for (const v of t) h = Math.imul(h ^ v, 16777619);
      return (h >>> 0).toString(16);
    };
    expect(fnv(T_PRESENT)).toBe('b86ec56d');                   // up to the Christmas tiles
    expect(fnv(98)).toBe('6cc79739');                          // and the Christmas cubes' (Milestone 1a)
  });

  it('paints the Christmas cubes solid: no see-through texels but frosted glass\'s', () => {
    const ids = B.filter((b) => b.id >= PRESENT && b.id <= PUZZLE_ICE && b.id !== FROSTED_GLASS).map((b) => b.id);
    for (const t of new Set(ids.flatMap((id) => [...B[id].tex, B[id].icon]))) expect(all((x, y) => px(t, x, y)[3] === 255), `tile ${t}`).toBe(true);
  });
});

describe('the Christmas decorations\' tiles', () => {
  const DECOR = [PAW_PRINTS, ...BAUBLES.map((_, i) => BAUBLE + i), FAIRY_LIGHTS, WREATH, STOCKING, STAR];
  const solid = (c: number[]) => c[3] > 127;

  it('are cut out: clear round the decoration, every texel solid or clear; the bits that fly off are solid', () => {
    for (const id of DECOR) {
      const t = B[id].tex[0], s = share(t, solid);
      expect(s, B[id].name).toBeGreaterThan(0.04);
      expect(s, B[id].name).toBeLessThan(0.6);
      expect(all((x, y) => [0, 255].includes(px(t, x, y)[3]))).toBe(true);
      expect(all((x, y) => px(B[id].particle, x, y)[3] === 255), `${B[id].name}'s bits`).toBe(true);
    }
  });

  it('press paw prints into snow: the prints alone in the world, the same prints in a square of snow as the icon', () => {
    const prints = (x: number, y: number) => solid(px(T_PAW_PRINTS, x, y));
    expect(share(T_PAW_PRINTS, solid)).toBeLessThan(0.25);
    expect(share(T_PAW_ICON, solid)).toBe(1);
    expect(all((x, y) => !prints(x, y) || px(T_PAW_ICON, x, y).every((v, i) => v === px(T_PAW_PRINTS, x, y)[i]))).toBe(true);
    // pressed in: blue-grey, darker than the snow round them
    const inPrint = mean(T_PAW_PRINTS, 4, 18, 15, 29), snow = mean(B[SNOW].tex[0]);
    expect(luma(inPrint)).toBeLessThan(luma(snow));
    // two prints a tile, one in each half, so a trail keeps step from block to block
    expect(share(T_PAW_PRINTS, solid, 0, 16, 16, 32)).toBeGreaterThan(0.1);
    expect(share(T_PAW_PRINTS, solid, 16, 0, 32, 16)).toBeGreaterThan(0.1);
  });

  it('paint each bauble its colour, the star gold, and the fairy lights in many colours along a wire that joins up', () => {
    const ball = (i: number) => mean(T_BAUBLE + i, 12, 14, 20, 22);
    const [pink, red, gold] = [0, 1, 2].map(ball);
    expect(pink[2]).toBeGreaterThan(pink[1] + 30);
    expect(red[0]).toBeGreaterThan(2 * Math.max(red[1], red[2]));
    expect(gold[1]).toBeGreaterThan(gold[2] + 50);
    const st = mean(T_STAR, 12, 8, 20, 16);
    expect(st[0]).toBeGreaterThan(200);
    expect(st[2]).toBeLessThan(st[1] - 60);
    // bulbs: bright, saturated texels of at least four different hues
    const hues = new Set<number>();
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const [r, g, b, a] = px(T_FAIRY_LIGHTS, x, y), hi = Math.max(r, g, b), lo = Math.min(r, g, b);
      if (a && hi > 180 && hi - lo > 100) hues.add(r === hi ? (b > g ? 5 : g > 150 ? 1 : 0) : g === hi ? 2 : 3);
    }
    expect(hues.size).toBeGreaterThanOrEqual(4);
    // the wire leaves one side of the tile at the height it comes in at the other
    const wireRows = (x: number) => Array.from({ length: TS }, (_, y) => y).filter((y) => { const c = px(T_FAIRY_LIGHTS, x, y); return c[3] && luma(c) < 80; });
    expect(wireRows(0).length).toBeGreaterThan(0);
    for (const y of wireRows(TS - 1)) expect(wireRows(0).some((w) => Math.abs(w - y) <= 1)).toBe(true);
  });
});

describe('the Christmas tiles', () => {
  it('wrap each present in paper of its colour, with a ribbon of another colour, and a bow on top', () => {
    const paperOf = PRESENTS.map((_, i) => mean(T_PRESENT + 2 * i + 1, 2, 2, 11, 30));      // left of the ribbon
    const [red, green, gold, pink] = paperOf;
    expect(red[0]).toBeGreaterThan(1.8 * Math.max(red[1], red[2]));
    expect(green[1]).toBeGreaterThan(1.5 * Math.max(green[0], green[2]));
    expect(gold[0]).toBeGreaterThan(gold[1]);
    expect(gold[1]).toBeGreaterThan(2 * gold[2]);
    expect(pink[0]).toBeGreaterThan(200);
    expect(pink[2]).toBeGreaterThan(pink[1]);                  // pink, not orange
    PRESENTS.forEach((_, i) => {
      const top = T_PRESENT + 2 * i, sd = top + 1, ribbon = mean(sd, 14, 2, 18, 30);
      expect(Math.max(...ribbon.map((v, c) => Math.abs(v - paperOf[i][c]))), PRESENTS[i]).toBeGreaterThan(80);
      // the box's edge is darker than the paper next to it, so stacked presents read as separate boxes
      expect(luma(mean(sd, 0, 4, 1, 12))).toBeLessThan(0.9 * luma(mean(sd, 2, 4, 3, 12)));
      // the top has the bow in the middle: a lot more going on there than on a side
      const busy = (t: number) => share(t, (c) => Math.abs(luma(c) - luma(ribbon)) > 25 && Math.abs(luma(c) - luma(paperOf[i])) > 25, 6, 6, 26, 26);
      expect(busy(top)).toBeGreaterThan(busy(sd) + 0.1);
    });
  });

  it('stripes the candy canes diagonally, about half white, the pattern repeating every 16 texels so it runs on from block to block', () => {
    for (const id of [CANDY_CANE, PINK_CANDY_CANE]) {
      const t = side(id), stripe = (x: number, y: number) => px(t, x, y)[1] < 180;
      expect(share(t, white)).toBeGreaterThan(0.4);
      expect(share(t, white)).toBeLessThan(0.65);
      expect(all((x, y) => stripe(x, y) === stripe((x + 16) % TS, y) && stripe(x, y) === stripe(x, (y + 16) % TS))).toBe(true);
      expect(all((x, y) => stripe(x, y) === stripe((x + 1) % TS, (y + TS - 1) % TS))).toBe(true);   // diagonal
    }
    const red = mean(side(CANDY_CANE), 0, 0, TS, TS), pink = mean(side(PINK_CANDY_CANE), 0, 0, TS, TS);
    expect(red[0] - red[2]).toBeGreaterThan(pink[0] - pink[2] + 30);   // the pink one is pink
    expect(pink[2]).toBeGreaterThan(red[2] + 30);
  });

  it('ices the gingerbread: white along the top of its sides, drips running down, gingerbread below, icing on top', () => {
    const t = side(ICED_GINGERBREAD), brown = (c: number[]) => c[0] > c[1] && c[1] > c[2] && c[0] < 220;
    expect(share(t, white, 0, 0, TS, 3)).toBe(1);               // a band of icing along the top
    expect(share(t, brown, 0, 16, TS, TS)).toBe(1);             // gingerbread under it
    let drips = 0;
    for (let x = 0; x < TS; x++) if (white(px(t, x, 8)) && !white(px(t, (x + 6) % TS, 8))) drips++;
    expect(drips).toBeGreaterThan(0);                          // some columns run further down than others
    expect(share(B[GINGERBREAD].tex[0], brown)).toBeGreaterThan(0.95);
    expect(share(B[ICING].tex[0], white)).toBe(1);
    // icing is a warm white, snow a cold one
    const ic = mean(B[ICING].tex[0]), sn = mean(B[SNOW].tex[0]);
    expect(ic[0]).toBeGreaterThan(ic[2]);
    expect(sn[2]).toBeGreaterThan(sn[0]);
  });

  it('frosts the glass: a solid frame, frost round the edges and fronds reaching in, the middle mostly clear', () => {
    const t = side(FROSTED_GLASS), solid = (c: number[]) => c[3] > 127;
    expect(all((x, y) => edge(x, y) > 1 || solid(px(t, x, y)))).toBe(true);
    const clear = 1 - share(t, solid);
    expect(clear).toBeGreaterThan(0.25);                        // you see through it…
    expect(clear).toBeLessThan(0.7);                            // …but it is plainly frosted
    expect(1 - share(t, solid, 10, 10, 22, 22)).toBeGreaterThan(0.55);
    expect(share(t, solid, 2, 2, 30, 6)).toBeGreaterThan(share(t, solid, 10, 10, 22, 22) + 0.3);
    expect(all((x, y) => !solid(px(t, x, y)) || white(px(t, x, y)) || edge(x, y) === 0)).toBe(true);   // frost is white
  });

  it('marks each block of puzzle ice out as a square: a dark groove round it, so a floor of it reads as a grid', () => {
    const t = side(PUZZLE_ICE);
    let groove = 0, inside = 0;
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      if (edge(x, y) === 0) groove += luma(px(t, x, y)) / (4 * TS - 4);
      else if (edge(x, y) >= 4) inside += luma(px(t, x, y)) / ((TS - 8) * (TS - 8));
    }
    expect(groove).toBeLessThan(0.65 * inside);
    // pale blue-green ice, unlike packed ice's blue
    const c = mean(t, 4, 4, 28, 28);
    expect(c[1]).toBeGreaterThan(c[0] + 40);
  });

  it('lays the snow bricks in offset rows whose joints meet across the tile edges', () => {
    const t = side(SNOW_BRICKS), joint = (x: number, y: number) => px(t, x, y)[2] - px(t, x, y)[0] > 28;   // the joints are a bluer grey
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      expect(joint(x, y), `${x}, ${y}`).toBe((y & 7) === 7 || ((x + ((y >> 3) & 1) * 8) & 15) === 15);
    }
  });
});
