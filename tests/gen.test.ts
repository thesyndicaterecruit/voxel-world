import { describe, expect, it } from 'vitest';
import { generateChunk } from '../src/gen';

describe('world generation', () => {
  it('is a pure function of (seed, chunk): the same whichever order chunks are generated in', () => {
    const first = generateChunk(4242, 16, 16);
    for (const [cx, cz] of [[15, 16], [17, 16], [16, 15], [16, 17], [3, 29]]) generateChunk(4242, cx, cz);
    expect(generateChunk(4242, 16, 16)).toEqual(first);
    expect(generateChunk(4243, 16, 16)).not.toEqual(first);
  });
});
