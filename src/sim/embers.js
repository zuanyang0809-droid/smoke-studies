// Drifting embers: small sparks born in fresh, dense smoke that ride the
// flow and burn out. The 2D version samples the grid velocity; the 3D
// version samples the particle flow field. Both share one look curve.

import { lerp } from '../core/math.js';
import { mix } from '../core/color.js';
import { n3 } from '../core/noise.js';

const randomSize = () => {
  const r = Math.random();
  return r < 0.15 ? 3 : r < 0.5 ? 2 : 1;
};

/**
 * Size and color of an ember at its current age.
 * @param {{a: number, l: number, id: number}} e  age, lifetime, id
 * @param {number[][]} stops  three colors: hot, warm, dark
 * @returns {{ scale: number, color: number[] }} scale 0..1 (grow in, shrink out)
 */
export function emberLook(e, frame, stops) {
  const q = e.a / e.l;
  const grow = Math.min(1, q / 0.12), shrink = q > 0.7 ? 1 - (q - 0.7) / 0.3 : 1;
  const twinkle = n3(e.id * 1.3, frame * 0.12, 9);
  const heat = Math.min(1, q * 0.9 + (twinkle < 0.4 ? 0.35 : 0));
  const color = heat < 0.45 ? mix(stops[0], stops[1], heat / 0.45) : mix(stops[1], stops[2], (heat - 0.45) / 0.55);
  return { scale: grow * shrink, color };
}

export class Embers2D {
  constructor(max = 160) {
    this.max = max;
    this.list = [];
    this.nextId = 0;
  }

  get count() {
    return this.list.length;
  }

  clear() {
    this.list = [];
  }

  add(x, y) {
    if (this.list.length >= this.max) return;
    const sz = randomSize(); // drawn before the lifetime, as in the prototypes
    this.list.push({ x, y, vx: 0, vy: 0, a: 0, l: 90 + Math.random() * 110, sz, id: this.nextId++ });
  }

  /** Try 40 random cells; young, dense smoke may throw off an ember. */
  spawn(fluid, rate) {
    const r = fluid.activeRegion();
    if (!(rate > 0) || !r) return;
    const { nx, d, A } = fluid;
    for (let n = 0; n < 40; n++) {
      const i = r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1));
      const j = r[2] + Math.floor(Math.random() * (r[3] - r[2] + 1));
      const k = i + j * nx;
      if (d[k] > 0.16 && A[k] < 45 && Math.random() < 0.12 * rate) this.add(i + Math.random() - 0.5, j + Math.random() - 0.5);
    }
  }

  /** Follow the smoke velocity with a little lift and noise. */
  step(fluid, frame, f = 1) {
    const { nx, ny, u, v } = fluid;
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      s.vx = lerp(s.vx, fluid.sample(u, s.x, s.y) * 0.9, 0.1) + (n3(s.id * 0.7, frame * 0.03, 5) - 0.5) * 0.05;
      s.vy = lerp(s.vy, fluid.sample(v, s.x, s.y) * 0.9 - 0.1, 0.1) + (n3(s.id * 0.7 + 50, frame * 0.03, 5) - 0.5) * 0.03;
      s.x += s.vx * f;
      s.y += s.vy * f;
      s.a += f;
      if (s.a > s.l || s.x < -2 || s.x > nx + 2 || s.y < -2 || s.y > ny + 2) list.splice(i, 1);
    }
  }
}

export class Embers3D {
  constructor(max = 200) {
    this.max = max;
    this.list = [];
    this.nextId = 0;
    this._o = [0, 0, 0];
  }

  clear() {
    this.list = [];
  }

  /**
   * Spawn from young particles.
   * @param {(x: number, y: number, z: number) => number} [densityAt]
   *   When a renderer can report voxel density (the volume renderer),
   *   embers need dense smoke, as in 3D v1. Otherwise particle weight is used, as in v2.
   */
  spawn(sim, embers, densityAt) {
    if (!embers.enabled || !(embers.amount > 0) || !sim.count) return;
    const { px, py, pz, pa, pw } = sim;
    for (let n = 0; n < 40; n++) {
      const p = Math.floor(Math.random() * sim.count);
      if (pa[p] >= 45) continue;
      let ok;
      if (densityAt) ok = densityAt(px[p], py[p], pz[p]) > 0.16 && Math.random() < 0.15 * embers.amount;
      else ok = pw[p] >= 0.6 && Math.random() < 0.04 * embers.amount;
      if (ok && this.list.length < this.max) {
        const sz = randomSize();
        this.list.push({ x: px[p], y: py[p], z: pz[p], vx: 0, vy: 0, vz: 0, a: 0, l: 45 + Math.random() * 60, sz, id: this.nextId++ });
      }
    }
  }

  step(sim) {
    const o = this._o, cell = sim.cell, frame = sim.frame, list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      sim.flow(e.x, e.y, e.z, o);
      e.vx = lerp(e.vx, o[0] * 0.9, 0.1) + (n3(e.id * 0.7, frame * 0.03, 5) - 0.5) * 0.05 * cell;
      e.vy = lerp(e.vy, o[1] * 0.9 + 0.08 * cell, 0.1);
      e.vz = lerp(e.vz, o[2] * 0.9, 0.1) + (n3(e.id * 0.7 + 40, frame * 0.03, 5) - 0.5) * 0.05 * cell;
      e.x += e.vx;
      e.y += e.vy;
      e.z += e.vz;
      e.a++;
      if (e.a > e.l) list.splice(i, 1);
    }
  }
}
