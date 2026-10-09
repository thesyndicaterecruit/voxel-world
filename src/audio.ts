/* ============================ SOUND (hooks) ============================ */
// Where the game will make sounds once it has audio (generated with Web Audio, keeping the no-assets
// approach; see the roadmap). For now every hook is silent.

export type Sound = 'splash';

/** Play sound `name` at volume 0–1. Silent for now. */
export function playSound(_name: Sound, _volume: number): void { /* audio comes later */ }
