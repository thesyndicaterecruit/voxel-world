// World size & chunk size (blocks)
export const W = 32, D = 32, H = 40, CS = 16, NCX = W / CS, NCZ = D / CS;
export const SEA = 6.88;                                // ocean surface height

// Player half-width, height, eye height
export const PR = 0.3, PH = 1.8, EYE = 1.62;
export const GRAV = 32, JUMP = 9, WALK = 4.3, RUN = 6.4, REACH = 6, EPS = 1e-4;

// Sky colours (also used for the clear colour and fog)
export const HORIZON = 0xcde6f7, ZENITH = 0x4a95e3;
