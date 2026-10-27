// Color conversions and the hue-shift toon palette.
//
// All RGB triples are 0..255 floats unless a function says otherwise.
// The palette is the heart of the look: one base color becomes three tone
// bands (light / mid / shadow) whose hue rotates warm in the light and cool
// in the shadow, plus young/old variants for age tint and side colors for
// mottle, haze and ambient occlusion.

import { clamp } from './math.js';

export function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')).join('');
}

/** Hue in degrees from normalized RGB plus its max / min channel. */
function hueOf(r, g, b, mx, mn) {
  if (mx === mn) return 0;
  const d = mx - mn;
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

/** @returns {[number, number, number]} [hue deg, saturation 0..1, lightness 0..1] */
export function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  }
  return [hueOf(r, g, b, mx, mn), s, l];
}

/** @returns {[number, number, number]} [hue deg, saturation 0..1, value 0..1] */
export function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return [hueOf(r, g, b, mx, mn), mx ? (mx - mn) / mx : 0, mx];
}

export function hsvToRgb(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}

/** HSL to RGB 0..255. Hue wraps; saturation and lightness are clamped. */
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Linear mix of two RGB triples. */
export function mix(a, b, q) {
  return [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q, a[2] + (b[2] - a[2]) * q];
}

/**
 * Build the toon palette for one base color.
 * Band index 0 = light, 1 = mid, 2 = shadow.
 * @param {string} hex       base color, '#rrggbb'
 * @param {number} hueShift  degrees; lights rotate +hueShift, shadows -1.3 * hueShift
 */
export function makePalette(hex, hueShift) {
  const [h, s, l] = hexToHsl(hex);
  const L = [Math.max(l + 0.26, 0.62), l, l * 0.45];
  const HU = [h + hueShift, h, h - hueShift * 1.3];
  // Shadows get a minimum saturation so grey smoke still has tinted shadows.
  const S = [s * 0.75, s, Math.max(s * 0.9, hueShift / 90)];

  const base = L.map((x, i) => hslToRgb(HU[i], S[i], x));
  const young = L.map((x, i) => hslToRgb(HU[i] + 20, Math.max(S[i] * 1.1, 0.25), Math.min(0.93, x + 0.08)));
  const old = L.map((x, i) => hslToRgb(HU[i] - 25, S[i] * 0.6, x - 0.05));

  return {
    base,
    young,
    old,
    mA: hslToRgb(h + 38, s * 0.95, l * 0.95), // mottle side color A
    mB: hslToRgb(h - 48, s * 0.85, l * 0.8), // mottle side color B
    hz: hslToRgb(h, s * 0.55, l * 0.7), // haze
    ao: hslToRgb(h - hueShift * 1.5, Math.max(s * 0.7, hueShift / 80), l * 0.25),
    emb: hslToRgb(38, 1, 0.6), // ember orange
    hot: hslToRgb(52, 1, 0.85), // ember hot core
    edk: hslToRgb(6, 0.75, 0.3), // ember dark red
  };
}

/** Three color stops an ember fades through (hot -> warm -> dark). */
export function emberStops(pal, matchSmoke) {
  return matchSmoke ? [pal.young[0], pal.base[1], pal.base[2]] : [pal.hot, pal.emb, pal.edk];
}

/** Copy of a palette with every color scaled to 0..1, for GPU uniforms. */
export function paletteToUnit(pal) {
  const u = (c) => c.map((x) => x / 255);
  const out = {};
  for (const k in pal) out[k] = Array.isArray(pal[k][0]) ? pal[k].map(u) : u(pal[k]);
  return out;
}

// Palette cache for per-cell colors. Advected color is quantized to 32 levels
// per channel (32^3 possible palettes) so a frame needs only a handful of
// makePalette calls instead of one per pixel.
const Q = 8.23;

export function quantizeKey(r, g, b) {
  const qr = Math.min(31, (r / Q) | 0), qg = Math.min(31, (g / Q) | 0), qb = Math.min(31, (b / Q) | 0);
  return (qr << 10) | (qg << 5) | qb;
}

export class PaletteCache {
  constructor(hueShift = 20) {
    this.hueShift = hueShift;
    this.map = new Map();
  }

  /** Palettes depend on hue shift, so changing it drops every cached entry. */
  setHueShift(hueShift) {
    if (hueShift !== this.hueShift) {
      this.hueShift = hueShift;
      this.map.clear();
    }
  }

  get(r, g, b) {
    const key = quantizeKey(r, g, b);
    let pal = this.map.get(key);
    if (!pal) {
      const qr = key >> 10, qg = (key >> 5) & 31, qb = key & 31;
      pal = makePalette(rgbToHex([qr * Q + 4, qg * Q + 4, qb * Q + 4]), this.hueShift);
      this.map.set(key, pal);
    }
    return pal;
  }

  get size() {
    return this.map.size;
  }
}
