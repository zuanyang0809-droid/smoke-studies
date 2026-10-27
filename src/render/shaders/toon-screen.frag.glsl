// Screen-space toon shading: a GLSL port of the 2D CPU rules.
// The density grid D is built on the CPU each frame by splatting particles
// into screen space:  r = density, g = texture, b = age, a = blurred density.
precision highp float;

uniform sampler2D D;
uniform vec2 tx;  // one grid cell in uv
uniform vec2 L2;  // light direction in screen space
uniform vec3 yc[3];
uniform vec3 oc[3];
uniform vec3 bc[3];
uniform vec3 mA, mB, hz, aoc, emb, hot, edk;
uniform float tex, fHaze, fMot, fAge, fAO, fEmb, TH, SH, sol, ga;
varying vec2 vUv;

vec3 pick(vec3 a, vec3 b, vec3 c, int i) {
  return i == 0 ? a : (i == 1 ? b : c);
}

void main() {
  vec4 s = texture2D(D, vUv);
  float dd = s.r * 1.5;
  if (dd < 0.003) discard;

  float bv = s.a * 1.5;
  float ds = mix(dd, max(dd, bv * 1.15), sol);
  float tt = s.g;
  float ha = fHaze * min(0.4, ds * 0.9);
  float vv = ds + (tt - 0.5) * 0.28 * tex;

  // Below the silhouette threshold only haze is drawn.
  if (vv <= TH) {
    if (ha < 0.004) discard;
    gl_FragColor = vec4(hz, ha);
    return;
  }

  // Occlusion: density a few cells toward the light picks the band.
  vec4 o = texture2D(D, vUv + L2 * tx * 1.8);
  float occ = mix(o.r, o.a, sol) * 1.5 + (tt - 0.5) * 0.22 * tex;
  int ti = occ < TH * 1.2 ? 0 : (occ < SH ? 1 : 2);
  float ageF = s.b * 255.0;
  float an = min(1.0, ageF / 120.0);

  vec3 c = fAge > 0.5
    ? mix(pick(yc[0], yc[1], yc[2], ti), pick(oc[0], oc[1], oc[2], ti), an)
    : pick(bc[0], bc[1], bc[2], ti);

  if (fMot > 0.5 && ti > 0) {
    if (tt > 0.64) c = mix(c, mA, 0.42);
    else if (tt < 0.36) c = mix(c, mB, 0.38);
  }
  if (fAO > 0.5) c = mix(c, aoc, clamp((bv - dd) * 4.0, 0.0, 1.0) * 0.6);
  if (fEmb > 0.5 && ageF < 55.0) {
    float hn = 1.0 - ageF / 55.0;
    if (dd > 0.18 && abs(tt - 0.5) < 0.055 * hn + 0.008) c = mix(emb, hot, hn);
    else if (ti == 2) c = mix(c, edk, 0.65 * hn);
    else if (ti == 1) c = mix(c, emb, 0.18 * hn);
  }

  gl_FragColor = vec4(mix(hz, c, ga / max(ga, ha + 0.001)), max(ga, ha));
}
