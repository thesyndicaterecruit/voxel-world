import { CHUNK_VOL } from './config';

/* ======================= RUN-LENGTH ENCODING ======================= */
// Saved chunks are runs of (length, block id): the length as a LEB128 varint, then the id byte.
// Chunk data runs x-fastest, so air above the terrain and stone below it compress to a few bytes.

export function rleEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length;) {
    const id = data[i];
    let n = 1;
    while (i + n < data.length && data[i + n] === id) n++;
    i += n;
    for (; n >= 0x80; n >>>= 7) out.push((n & 0x7f) | 0x80);
    out.push(n, id);
  }
  return Uint8Array.from(out);
}

/** Decode one chunk; throws if the data is not exactly one chunk's worth of runs. */
export function rleDecode(rle: Uint8Array): Uint8Array {
  const data = new Uint8Array(CHUNK_VOL);
  let at = 0;
  for (let i = 0; i < rle.length;) {
    let n = 0, shift = 0, b;
    do { b = rle[i++]; n |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80 && shift < 28);
    if (i >= rle.length || at + n > CHUNK_VOL) throw new Error('corrupt chunk data');
    data.fill(rle[i++], at, at + n);
    at += n;
  }
  if (at !== CHUNK_VOL) throw new Error('corrupt chunk data');
  return data;
}
