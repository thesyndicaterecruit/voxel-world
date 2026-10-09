// Chunks are CS×CS columns, full world height. Chunk index math uses shifts, so CS must be 1 << CB.
export const CB = 4, CS = 1 << CB, H = 128;
// World size in chunks and in blocks: 32×32 chunks = 512×512 blocks
export const NCX = 32, NCZ = 32, W = NCX * CS, D = NCZ * CS;
/** Blocks in one chunk */
export const CHUNK_VOL = CS * CS * H;
/** Index of local block (lx, y, lz) in chunk data: x fastest, then z, then y. */
export const CI = (lx: number, y: number, lz: number) => lx + CS * (lz + CS * y);
// Sections: a chunk is NSEC sections of CS × SH × CS blocks, bottom up. CI runs y last, so section s
// is the slice [s·SEC_VOL, (s + 1)·SEC_VOL) of a chunk's arrays. Meshes are made per section.
export const SB = 4, SH = 1 << SB, NSEC = H / SH, SEC_VOL = CS * CS * SH;
/** Is column (x, z) inside the world? */
export const inWorld = (x: number, z: number) => x >= 0 && x < W && z >= 0 && z < D;
/** How high the world was before save version 6 (chunks saved then hold this many layers) */
export const OLD_H = 64;
// The sea level depends on the world's generator (gen.ts): generation fills the air below it with
// water. A source block's surface is 1/8 of a block below its top, so the sea's surface sits just
// below a sea-level beach.

// Player half-width, height, eye height
export const PR = 0.3, PH = 1.8, EYE = 1.62;
export const GRAV = 32, JUMP = 9, WALK = 4.3, RUN = 6.4, REACH = 6, EPS = 1e-4;

// Sky colours (also used for the clear colour and fog)
export const HORIZON = 0xcde6f7, ZENITH = 0x4a95e3;
