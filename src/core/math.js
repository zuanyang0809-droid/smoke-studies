// Small numeric helpers shared by the simulation and renderers.

export const lerp = (a, b, q) => a + (b - a) * q;

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

export const smoothstep01 = (q) => q * q * (3 - 2 * q);
