import { describe, expect, it } from 'vitest';
import {
  emberStops,
  hexToHsl,
  hexToHsv,
  hexToRgb,
  hslToRgb,
  hsvToRgb,
  makePalette,
  mix,
  PaletteCache,
  paletteToUnit,
  quantizeKey,
  rgbToHex,
} from '../src/core/color.js';

const close = (a, b, eps = 1e-6) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 6 - Math.log10(eps * 1e6)));

describe('hex / rgb', () => {
  it('parses and formats hex colors', () => {
    expect(hexToRgb('#62905f')).toEqual([98, 144, 95]);
    expect(rgbToHex([98, 144, 95])).toBe('#62905f');
  });

  it('rounds and clamps when formatting', () => {
    expect(rgbToHex([-20, 127.6, 300])).toBe('#0080ff');
  });

  it('round-trips every swatch', () => {
    for (const hex of ['#8a8f99', '#d8d4cc', '#1f1d24', '#c4467f', '#e8c060', '#7fd0d8']) {
      expect(rgbToHex(hexToRgb(hex))).toBe(hex);
    }
  });
});

describe('hsl / hsv', () => {
  it('converts primaries to hsl', () => {
    close(hexToHsl('#ff0000'), [0, 1, 0.5]);
    close(hexToHsl('#00ff00'), [120, 1, 0.5]);
    close(hexToHsl('#0000ff'), [240, 1, 0.5]);
  });

  it('treats greys as hue 0, saturation 0', () => {
    close(hexToHsl('#808080'), [0, 0, 128 / 255]);
    close(hexToHsv('#808080'), [0, 0, 128 / 255]);
  });

  it('hslToRgb inverts hexToHsl', () => {
    for (const hex of ['#62905f', '#8b5cc7', '#cfbc9c', '#c03a3a']) {
      expect(rgbToHex(hslToRgb(...hexToHsl(hex)))).toBe(hex);
    }
  });

  it('hslToRgb wraps hue and clamps saturation / lightness', () => {
    close(hslToRgb(360 + 120, 1, 0.5), [0, 255, 0]);
    close(hslToRgb(-240, 2, 0.5), [0, 255, 0]);
    close(hslToRgb(0, 0, 3), [255, 255, 255]);
  });

  it('hsvToRgb inverts hexToHsv', () => {
    for (const hex of ['#5b8fd1', '#e88fb6', '#46424f']) {
      expect(rgbToHex(hsvToRgb(...hexToHsv(hex)))).toBe(hex);
    }
  });
});

describe('mix', () => {
  it('interpolates channels linearly', () => {
    expect(mix([0, 100, 200], [100, 100, 0], 0.25)).toEqual([25, 100, 150]);
  });
});

describe('makePalette', () => {
  const pal = makePalette('#62905f', 20);

  it('has three bands per tone set', () => {
    for (const k of ['base', 'young', 'old']) {
      expect(pal[k]).toHaveLength(3);
      pal[k].forEach((c) => expect(c).toHaveLength(3));
    }
  });

  it('keeps the mid band equal to the base color', () => {
    expect(rgbToHex(pal.base[1])).toBe('#62905f');
  });

  it('orders bands light > mid > shadow in lightness', () => {
    const l = pal.base.map((c) => hexToHsl(rgbToHex(c))[2]);
    expect(l[0]).toBeGreaterThan(l[1]);
    expect(l[1]).toBeGreaterThan(l[2]);
  });

  it('rotates light hue by +shift and shadow hue by -1.3 * shift', () => {
    const [h] = hexToHsl('#62905f');
    const hl = hexToHsl(rgbToHex(pal.base[0]))[0];
    const hs = hexToHsl(rgbToHex(pal.base[2]))[0];
    expect(hl).toBeCloseTo(h + 20, -0.5);
    expect(hs).toBeCloseTo(h - 26, -0.5);
  });

  it('gives grey smoke tinted shadows when hue shift is on', () => {
    const grey = makePalette('#808080', 20);
    expect(hexToHsl(rgbToHex(grey.base[2]))[1]).toBeGreaterThan(0.1);
    const flat = makePalette('#808080', 0);
    expect(hexToHsl(rgbToHex(flat.base[2]))[1]).toBeCloseTo(0, 2);
  });

  it('uses fixed ember colors independent of the base', () => {
    const other = makePalette('#5b8fd1', 32);
    expect(other.emb).toEqual(pal.emb);
    expect(other.hot).toEqual(pal.hot);
  });
});

describe('emberStops', () => {
  const pal = makePalette('#8b5cc7', 20);
  it('uses hot / orange / dark red by default', () => {
    expect(emberStops(pal, false)).toEqual([pal.hot, pal.emb, pal.edk]);
  });
  it('uses smoke colors when matching smoke', () => {
    expect(emberStops(pal, true)).toEqual([pal.young[0], pal.base[1], pal.base[2]]);
  });
});

describe('paletteToUnit', () => {
  it('scales every color to 0..1 without touching the source', () => {
    const pal = makePalette('#d9772e', 20);
    const u = paletteToUnit(pal);
    expect(u.base[1][0]).toBeCloseTo(pal.base[1][0] / 255);
    expect(u.hz[2]).toBeCloseTo(pal.hz[2] / 255);
    expect(pal.base[1][0]).toBeGreaterThan(1);
  });
});

describe('PaletteCache', () => {
  it('quantizes to 32 levels per channel', () => {
    expect(quantizeKey(0, 0, 0)).toBe(0);
    expect(quantizeKey(255, 255, 255)).toBe((30 << 10) | (30 << 5) | 30); // 255 / 8.23 < 31
    expect(quantizeKey(10, 10, 10)).toBe(quantizeKey(12, 14, 15));
  });

  it('reuses palettes for nearby colors', () => {
    const cache = new PaletteCache(20);
    const a = cache.get(98, 144, 95);
    const b = cache.get(97, 145, 96);
    expect(b).toBe(a);
    expect(cache.size).toBe(1);
  });

  it('matches makePalette for the quantized color', () => {
    const cache = new PaletteCache(20);
    const pal = cache.get(98, 144, 95);
    const q = (x) => Math.min(31, (x / 8.23) | 0) * 8.23 + 4;
    expect(pal).toEqual(makePalette(rgbToHex([q(98), q(144), q(95)]), 20));
  });

  it('clears when hue shift changes', () => {
    const cache = new PaletteCache(20);
    const a = cache.get(98, 144, 95);
    cache.setHueShift(20);
    expect(cache.get(98, 144, 95)).toBe(a);
    cache.setHueShift(32);
    expect(cache.size).toBe(0);
    expect(cache.get(98, 144, 95)).not.toBe(a);
  });
});
