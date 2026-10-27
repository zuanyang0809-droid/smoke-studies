// Stylized ray march of the fluid (fluid-common.glsl is prepended).
// Translucent density accumulates front to back (Beer-Lambert). The light,
// texture and age seen along the ray are then quantized into the same three
// hue-shifted bands as the 2D study, and the opacity is posterized into
// three levels (thin rim, translucent body, dense core), so the smoke stays
// layered and see-through instead of turning into one surface.
in vec3 vWorld;
uniform vec3 cameraPosition;
uniform sampler2D uShade; // density, light, ambient, texture
uniform sampler2D uAge;   // frozen scalars, age in a
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform float uVoxel;
uniform float uSigma;
uniform float uLightHi;
uniform float uLightLo;
uniform vec3 yc[3];
uniform vec3 oc[3];
uniform vec3 bc[3];
uniform vec3 mA, mB, hz, aoc, emb, hot, edk;
uniform float tex, fHaze, fMot, fAge, fAO, fEmb, TH, ga;

vec3 pick(vec3 a, vec3 b, vec3 c, int i) {
  return i == 0 ? a : (i == 1 ? b : c);
}

void main() {
  vec3 ro = cameraPosition, rd = normalize(vWorld - ro);
  vec3 inv = 1.0 / rd, t0 = (uBoxMin - ro) * inv, t1 = (uBoxMin + uBoxSize - ro) * inv;
  vec3 near = min(t0, t1), far = max(t0, t1);
  float tn = max(max(near.x, near.y), max(near.z, 0.0)), tf = min(min(far.x, far.y), far.z);
  if (tf <= tn) discard;

  float T = 1.0, wsum = 0.0, Ls = 0.0, As = 0.0, Ts = 0.0, Gs = 0.0, dmax = 0.0;
  for (int i = 0; i < 160; i++) {
    float t = tn + (float(i) + 0.5) * uVoxel;
    if (t > tf || T < 0.03) break;
    vec3 p = (ro + rd * t - uBoxMin) / uVoxel;
    vec4 s = sample3(uShade, p);
    if (s.x < 0.0005) continue;
    float al = 1.0 - exp(-s.x * uSigma);
    float w = T * al;
    wsum += w;
    Ls += w * s.y;
    As += w * s.z;
    Ts += w * s.w;
    Gs += w * sample3(uAge, p).w;
    dmax = max(dmax, s.x);
    T *= 1.0 - al;
  }
  if (wsum < 1e-4) discard;
  float L = Ls / wsum, amb = As / wsum, tt = Ts / wsum, age = Gs / wsum;
  float ha = fHaze * min(0.4, (1.0 - T) * 0.9);
  // Wispy edges: the brush texture carried by the flow moves the opacity
  // steps, like the silhouette rule of the 2D study.
  float A = 1.0 - T + (tt - 0.5) * 0.5 * tex;

  int level = A < TH ? 0 : A < 0.5 ? 1 : A < 0.85 ? 2 : 3;
  if (level == 0) {
    if (ha < 0.004) discard;
    outColor = vec4(hz, ha);
    return;
  }
  float alpha = ga * (level == 1 ? 0.45 : level == 2 ? 0.75 : 1.0);

  float lt = L + (tt - 0.5) * 0.22 * tex;
  int ti = lt > uLightHi ? 0 : (lt > uLightLo ? 1 : 2);
  float an = min(1.0, age / 120.0);
  vec3 c = fAge > 0.5
    ? mix(pick(yc[0], yc[1], yc[2], ti), pick(oc[0], oc[1], oc[2], ti), an)
    : pick(bc[0], bc[1], bc[2], ti);
  if (fMot > 0.5 && ti > 0) {
    if (tt > 0.64) c = mix(c, mA, 0.42);
    else if (tt < 0.36) c = mix(c, mB, 0.38);
  }
  if (fAO > 0.5) c = mix(c, aoc, clamp((0.8 - amb) * 1.5, 0.0, 1.0) * 0.6);
  if (fEmb > 0.5 && age < 55.0) {
    float hn = 1.0 - age / 55.0;
    if (dmax > 0.25 && abs(tt - 0.5) < 0.055 * hn + 0.008) c = mix(emb, hot, hn);
    else if (ti == 2) c = mix(c, edk, 0.65 * hn);
    else if (ti == 1) c = mix(c, emb, 0.18 * hn);
  }
  // Rim light: the thin outer layer on the lit side glows a little.
  if (level == 1 && ti == 0) c = mix(c, vec3(1.0), 0.18);

  outColor = vec4(mix(hz, c, alpha / max(alpha, ha + 0.001)), max(alpha, ha));
}
