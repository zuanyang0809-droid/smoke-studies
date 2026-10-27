// Ray-marched toon volume. March until the first sample above the
// silhouette threshold ("hit"), then shade that point once with the same
// band / age / mottle / AO / ember rules as the 2D renderer. Haze
// accumulates along the way.
// The 3D texture holds  r = density, g = texture, b = age.
precision highp float;
precision highp sampler3D;

uniform sampler3D vol;
uniform vec3 cam, bmin, bsize, L;
uniform vec3 yc[3];
uniform vec3 oc[3];
uniform vec3 bc[3];
uniform vec3 mA, mB, hz, aoc, emb, hot, edk;
uniform float tex, fHaze, fMot, fAge, fAO, fEmb, TH, SH, vs, dtS;
varying vec3 vW;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec4 S(vec3 p) {
  return texture(vol, (p - bmin) / bsize);
}

vec3 pick(vec3 a, vec3 b, vec3 c, int i) {
  return i == 0 ? a : (i == 1 ? b : c);
}

void main() {
  // Ray / box intersection.
  vec3 rd = normalize(vW - cam), inv = 1.0 / rd;
  vec3 t0 = (bmin - cam) * inv, t1 = (bmin + bsize - cam) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
  if (a > b) discard;
  a = max(a, 0.0);

  float dt = dtS, jit = hash(gl_FragCoord.xy) * dt, haze = 0.0;
  bool hit = false;
  vec3 hp;
  vec4 hsx;
  for (int i = 0; i < 340; i++) {
    float tt = a + jit + float(i) * dt;
    if (tt > b) break;
    vec3 p = cam + rd * tt;
    vec4 s = S(p);
    float dd = s.r * 1.5;
    haze += dd * dt * 3.0;
    float v = dd + (s.g - 0.5) * 0.28 * tex;
    if (v > TH) {
      hit = true;
      hp = p;
      hsx = s;
      break;
    }
  }

  float ha = fHaze * min(0.45, haze);
  if (!hit) {
    if (ha < 0.004) discard;
    gl_FragColor = vec4(hz, ha);
    return;
  }

  float dd = hsx.r * 1.5, tt = hsx.g, ageF = hsx.b * 255.0;
  float occ = 0.0;
  for (int k = 1; k <= 6; k++) occ += S(hp + L * vs * 1.5 * float(k)).r;
  occ = occ * 0.95 + (tt - 0.5) * 0.22 * tex;
  int ti = occ < TH * 1.2 ? 0 : (occ < SH ? 1 : 2);
  float an = min(1.0, ageF / 120.0);

  vec3 c = fAge > 0.5
    ? mix(pick(yc[0], yc[1], yc[2], ti), pick(oc[0], oc[1], oc[2], ti), an)
    : pick(bc[0], bc[1], bc[2], ti);

  if (fMot > 0.5 && ti > 0) {
    if (tt > 0.64) c = mix(c, mA, 0.42);
    else if (tt < 0.36) c = mix(c, mB, 0.38);
  }
  if (fAO > 0.5) {
    float r = vs * 2.5;
    float av = (S(hp + vec3(r, 0, 0)).r + S(hp - vec3(r, 0, 0)).r
              + S(hp + vec3(0, r, 0)).r + S(hp - vec3(0, r, 0)).r
              + S(hp + vec3(0, 0, r)).r + S(hp - vec3(0, 0, r)).r) * 0.25;
    c = mix(c, aoc, clamp((av - dd) * 4.0, 0.0, 1.0) * 0.6);
  }
  if (fEmb > 0.5 && ageF < 55.0) {
    float hn = 1.0 - ageF / 55.0;
    if (dd > 0.18 && abs(tt - 0.5) < 0.055 * hn + 0.008) c = mix(emb, hot, hn);
    else if (ti == 2) c = mix(c, edk, 0.65 * hn);
    else if (ti == 1) c = mix(c, emb, 0.18 * hn);
  }

  gl_FragColor = vec4(mix(c, hz, ha * 0.5), 1.0);
}
