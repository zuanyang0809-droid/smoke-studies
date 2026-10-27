#version 300 es
// Toon shading of one smoke card: a GLSL port of render/toon2d.js, which
// stays the CPU reference (the parity tests check it against the prototypes).
//   F  fields per grid cell: r density, g texture, b age, a blurred density
//   C  per-cell RGB (2.5D cards); the 2D study passes uBase instead
// The palette (makePalette in core/color.js) is rebuilt per pixel from the
// cell color, quantized like PaletteCache. Output is premultiplied alpha.
precision highp float;

uniform sampler2D F;
uniform sampler2D C;
uniform bool uPerCell;
uniform vec3 uBase;     // 0..255
uniform float uHueShift;
uniform vec2 uLight;    // occlusion probe offset in uv
uniform float TH, SH, tex, sol, ga;
uniform bool fHaze, fMot, fAge, fAO, fEmb;
in vec2 vUv;
out vec4 outColor;

vec3 rgbToHsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), l = (mx + mn) * 0.5;
  if (mx == mn) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h = mx == c.r ? (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0) : mx == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0;
  return vec3(h * 60.0, s, l);
}

// 0..1 RGB; hue wraps, saturation and lightness clamp (as hslToRgb).
vec3 hsl(float h, float s, float l) {
  h = mod(mod(h, 360.0) + 360.0, 360.0);
  s = clamp(s, 0.0, 1.0);
  l = clamp(l, 0.0, 1.0);
  float c = (1.0 - abs(2.0 * l - 1.0)) * s, hp = h / 60.0;
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 rgb = hp < 1.0 ? vec3(c, x, 0) : hp < 2.0 ? vec3(x, c, 0) : hp < 3.0 ? vec3(0, c, x)
    : hp < 4.0 ? vec3(0, x, c) : hp < 5.0 ? vec3(x, 0, c) : vec3(c, 0, x);
  return rgb + (l - c * 0.5);
}

void main() {
  vec4 s = texture(F, vUv);
  float dd = s.r;
  if (dd <= 0.003) discard;

  // Palette inputs for this pixel.
  vec3 rgb = uBase;
  if (uPerCell) rgb = min(vec3(31.0), floor(texture(C, vUv).rgb * 255.0 / 8.23)) * 8.23 + 4.0;
  vec3 b = rgbToHsl(rgb / 255.0);
  float h = b.x, sat = b.y, lig = b.z, hs = uHueShift;

  float bv = s.a, ds = mix(dd, max(dd, bv * 1.15), sol);
  vec3 col = vec3(0.0);
  float al = 0.0;
  if (fHaze) {
    col = hsl(h, sat * 0.55, lig * 0.7);
    al = min(0.4, ds * 0.9);
  }

  float tt = s.g, vv = ds + (tt - 0.5) * 0.28 * tex;
  if (vv > TH) {
    vec4 o = texture(F, vUv + uLight);
    float occ = mix(o.r, o.a, sol) + (tt - 0.5) * 0.22 * tex;
    int ti = occ < TH * 1.2 ? 0 : occ < SH ? 1 : 2;
    float L = ti == 0 ? max(lig + 0.26, 0.62) : ti == 1 ? lig : lig * 0.45;
    float HU = ti == 0 ? h + hs : ti == 1 ? h : h - hs * 1.3;
    float S = ti == 0 ? sat * 0.75 : ti == 1 ? sat : max(sat * 0.9, hs / 90.0);

    float av = s.b, an = min(1.0, av / 120.0);
    vec3 c = fAge
      ? mix(hsl(HU + 20.0, max(S * 1.1, 0.25), min(0.93, L + 0.08)), hsl(HU - 25.0, S * 0.6, L - 0.05), an)
      : hsl(HU, S, L);
    if (fMot && ti > 0) {
      if (tt > 0.64) c = mix(c, hsl(h + 38.0, sat * 0.95, lig * 0.95), 0.42);
      else if (tt < 0.36) c = mix(c, hsl(h - 48.0, sat * 0.85, lig * 0.8), 0.38);
    }
    if (fAO) c = mix(c, hsl(h - hs * 1.5, max(sat * 0.7, hs / 80.0), lig * 0.25), clamp((bv - dd) * 4.0, 0.0, 1.0) * 0.6);
    if (fEmb && av < 55.0) {
      float hn = 1.0 - av / 55.0;
      vec3 emb = hsl(38.0, 1.0, 0.6), hot = hsl(52.0, 1.0, 0.85), edk = hsl(6.0, 0.75, 0.3);
      if (dd > 0.18 && abs(tt - 0.5) < 0.055 * hn + 0.008) c = mix(emb, hot, hn);
      else if (ti == 2) c = mix(c, edk, 0.65 * hn);
      else if (ti == 1) c = mix(c, emb, 0.18 * hn);
    }
    // "Over" composite of the shape onto the haze.
    float na = ga + al * (1.0 - ga);
    col = (c * ga + col * al * (1.0 - ga)) / na;
    al = na;
  }
  if (al <= 0.0) discard;
  outColor = vec4(col * al, al);
}
