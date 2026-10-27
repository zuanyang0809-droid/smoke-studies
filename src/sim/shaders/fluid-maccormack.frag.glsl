// MacCormack correction (Selle et al. 2008), clamped to the values around
// the back-traced point, then sources, aging, dissipation and cooling.
// Channels: density, temperature, brush texture, age (frames).
uniform sampler2D uVel;
uniform sampler2D uPhi;  // before advection
uniform sampler2D uFwd;  // advected
uniform sampler2D uBwd;  // advected back again
uniform sampler2D uSrcS;
uniform float uAgeDecay;
uniform float uAgingFrames;
uniform float uCool;

void main() {
  ivec3 v = voxelAt(gl_FragCoord.xy);
  vec3 p = vec3(v) + 0.5;
  vec4 phi = fetch(uFwd, v) + 0.5 * (fetch(uPhi, v) - fetch(uBwd, v));

  vec3 b = clamp(p - fetch(uVel, v).xyz, vec3(0.5), uN - 0.5) - 0.5;
  ivec3 i0 = ivec3(floor(b));
  vec4 lo = vec4(1e9), hi = vec4(-1e9);
  for (int k = 0; k < 8; k++) {
    vec4 c = fetch(uPhi, i0 + ivec3(k & 1, (k >> 1) & 1, k >> 2));
    lo = min(lo, c);
    hi = max(hi, c);
  }
  phi = clamp(phi, lo, hi);

  // Sources: texture blends by density, as in the 2D inject.
  vec4 src = fetch(uSrcS, v);
  float dn = phi.x + src.x;
  if (dn > 1e-5) phi.z = (phi.z * phi.x + src.z) / dn;
  phi.x = dn;
  phi.y += src.y;
  phi.w = min(1000.0, phi.w * max(0.0, 1.0 - src.w) + 1.0);

  phi.x *= 0.999 * (1.0 - uAgeDecay * min(1.0, phi.w / uAgingFrames));
  phi.y *= uCool;
  // Open boundary: smoke fades as it reaches a face of the box, and more
  // gently over the top 12 voxels (as Fluid2D does), so nothing piles up there.
  vec3 e = min(p, uN - p);
  phi.x *= mix(0.8, 1.0, clamp((min(e.x, min(e.y, e.z)) - 0.5) / 3.0, 0.0, 1.0));
  float fromTop = uN.y - p.y;
  if (fromTop < 12.0) phi.x *= 0.92 + 0.0066 * fromTop;
  if (phi.x < 1e-4) phi.xy = vec2(0.0);
  outColor = phi;
}
