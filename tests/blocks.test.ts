import { describe, expect, it } from 'vitest';
import {
  AIR, GRASS, DIRT, STONE, SAND, LOG, PLANKS, LEAVES, BRICK, BEDROCK, WATER, GLASS, TORCH, B, HOTBAR, NT,
  SOLID, OPAQUE, PASS, MODEL, OCCLUDES, TARGETABLE, REPLACEABLE, faceHidden,
} from '../src/blocks';

/** Plain opaque cubes */
const CUBES = [GRASS, DIRT, STONE, SAND, LOG, PLANKS, BRICK, BEDROCK];
const SEE_THROUGH = [GLASS, LEAVES, WATER, TORCH];

describe('block registry', () => {
  it('keeps every id: chunks and saves store them', () => {
    expect([AIR, GRASS, DIRT, STONE, SAND, LOG, PLANKS, LEAVES, BRICK, BEDROCK, WATER, GLASS, TORCH])
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('has every block at its own id, with valid flags and tiles', () => {
    B.forEach((b, id) => {
      expect(b.id).toBe(id);
      expect(['opaque', 'cutout', 'translucent']).toContain(b.renderPass);
      expect(['cube', 'torch', 'liquid']).toContain(b.model);
      expect(b.lightEmission).toBeGreaterThanOrEqual(0);
      expect(b.lightEmission).toBeLessThanOrEqual(15);
      expect([0, 1, 2, 15]).toContain(b.lightFilter);
      for (const t of [...b.tex, b.icon, b.particle, ...(b.fastTex ?? [])]) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThan(NT);
      }
      // an opaque block is a plain cube in the opaque pass that stops all light
      if (b.opaque) expect([b.renderPass, b.model, b.lightFilter]).toEqual(['opaque', 'cube', 15]);
    });
  });

  it('describes the see-through blocks', () => {
    expect(B[GLASS]).toMatchObject({ solid: true, opaque: false, renderPass: 'cutout', lightFilter: 0, model: 'cube', cullSame: true });
    expect(B[LEAVES]).toMatchObject({ solid: true, opaque: false, renderPass: 'cutout', lightFilter: 1, model: 'cube', cullSame: false });
    expect(B[LEAVES].fastTex).toBeDefined();
    expect(B[WATER]).toMatchObject({ solid: false, opaque: false, renderPass: 'translucent', lightFilter: 2, model: 'liquid', cullSame: true });
    expect(B[TORCH]).toMatchObject({ solid: false, opaque: false, renderPass: 'cutout', lightFilter: 0, model: 'torch' });
    expect(B[TORCH].lightEmission).toBeGreaterThan(0);
  });

  it('keeps the first 8 hotbar slots, so slot numbers in old saves still mean the same block', () => {
    expect(HOTBAR.slice(0, 8)).toEqual([GRASS, DIRT, STONE, SAND, LOG, PLANKS, LEAVES, BRICK]);
    expect(HOTBAR.slice(8)).toEqual([GLASS, TORCH]);
  });

  it('has lookup tables that match the registry', () => {
    for (const b of B) {
      expect(SOLID[b.id]).toBe(+b.solid);
      expect(OPAQUE[b.id]).toBe(+b.opaque);
      expect(PASS[b.id]).toBe(['opaque', 'cutout', 'translucent'].indexOf(b.renderPass));
      expect(MODEL[b.id]).toBe(['cube', 'torch', 'liquid'].indexOf(b.model));
    }
    // aim at anything but air and liquids; build into air and liquids only
    expect([AIR, WATER, TORCH, GLASS, STONE].map((id) => TARGETABLE[id])).toEqual([0, 0, 1, 1, 1]);
    expect([AIR, WATER, TORCH, GLASS, STONE].map((id) => REPLACEABLE[id])).toEqual([1, 1, 0, 0, 0]);
    // ambient occlusion: opaque cubes and leaves darken corners; glass, water and torches don't
    expect([STONE, LEAVES, GLASS, WATER, TORCH, AIR].map((id) => OCCLUDES[id])).toEqual([1, 1, 0, 0, 0, 0]);
  });
});

describe('face culling', () => {
  it('hides any face against an opaque neighbour', () => {
    for (const self of [...CUBES, ...SEE_THROUGH]) for (const nb of CUBES) expect(faceHidden(self, nb)).toBe(true);
  });

  it('never hides a face against air', () => {
    for (const self of [...CUBES, ...SEE_THROUGH]) {
      expect(faceHidden(self, AIR)).toBe(false);
      expect(faceHidden(self, AIR, true)).toBe(false);
    }
  });

  it('hides glass–glass faces, but not glass against other see-through blocks', () => {
    expect(faceHidden(GLASS, GLASS)).toBe(true);
    for (const nb of [LEAVES, WATER, TORCH]) expect(faceHidden(GLASS, nb)).toBe(false);
    // whatever is behind glass still shows
    for (const self of [...CUBES, LEAVES, WATER]) expect(faceHidden(self, GLASS)).toBe(false);
  });

  it('keeps leaves next to leaves (fancy leaves)', () => {
    expect(faceHidden(LEAVES, LEAVES)).toBe(false);
    for (const self of [...CUBES, GLASS, WATER]) expect(faceHidden(self, LEAVES)).toBe(false);
  });

  it('treats leaves as opaque cubes with Fancy leaves off', () => {
    for (const self of [...CUBES, LEAVES, GLASS, WATER]) expect(faceHidden(self, LEAVES, true)).toBe(true);
    expect(faceHidden(LEAVES, GLASS, true)).toBe(false);
    expect(faceHidden(GLASS, GLASS, true)).toBe(true);
  });

  it('hides water–water faces, but not water against glass or leaves', () => {
    expect(faceHidden(WATER, WATER)).toBe(true);
    for (const nb of [GLASS, LEAVES, TORCH]) expect(faceHidden(WATER, nb)).toBe(false);
    expect(faceHidden(GLASS, WATER)).toBe(false);
  });

  it('never hides a face behind a torch', () => {
    for (const self of [...CUBES, GLASS, LEAVES, WATER]) expect(faceHidden(self, TORCH)).toBe(false);
  });
});
