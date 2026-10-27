// Cheap 3D value noise (trilinear, smoothstep-eased) over a shuffled
// permutation table. Output is in 0..1. Used for brush texture, curl kicks,
// living-stroke flicker and ember twinkle.

import { lerp, smoothstep01 as sm } from './math.js';

/**
 * Build a noise function with its own permutation table.
 * @param {() => number} random  source of randomness, defaults to Math.random
 * @returns {(x: number, y: number, z: number) => number}
 */
export function createNoise3(random = Math.random) {
  const perm = new Uint8Array(512);
  const a = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = a[i & 255];

  const hash = (x, y, z) => perm[(perm[(perm[x & 255] + y) & 255] + z) & 255] / 255;

  return function n3(x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const u = sm(x - X), v = sm(y - Y), w = sm(z - Z);
    return lerp(
      lerp(lerp(hash(X, Y, Z), hash(X + 1, Y, Z), u), lerp(hash(X, Y + 1, Z), hash(X + 1, Y + 1, Z), u), v),
      lerp(lerp(hash(X, Y, Z + 1), hash(X + 1, Y, Z + 1), u), lerp(hash(X, Y + 1, Z + 1), hash(X + 1, Y + 1, Z + 1), u), v),
      w,
    );
  };
}

/** Shared instance; like the prototypes, the table is reshuffled per page load. */
export const n3 = createNoise3();
