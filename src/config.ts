// Chunks are CS×CS columns, full world height. Chunk index math uses shifts, so CS must be 1 << CB.
export const CB = 4, CS = 1 << CB, H = 64;
// World size in chunks and in blocks: 32×32 chunks = 512×512 blocks
export const NCX = 32, NCZ = 32, W = NCX * CS, D = NCZ * CS;
// Blocks below y = SEA_LEVEL are under water. The water surface sits just below the top of a
// sea-level beach (y = SEA_LEVEL) so the two never z-fight.
export const SEA_LEVEL = 20;
export const WATER_Y = SEA_LEVEL - 0.12;

// Player half-width, height, eye height
export const PR = 0.3, PH = 1.8, EYE = 1.62;
export const GRAV = 32, JUMP = 9, WALK = 4.3, RUN = 6.4, REACH = 6, EPS = 1e-4;

// Sky colours (also used for the clear colour and fog)
export const HORIZON = 0xcde6f7, ZENITH = 0x4a95e3;
