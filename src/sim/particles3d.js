// Unbounded 3D smoke as particles. There is no grid to solve: each particle
// follows a curl-noise velocity field (Bridson et al. 2007), which is
// divergence-free by construction, plus buoyancy and short-lived impulses
// left by fast brush strokes. Renderers turn the particles back into a
// density field (screen-space splat or a fitted voxel volume).

import { lerp } from '../core/math.js';
import { n3 } from '../core/noise.js';

/** World size of one "cell"; brush sizes are given in cells, like the 2D grid. */
export const CELL = 0.0225;
const NOISE_FREQ = 0.11 / (2 * CELL);

/** Map normalized Style JSON values to particle units. */
export function particleParamsFromStyle(style) {
  return {
    curlGain: style.motion.curl * 8 * CELL,
    rise: style.motion.rise * 0.26 * CELL,
    ageDecay: style.motion.dissipation * 0.04,
    agingFrames: style.motion.agingFrames || 80,
  };
}

export class Particles3D {
  constructor(max = 90000) {
    this.max = max;
    this.cell = CELL;
    const F = () => new Float32Array(max);
    // Position, texture value, age, weight, cached velocity.
    this.px = F(); this.py = F(); this.pz = F();
    this.pt = F(); this.pa = F(); this.pw = F();
    this.qx = F(); this.qy = F(); this.qz = F();
    this.count = 0;
    this.frame = 0;
    this.seed = 0;
    this.impulses = [];
    this.params = null;
  }

  clear() {
    this.count = 0;
    this.impulses = [];
  }

  /** Velocity at a point: curl of three offset noise potentials + rise + impulses. */
  flow(x, y, z, o) {
    const T = this.frame * 0.004, X = x * NOISE_FREQ, Y = y * NOISE_FREQ, Z = z * NOISE_FREQ, h = 0.055;
    const { curlGain: g, rise } = this.params;
    const p1 = (a, b, e) => n3(a + T, b, e);
    const p2 = (a, b, e) => n3(a + 31.4, b + T, e + 7.1);
    const p3 = (a, b, e) => n3(a + 11.7, b + 3.3, e + T + 19.9);
    let vx = (p3(X, Y + h, Z) - p3(X, Y - h, Z) - (p2(X, Y, Z + h) - p2(X, Y, Z - h))) * g;
    let vy = (p1(X, Y, Z + h) - p1(X, Y, Z - h) - (p3(X + h, Y, Z) - p3(X - h, Y, Z))) * g + rise;
    let vz = (p2(X + h, Y, Z) - p2(X - h, Y, Z) - (p1(X, Y + h, Z) - p1(X, Y - h, Z))) * g;
    for (const m of this.impulses) {
      const dx = x - m.x, dy = y - m.y, dz = z - m.z, r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < m.r * m.r) {
        const f = (1 - Math.sqrt(r2) / m.r) * m.s;
        vx += m.vx * f;
        vy += m.vy * f;
        vz += m.vz * f;
      }
    }
    o[0] = vx;
    o[1] = vy;
    o[2] = vz;
  }

  /** One particle at a random point in a sphere of radius R. */
  spawn(cx, cy, cz, R, tex) {
    if (this.count >= this.max) return;
    let x, y, z;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
    } while (x * x + y * y + z * z > 1);
    x = cx + x * R;
    y = cy + y * R;
    z = cz + z * R;
    const nz = n3((x / CELL) * 0.4 + this.seed, (y / CELL) * 0.4 + (z / CELL) * 0.31, this.frame * 0.05);
    const n = this.count++;
    this.px[n] = x; this.py[n] = y; this.pz[n] = z;
    this.pt[n] = tex === undefined ? nz : lerp(nz, tex, 0.5);
    this.pa[n] = 0;
    this.pw[n] = 1;
    this.qx[n] = this.qy[n] = this.qz[n] = 0;
  }

  /** A burst of particles proportional to the brush volume (radius in cells). */
  inject(cx, cy, cz, radiusCells, amount) {
    const n = Math.round(amount * radiusCells ** 3 * 22);
    for (let i = 0; i < n; i++) this.spawn(cx, cy, cz, radiusCells * CELL);
  }

  /** Steady trickle for living strokes; fractional counts are dithered. */
  hold(cx, cy, cz, radiusCells, target, tex, scale = 1) {
    const e = target * radiusCells * radiusCells * 2.4 * scale;
    let n = Math.floor(e);
    if (Math.random() < e - n) n++;
    for (let i = 0; i < n; i++) this.spawn(cx, cy, cz, radiusCells * CELL, tex);
  }

  /** Local push that fades over a few frames, so fast strokes throw smoke. */
  impulse(x, y, z, vx, vy, vz) {
    if (this.impulses.length < 80) this.impulses.push({ x, y, z, vx: vx * CELL, vy: vy * CELL, vz: vz * CELL, r: 3.5 * CELL, s: 1 });
  }

  /** Move, age and cull particles. Velocity is refreshed every third frame. */
  step() {
    const { ageDecay, agingFrames } = this.params, o = [0, 0, 0];
    const { px, py, pz, pt, pa, pw, qx, qy, qz } = this;
    const imps = this.impulses;
    for (let i = imps.length - 1; i >= 0; i--) {
      imps[i].s *= 0.93;
      if (imps[i].s < 0.03) imps.splice(i, 1);
    }
    let m = 0;
    for (let n = 0; n < this.count; n++) {
      let x = px[n], y = py[n], z = pz[n];
      const a = pa[n] + 1;
      if (a < 3 || (n + this.frame) % 3 === 0) {
        this.flow(x, y, z, o);
        qx[n] = o[0];
        qy[n] = o[1];
        qz[n] = o[2];
      }
      // Jitter grows with age so old smoke diffuses.
      const jt = (0.05 + 0.14 * Math.min(1, a / 120)) * CELL;
      x += qx[n] + (Math.random() - 0.5) * jt;
      y += qy[n] + (Math.random() - 0.5) * jt;
      z += qz[n] + (Math.random() - 0.5) * jt;
      const w = pw[n] * 0.999 * (1 - ageDecay * Math.min(1, a / agingFrames));
      if (w < 0.06) continue;
      // Compact survivors in place.
      px[m] = x; py[m] = y; pz[m] = z;
      pt[m] = pt[n]; pa[m] = a; pw[m] = w;
      qx[m] = qx[n]; qy[m] = qy[n]; qz[m] = qz[n];
      m++;
    }
    this.count = m;
  }
}

/** A frozen copy of particle state, so smoke can step "on 2s" while the camera moves every frame. */
export class ParticleSnapshot {
  constructor(max = 90000) {
    const F = () => new Float32Array(max);
    this.x = F(); this.y = F(); this.z = F();
    this.t = F(); this.a = F(); this.w = F();
    this.count = 0;
  }

  capture(sim) {
    const n = (this.count = sim.count);
    this.x.set(sim.px.subarray(0, n));
    this.y.set(sim.py.subarray(0, n));
    this.z.set(sim.pz.subarray(0, n));
    this.t.set(sim.pt.subarray(0, n));
    this.a.set(sim.pa.subarray(0, n));
    this.w.set(sim.pw.subarray(0, n));
  }
}
