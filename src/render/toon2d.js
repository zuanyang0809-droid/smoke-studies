// CPU toon renderer for a 2D smoke layer.
//
// Per pixel it samples the fluid fields and applies the hand-drawn rules:
//   haze       a soft wash where there is any smoke at all
//   silhouette density (+ texture noise) above a threshold becomes a flat shape
//   bands      occlusion toward the light picks light / mid / shadow
//   age tint   fresh smoke warmer and lighter, old smoke cooler and greyer
//   mottle     texture extremes pick up two hue-rotated side colors
//   AO         darken crevices where density is below its blurred neighborhood
//   ember core glowing veins and red-brown shadows in fresh, dense smoke
//
// Two output modes: opaque over a background color (2D study), or
// transparent with dirty-rect updates so many cards can be composited by the
// browser (2.5D study).

import { lerp } from '../core/math.js';
import { emberStops, hexToRgb, makePalette, mix } from '../core/color.js';
import { emberLook } from '../sim/embers.js';

/**
 * Turn a Style JSON into the values this renderer reads.
 * @param {import('../core/color.js').PaletteCache} [cache]  per-cell palettes
 *   for layers with a color field; kept in sync with the hue shift here
 */
export function toonLookFromStyle(style, cache) {
  const palette = makePalette(style.color.base, style.color.hueShift);
  if (cache) cache.setHueShift(style.color.hueShift);
  const light = style.shading.lightDirection;
  return {
    palette,
    cache,
    background: hexToRgb(style.color.background),
    opacity: style.shading.opacity,
    silhouette: style.shading.silhouetteThreshold,
    shadow: style.shading.shadowThreshold,
    // Offset (in cells) toward the light for the occlusion probe; grid y points down.
    lightX: light[0] * 1.8,
    lightY: -light[1] * 1.8,
    texture: style.texture.amount,
    solidity: style.form.solidity,
    haze: style.layers.haze,
    mottle: style.texture.mottle,
    ageTint: style.layers.ageTint,
    ao: style.layers.ambientOcclusion,
    emberCore: style.layers.emberCore,
    embers: style.embers.enabled,
    emberStops: emberStops(palette, style.embers.matchSmoke),
  };
}

export class ToonRenderer2D {
  /**
   * @param {HTMLCanvasElement} canvas  backing size must be grid size * cellSize
   * @param {object} [o]
   * @param {number} [o.cellSize]       pixels per grid cell
   * @param {boolean} [o.transparent]   write alpha instead of a background
   * @param {boolean} [o.dirtyRects]    only redraw around the smoke (needs bounds tracking)
   */
  constructor(canvas, { cellSize = 3, transparent = false, dirtyRects = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = canvas.width;
    this.height = canvas.height;
    this.cellSize = cellSize;
    this.transparent = transparent;
    this.dirtyRects = dirtyRects;
    this.image = this.ctx.createImageData(this.width, this.height);
    this.prevRect = null;
    this._blur = new WeakMap(); // fluid -> { B, B2 } blurred density buffers
  }

  /** Erase whatever this renderer drew last. */
  clear() {
    if (this.prevRect) {
      this.ctx.clearRect(...this.prevRect);
      this.prevRect = null;
    }
  }

  /** Separable 5x5 box blur of density over a region (drives solidity and AO). */
  _blurDensity(fluid, r) {
    let buf = this._blur.get(fluid);
    if (!buf) {
      buf = { B: new Float32Array(fluid.n), B2: new Float32Array(fluid.n) };
      this._blur.set(fluid, buf);
    }
    const { nx, d } = fluid, { B, B2 } = buf;
    const [i0, i1, j0, j1] = r;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let s = 0, n = 0;
        for (let o = -2; o <= 2; o++) {
          const ii = i + o;
          if (ii >= 0 && ii < nx) {
            s += d[ii + j * nx];
            n++;
          }
        }
        B2[i + j * nx] = s / n;
      }
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let s = 0, n = 0;
        for (let o = -2; o <= 2; o++) {
          const jj = j + o;
          if (jj >= j0 && jj <= j1) {
            s += B2[i + jj * nx];
            n++;
          }
        }
        B[i + j * nx] = s / n;
      }
    }
    return B;
  }

  /**
   * Draw one layer.
   * @param {import('../sim/layer2d.js').SmokeLayer2D} layer
   * @param {ReturnType<typeof toonLookFromStyle>} look
   */
  render(layer, look, frame) {
    const fluid = layer.fluid, CS = this.cellSize, W = this.width, H = this.height;
    const { nx, ny, d, t, A } = fluid;
    const bb = fluid.bounds;

    // Pixel rectangle to redraw and the grid region to blur.
    let x0 = 0, x1 = W - 1, y0 = 0, y1 = H - 1, B;
    const hasDensity = this.dirtyRects ? bb !== null : true;
    if (this.dirtyRects) {
      x0 = W; x1 = -1; y0 = H; y1 = -1;
      if (bb) {
        const m = 5;
        x0 = Math.max(0, (bb[0] - m) * CS);
        x1 = Math.min(W - 1, (bb[1] + m + 1) * CS);
        y0 = Math.max(0, (bb[2] - m) * CS);
        y1 = Math.min(H - 1, (bb[3] + m + 1) * CS);
        B = this._blurDensity(fluid, [Math.max(0, bb[0] - m - 2), Math.min(nx - 1, bb[1] + m + 2), Math.max(0, bb[2] - m - 2), Math.min(ny - 1, bb[3] + m + 2)]);
      }
      if (look.embers) {
        for (const s of layer.embers.list) {
          const ex = (s.x * CS) | 0, ey = (s.y * CS) | 0;
          x0 = Math.min(x0, Math.max(0, ex - 4));
          x1 = Math.max(x1, Math.min(W - 1, ex + 4));
          y0 = Math.min(y0, Math.max(0, ey - 4));
          y1 = Math.max(y1, Math.min(H - 1, ey + 4));
        }
      }
      if (x1 < x0) {
        this.clear();
        return;
      }
    } else {
      B = this._blurDensity(fluid, [0, nx - 1, 0, ny - 1]);
    }

    const D = this.image.data, transparent = this.transparent;
    const pal0 = look.palette, perCell = fluid.hasColor && look.cache;
    const { silhouette: TH, shadow: SH, lightX: LX, lightY: LY, texture: tex, solidity: sol, opacity: ga } = look;
    const bg = look.background;
    // Local copy of Fluid2D.sample: this runs ~10 times per pixel.
    const sample = (a, gx, gy) => {
      if (gx < 0) gx = 0;
      else if (gx > nx - 1.001) gx = nx - 1.001;
      if (gy < 0) gy = 0;
      else if (gy > ny - 1.001) gy = ny - 1.001;
      const i0 = gx | 0, j0 = gy | 0, fx = gx - i0, fy = gy - j0, k = i0 + j0 * nx;
      return (1 - fx) * ((1 - fy) * a[k] + fy * a[k + nx]) + fx * ((1 - fy) * a[k + 1] + fy * a[k + nx + 1]);
    };

    for (let y = y0; y <= y1; y++) {
      const gy = (y + 0.5) / CS - 0.5;
      for (let x = x0; x <= x1; x++) {
        const gx = (x + 0.5) / CS - 0.5, o = (y * W + x) * 4;
        const dd = hasDensity ? sample(d, gx, gy) : 0;
        let r, g, b, al;
        if (transparent) r = g = b = al = 0;
        else {
          r = bg[0]; g = bg[1]; b = bg[2]; al = 1;
        }

        if (dd > 0.003) {
          const bv = sample(B, gx, gy), ds = lerp(dd, Math.max(dd, bv * 1.15), sol);
          const pl = perCell ? look.cache.get(sample(fluid.cr, gx, gy), sample(fluid.cg, gx, gy), sample(fluid.cb, gx, gy)) : pal0;

          if (look.haze) {
            const a = Math.min(0.4, ds * 0.9);
            if (transparent) {
              r = pl.hz[0]; g = pl.hz[1]; b = pl.hz[2]; al = a;
            } else {
              r += (pl.hz[0] - r) * a; g += (pl.hz[1] - g) * a; b += (pl.hz[2] - b) * a;
            }
          }

          const tt = sample(t, gx, gy), vv = ds + (tt - 0.5) * 0.28 * tex;
          if (vv > TH) {
            const occ = lerp(sample(d, gx + LX, gy + LY), sample(B, gx + LX, gy + LY), sol) + (tt - 0.5) * 0.22 * tex;
            const ti = occ < TH * 1.2 ? 0 : occ < SH ? 1 : 2;
            const av = sample(A, gx, gy), an = Math.min(1, av / 120);
            let c = look.ageTint ? mix(pl.young[ti], pl.old[ti], an) : pl.base[ti];
            if (look.mottle && ti > 0) {
              if (tt > 0.64) c = mix(c, pl.mA, 0.42);
              else if (tt < 0.36) c = mix(c, pl.mB, 0.38);
            }
            if (look.ao) {
              const a = Math.min(1, Math.max(0, (bv - dd) * 4)) * 0.6;
              if (a > 0) c = mix(c, pl.ao, a);
            }
            if (look.emberCore && av < 55) {
              const hn = 1 - av / 55;
              if (dd > 0.18 && Math.abs(tt - 0.5) < 0.055 * hn + 0.008) c = mix(pal0.emb, pal0.hot, hn);
              else if (ti === 2) c = mix(c, pal0.edk, 0.65 * hn);
              else if (ti === 1) c = mix(c, pal0.emb, 0.18 * hn);
            }
            if (transparent) {
              // "Over" composite of the shape onto the haze.
              const na = ga + al * (1 - ga);
              r = (c[0] * ga + r * al * (1 - ga)) / na;
              g = (c[1] * ga + g * al * (1 - ga)) / na;
              b = (c[2] * ga + b * al * (1 - ga)) / na;
              al = na;
            } else {
              r += (c[0] - r) * ga; g += (c[1] - g) * ga; b += (c[2] - b) * ga;
            }
          }
        }
        D[o] = r; D[o + 1] = g; D[o + 2] = b; D[o + 3] = al * 255;
      }
    }

    if (look.embers) this._drawEmbers(layer.embers.list, look, frame);

    if (this.dirtyRects) {
      this.clear();
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      this.ctx.putImageData(this.image, 0, 0, x0, y0, w, h);
      this.prevRect = [x0, y0, w, h];
    } else {
      this.ctx.putImageData(this.image, 0, 0);
    }
  }

  /** Embers are small pixel diamonds with a brighter center. */
  _drawEmbers(list, look, frame) {
    const D = this.image.data, W = this.width, H = this.height, CS = this.cellSize, stops = look.emberStops;
    const plot = (X, Y, c) => {
      X = Math.round(X);
      Y = Math.round(Y);
      if (X < 0 || Y < 0 || X >= W || Y >= H) return;
      const o = (Y * W + X) * 4;
      D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2]; D[o + 3] = 255;
    };
    for (const s of list) {
      const { scale, color } = emberLook(s, frame, stops);
      const r = Math.round((s.sz - 1) * scale + (scale > 0.35 ? 0 : -1));
      if (r < 0) continue;
      const core = mix(color, stops[0], 0.65), hx = s.x * CS, hy = s.y * CS;
      for (let yy = -r; yy <= r; yy++) {
        for (let xx = -r; xx <= r; xx++) {
          if (Math.abs(xx) + Math.abs(yy) > r) continue;
          plot(hx + xx, hy + yy, xx === 0 && yy === 0 && r > 0 ? core : color);
        }
      }
    }
  }
}
