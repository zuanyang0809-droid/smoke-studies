// One stable-fluids grid (Stam 1999) with vorticity confinement
// (Fedkiw et al. 2001). Besides velocity and density it advects three
// "look" fields that the toon renderer reads:
//   t  texture  - brush noise carried by the flow (0..1, 0.5 = neutral)
//   A  age      - frames since the smoke left its source
//   cr/cg/cb    - optional per-cell RGB, for strokes of different colors
//
// With `trackBounds` the grid keeps a bounding box of cells that hold smoke
// and only simulates that region (plus a margin). The 2.5D app runs up to 24
// grids at once, so skipping empty cells is what keeps it interactive.

import { lerp } from '../core/math.js';
import { n3 } from '../core/noise.js';

export const GRID_W = 160;
export const GRID_H = 107;

/** Map normalized Style JSON values to this solver's units. */
export function fluidParamsFromStyle(style) {
  return {
    buoyancy: style.motion.rise * 0.008,
    curl: style.motion.curl * 0.4,
    ageDecay: style.motion.dissipation * 0.025,
    agingFrames: style.motion.agingFrames,
  };
}

export class Fluid2D {
  /**
   * @param {object} [o]
   * @param {number} [o.nx]               grid width in cells
   * @param {number} [o.ny]               grid height in cells
   * @param {boolean} [o.color]           also advect per-cell RGB
   * @param {number[]} [o.rgb]            initial RGB for the color field
   * @param {boolean} [o.trackBounds]     simulate only the region with smoke
   * @param {number} [o.pressureIterations] Jacobi iterations per projection
   */
  constructor({ nx = GRID_W, ny = GRID_H, color = false, rgb = [138, 143, 153], trackBounds = false, pressureIterations = 16 } = {}) {
    this.nx = nx;
    this.ny = ny;
    this.n = nx * ny;
    this.trackBounds = trackBounds;
    this.pressureIterations = pressureIterations;
    this.seed = 0; // brush texture offset, re-rolled per stroke
    this.noiseOffset = 0; // decorrelates the curl kick between grids

    const F = () => new Float32Array(this.n);
    this.u = F(); this.v = F(); this.u0 = F(); this.v0 = F();
    this.d = F(); this.d0 = F();
    this.t = F().fill(0.5); this.t0 = F();
    this.A = F(); this.A0 = F();
    this.p = F(); this.div = F(); this.w = F(); this.aw = F();
    this.hasColor = color;
    if (color) {
      this.cr = F().fill(rgb[0]); this.cg = F().fill(rgb[1]); this.cb = F().fill(rgb[2]);
      this.c0 = F();
    }
    /** [i0, i1, j0, j1] of cells with density, or null. Only kept with trackBounds. */
    this.bounds = null;
    this.interior = [1, nx - 2, 1, ny - 2];
  }

  clear() {
    this.u.fill(0); this.v.fill(0); this.d.fill(0); this.t.fill(0.5); this.A.fill(0);
    this.bounds = null;
  }

  /** Fill the color field with one color. */
  recolor(rgb) {
    if (!this.hasColor) return;
    this.cr.fill(rgb[0]); this.cg.fill(rgb[1]); this.cb.fill(rgb[2]);
  }

  /** True when any cell holds visible smoke. */
  hasSmoke() {
    if (this.trackBounds) return this.bounds !== null;
    const d = this.d;
    for (let k = 0; k < this.n; k++) if (d[k] > 0.003) return true;
    return false;
  }

  /** Region the emitters and embers may use: smoke bounds, or the whole interior. */
  activeRegion() {
    return this.trackBounds ? this.bounds : this.interior;
  }

  _growBounds(i0, i1, j0, j1) {
    if (!this.trackBounds || i0 > i1 || j0 > j1) return;
    const b = this.bounds;
    if (!b) {
      this.bounds = [i0, i1, j0, j1];
      return;
    }
    if (i0 < b[0]) b[0] = i0;
    if (i1 > b[1]) b[1] = i1;
    if (j0 < b[2]) b[2] = j0;
    if (j1 > b[3]) b[3] = j1;
  }

  /** Cells covered by a disc of radius R, clipped to the interior. */
  _disc(cx, cy, R) {
    return [
      Math.max(1, Math.floor(cx - R)), Math.min(this.nx - 2, Math.ceil(cx + R)),
      Math.max(1, Math.floor(cy - R)), Math.min(this.ny - 2, Math.ceil(cy + R)),
    ];
  }

  /**
   * Add smoke with a radial falloff and push the velocity toward (vx, vy).
   * Texture and color are density-weighted so new smoke blends with old.
   * @param {number} f      texture noise time
   * @param {number} blend  how strongly the velocity is overwritten
   * @param {number[]} [rgb] smoke color, used when the grid has a color field
   */
  inject(cx, cy, R, amount, vx, vy, f, blend, rgb) {
    const { nx, d, t, A, u, v } = this;
    const R2 = R * R, color = this.hasColor && rgb;
    const [i0, i1, j0, j1] = this._disc(cx, cy, R);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i - cx, dy = j - cy, r2 = dx * dx + dy * dy;
        if (r2 > R2) continue;
        const fall = 1 - Math.sqrt(r2) / R, k = i + j * nx, add = amount * fall;
        const tn = n3(i * 0.4 + this.seed, j * 0.4, f * 0.12);
        const dn = d[k] + add + 1e-6;
        t[k] = (t[k] * d[k] + tn * add) / dn;
        if (color) {
          this.cr[k] = (this.cr[k] * d[k] + rgb[0] * add) / dn;
          this.cg[k] = (this.cg[k] * d[k] + rgb[1] * add) / dn;
          this.cb[k] = (this.cb[k] * d[k] + rgb[2] * add) / dn;
        }
        d[k] += add;
        A[k] = lerp(A[k], 0, fall);
        u[k] = lerp(u[k], vx, fall * blend);
        v[k] = lerp(v[k], vy, fall * blend);
      }
    }
    this._growBounds(i0, i1, j0, j1);
  }

  /**
   * Keep density at least `target` inside a disc. Living strokes call this
   * every frame so the drawn line acts as a persistent source.
   * @param {number} tf  texture value to pull toward
   */
  hold(cx, cy, R, target, vx, vy, tf, rgb) {
    const { nx, d, t, A, u, v } = this;
    const R2 = R * R, color = this.hasColor && rgb;
    const [i0, i1, j0, j1] = this._disc(cx, cy, R);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i - cx, dy = j - cy, r2 = dx * dx + dy * dy;
        if (r2 > R2) continue;
        const fall = 1 - Math.sqrt(r2) / R, k = i + j * nx, val = target * fall;
        if (d[k] < val) {
          t[k] = lerp(t[k], tf, 0.5);
          if (color) {
            const m = d[k] > 0.02 ? 0.5 : 1;
            this.cr[k] = lerp(this.cr[k], rgb[0], m);
            this.cg[k] = lerp(this.cg[k], rgb[1], m);
            this.cb[k] = lerp(this.cb[k], rgb[2], m);
          }
          d[k] = val;
        }
        A[k] = lerp(A[k], 0, fall);
        u[k] = lerp(u[k], vx, fall * 0.12);
        v[k] = lerp(v[k], vy, fall * 0.12);
      }
    }
    this._growBounds(i0, i1, j0, j1);
  }

  /** Bilinear sample of any field at fractional cell coordinates. */
  sample(a, gx, gy) {
    const nx = this.nx;
    if (gx < 0) gx = 0;
    else if (gx > nx - 1.001) gx = nx - 1.001;
    if (gy < 0) gy = 0;
    else if (gy > this.ny - 1.001) gy = this.ny - 1.001;
    const i0 = gx | 0, j0 = gy | 0, x = gx - i0, y = gy - j0, k = i0 + j0 * nx;
    return (1 - x) * ((1 - y) * a[k] + y * a[k + nx]) + x * ((1 - y) * a[k + 1] + y * a[k + nx + 1]);
  }

  /** Semi-Lagrangian advection of `src` into `dst` over region r, time scale f. */
  _advect(dst, src, uu, vv, f, r) {
    const { nx, ny } = this;
    const [i0, i1, j0, j1] = r;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = i + j * nx;
        let x = i - uu[k] * f, y = j - vv[k] * f;
        if (x < 0.5) x = 0.5;
        else if (x > nx - 1.5) x = nx - 1.5;
        if (y < 0.5) y = 0.5;
        else if (y > ny - 1.5) y = ny - 1.5;
        const a0 = x | 0, b0 = y | 0, a = x - a0, b = y - b0, k0 = a0 + b0 * nx;
        dst[k] = (1 - a) * ((1 - b) * src[k0] + b * src[k0 + nx]) + a * ((1 - b) * src[k0 + 1] + b * src[k0 + nx + 1]);
      }
    }
  }

  /** Zero the outer ring of a field (solid walls). */
  _bound(a) {
    const { nx, ny } = this;
    for (let i = 0; i < nx; i++) {
      a[i] = 0;
      a[i + (ny - 1) * nx] = 0;
    }
    for (let j = 0; j < ny; j++) {
      a[j * nx] = 0;
      a[nx - 1 + j * nx] = 0;
    }
  }

  /** Make the velocity field divergence-free (Jacobi pressure solve). */
  _project(r) {
    const { nx, u, v, div, p } = this;
    const [i0, i1, j0, j1] = r;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = i + j * nx;
        div[k] = -0.5 * (u[k + 1] - u[k - 1] + v[k + nx] - v[k - nx]);
        p[k] = 0;
      }
    }
    // Pressure is zero just outside the region.
    for (let j = j0 - 1; j <= j1 + 1; j++) {
      p[i0 - 1 + j * nx] = 0;
      p[i1 + 1 + j * nx] = 0;
    }
    for (let i = i0 - 1; i <= i1 + 1; i++) {
      p[i + (j0 - 1) * nx] = 0;
      p[i + (j1 + 1) * nx] = 0;
    }
    for (let it = 0; it < this.pressureIterations; it++) {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = i + j * nx;
          p[k] = (div[k] + p[k - 1] + p[k + 1] + p[k - nx] + p[k + nx]) * 0.25;
        }
      }
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = i + j * nx;
        u[k] -= 0.5 * (p[k + 1] - p[k - 1]);
        v[k] -= 0.5 * (p[k + nx] - p[k - nx]);
      }
    }
    this._bound(u);
    this._bound(v);
  }

  /** Vorticity confinement: re-inject the small swirls numerical damping removes. */
  _confine(eps, r) {
    const { nx, u, v, w, aw } = this;
    const [i0, i1, j0, j1] = r;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = i + j * nx;
        w[k] = 0.5 * (v[k + 1] - v[k - 1] - (u[k + nx] - u[k - nx]));
        aw[k] = Math.abs(w[k]);
      }
    }
    for (let j = j0 + 1; j < j1; j++) {
      for (let i = i0 + 1; i < i1; i++) {
        const k = i + j * nx;
        let gx = 0.5 * (aw[k + 1] - aw[k - 1]), gy = 0.5 * (aw[k + nx] - aw[k - nx]);
        const l = Math.hypot(gx, gy) + 1e-5;
        gx /= l;
        gy /= l;
        u[k] += eps * gy * w[k];
        v[k] -= eps * gx * w[k];
      }
    }
  }

  /**
   * Advance one frame.
   * @param {ReturnType<typeof fluidParamsFromStyle>} params
   * @param {number} frame  global frame counter (drives the curl noise)
   * @param {number} [f]    time scale; > 1 when the scheduler skipped frames
   */
  step(params, frame, f = 1) {
    if (this.trackBounds && !this.bounds) return;
    const { nx, ny, u, v, d, t, A } = this;
    const { buoyancy, curl, ageDecay, agingFrames } = params;

    let r = this.interior;
    if (this.trackBounds) {
      const b = this.bounds, M = 6;
      r = [Math.max(1, b[0] - M), Math.min(nx - 2, b[1] + M), Math.max(1, b[2] - M), Math.min(ny - 2, b[3] + M)];
    }
    const [i0, i1, j0, j1] = r;

    // Buoyancy: dense smoke rises (grid y points down).
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = i + j * nx;
        if (d[k] > 0.003) v[k] -= buoyancy * f * Math.min(1, d[k] * 8);
      }
    }

    // Low-frequency sideways kick so plumes wander instead of rising straight.
    const tz = frame * 0.008 + this.noiseOffset, kick = 0.035 * (curl / 0.16 + 0.2);
    for (let j = j0; j <= j1; j += 2) {
      for (let i = i0; i <= i1; i += 2) {
        const k = i + j * nx;
        if (d[k] > 0.01) u[k] += (n3(i * 0.09, j * 0.09, tz) - 0.5) * kick;
      }
    }

    this._confine(curl, r);
    this._project(r);
    this.u0.set(u);
    this.v0.set(v);
    this._advect(u, this.u0, this.u0, this.v0, f, r);
    this._advect(v, this.v0, this.u0, this.v0, f, r);
    this._project(r);

    this.d0.set(d); this._advect(d, this.d0, u, v, f, r);
    this.t0.set(t); this._advect(t, this.t0, u, v, f, r);
    this.A0.set(A); this._advect(A, this.A0, u, v, f, r);
    if (this.hasColor) {
      const c0 = this.c0;
      c0.set(this.cr); this._advect(this.cr, c0, u, v, f, r);
      c0.set(this.cg); this._advect(this.cg, c0, u, v, f, r);
      c0.set(this.cb); this._advect(this.cb, c0, u, v, f, r);
    }

    this._decay(r, ageDecay, agingFrames, f);
  }

  /**
   * Age everything, fade old smoke, damp velocity, and fade smoke near the top
   * edge so it does not pile up against the wall. With bounds tracking this
   * also recomputes the bounding box.
   */
  _decay(r, ageDecay, agingFrames, f) {
    const { nx, ny, u, v, d, A } = this;
    const vd = f === 1 ? 0.992 : Math.pow(0.992, f);
    // Without tracking, the whole grid (walls included) ages, as in the 2D prototype.
    const [i0, i1, j0, j1] = this.trackBounds ? r : [0, nx - 1, 0, ny - 1];
    let n0 = nx, n1 = -1, m0 = ny, m1 = -1;
    for (let j = j0; j <= j1; j++) {
      const top = j < 12 ? 0.92 + 0.0066 * j : 1;
      for (let i = i0; i <= i1; i++) {
        const k = i + j * nx;
        A[k] += f;
        const dk = 0.999 * top * (1 - ageDecay * Math.min(1, A[k] / agingFrames));
        d[k] *= f === 1 ? dk : Math.pow(dk, f);
        u[k] *= vd;
        v[k] *= vd;
        if (!this.trackBounds) continue;
        if (d[k] > 0.002) {
          if (i < n0) n0 = i;
          if (i > n1) n1 = i;
          if (j < m0) m0 = j;
          if (j > m1) m1 = j;
        } else if (d[k] < 1e-4) d[k] = 0;
      }
    }
    if (this.trackBounds) this.bounds = n1 < 0 ? null : [n0, n1, m0, m1];
  }
}
