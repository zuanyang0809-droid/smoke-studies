// Emitters turn pointer input into smoke sources.
//
// Two modes, shared by every app:
//   brush         smoke is injected along the drag and drifts away; holding
//                 still keeps a small smoldering source under the cursor
//   livingStroke  the drawn line is stored and re-emits every frame, so it
//                 keeps smoldering until cleared

import { n3 } from '../core/noise.js';
import { CELL } from './particles3d.js';

const MAX_STROKE_POINTS_2D = 2500;
const MAX_STROKE_POINTS_3D = 1500;
const STROKE_SPACING = 1.2; // cells between stored stroke points

/** Living strokes re-emit at a gently flickering density. */
export function sustainStrokes2D(layer, frame) {
  const fluid = layer.fluid;
  let s = 0;
  for (const stroke of layer.strokes) {
    for (const q of stroke) {
      s++;
      fluid.hold(
        q.x, q.y, 1.6,
        0.15 + 0.2 * n3(s * 0.07, frame * 0.012, 3),
        (n3(s * 0.1, frame * 0.01, 7) - 0.5) * 0.4, -0.2,
        n3(s * 0.21, frame * 0.02, 11),
        stroke.col,
      );
    }
  }
}

/**
 * Pointer -> 2D fluid. Coordinates are grid cells. The target is a layer
 * ({ fluid, strokes, points }), so the 2.5D app can point it at any card.
 */
export class Emitter2D {
  constructor() {
    this.mode = 'brush';
    this.down = false;
    this.moved = false;
    this.last = null;
    this.layer = null;
    this.stroke = null;
    this.rgb = [138, 143, 153];
  }

  isDrawing(layer) {
    return this.down && this.layer === layer;
  }

  begin(layer, p, frame) {
    const fluid = layer.fluid;
    this.layer = layer;
    fluid.seed = Math.random() * 100;
    this.down = true;
    this.last = p;
    this.moved = true;
    if (this.mode === 'livingStroke' && layer.points < MAX_STROKE_POINTS_2D) {
      this.stroke = [{ x: p.x, y: p.y }];
      this.stroke.col = this.rgb.slice();
      layer.strokes.push(this.stroke);
      layer.points++;
      fluid.hold(p.x, p.y, 1.6, 0.3, 0, -0.2, 0.5, this.stroke.col);
    } else {
      fluid.inject(p.x, p.y, 1.8, 0.08, 0, -0.6, frame, 0.5, this.rgb);
    }
  }

  move(p, frame) {
    if (!this.down) return;
    const layer = this.layer, fluid = layer.fluid;
    const dx = p.x - this.last.x, dy = p.y - this.last.y, len = Math.hypot(dx, dy);

    if (this.mode === 'livingStroke') {
      if (len < STROKE_SPACING || !this.stroke || layer.points >= MAX_STROKE_POINTS_2D) return;
      const n = Math.floor(len / STROKE_SPACING);
      for (let s = 1; s <= n; s++) {
        const q = (s * STROKE_SPACING) / len, pt = { x: this.last.x + dx * q, y: this.last.y + dy * q };
        this.stroke.push(pt);
        layer.points++;
        fluid.hold(pt.x, pt.y, 1.6, 0.3, 0, -0.2, n3(layer.points * 0.21, frame * 0.02, 11), this.stroke.col);
      }
      this.last = this.stroke[this.stroke.length - 1];
      this.moved = true;
      return;
    }

    if (len < 0.3) return;
    // Faster drags push harder, up to a cap; sub-steps keep the line continuous.
    const sp = Math.min(1.4, len * 0.45), vx = (dx / len) * sp, vy = (dy / len) * sp, n = Math.max(1, Math.ceil(len / 0.7));
    for (let s = 1; s <= n; s++) {
      const q = s / n;
      fluid.inject(this.last.x + dx * q, this.last.y + dy * q, 2, 0.075, vx, vy, frame * 0.4 + s * 0.3, 0.5, this.rgb);
    }
    this.last = p;
    this.moved = true;
  }

  /** Called by the layer each frame: holding still in brush mode smolders. */
  holdStill(frame) {
    if (this.mode !== 'brush' || !this.down || this.moved || !this.last) return;
    this.layer.fluid.inject(
      this.last.x + Math.sin(frame * 0.21) * 0.3, this.last.y, 1.5, 0.07,
      Math.sin(frame * 0.07) * 0.15, -0.7, frame * 0.4, 0.5, this.rgb,
    );
  }

  endFrame() {
    this.moved = false;
  }

  end() {
    this.down = false;
    this.stroke = null;
  }
}

/**
 * Draw a recorded brush stroke again (redo). The replay is not frame exact:
 * the whole path is injected at once, which reads the same a moment later.
 * @param {{x: number, y: number}[]} points  grid cells
 */
export function replayStroke2D(layer, points, rgb, frame) {
  if (!points.length) return;
  const e = new Emitter2D();
  e.rgb = rgb;
  e.begin(layer, points[0], frame);
  for (let i = 1; i < points.length; i++) e.move(points[i], frame + i);
  e.end();
}

/** Pointer -> 3D particles. Points are world positions on the draw plane. */
export class Emitter3D {
  constructor() {
    this.mode = 'brush';
    this.radius = 0.3; // Style JSON emission.radius
    this.drawing = false;
    this.moved = false;
    this.last = null;
    this.stroke = null;
    this.strokes = [];
    this.points = 0;
    this.holdScale = 1;
  }

  /** Brush radius in cells. */
  get radiusCells() {
    return 1.6 + this.radius * 2.4;
  }

  clear() {
    this.strokes = [];
    this.points = 0;
  }

  /** Undo of a living stroke: it stops emitting and its smoke fades. */
  removeStroke(stroke) {
    const i = this.strokes.indexOf(stroke);
    if (i < 0) return;
    this.strokes.splice(i, 1);
    this.points -= stroke.length;
  }

  addStroke(stroke) {
    if (this.strokes.includes(stroke)) return;
    this.strokes.push(stroke);
    this.points += stroke.length;
  }

  begin(sim, g) {
    this.drawing = true;
    this.last = g;
    sim.seed = Math.random() * 100;
    this.moved = true;
    const R = this.radiusCells;
    if (this.mode === 'livingStroke' && this.points < MAX_STROKE_POINTS_3D) {
      this.stroke = [g];
      this.strokes.push(this.stroke);
      this.points++;
      sim.hold(g.x, g.y, g.z, R, 0.45, 0.5, this.holdScale);
    } else {
      sim.inject(g.x, g.y, g.z, R, 0.2);
    }
  }

  move(sim, g) {
    if (!this.drawing) return;
    const last = this.last, R = this.radiusCells;
    const dx = (g.x - last.x) / CELL, dy = (g.y - last.y) / CELL, dz = (g.z - last.z) / CELL, len = Math.hypot(dx, dy, dz);

    if (this.mode === 'livingStroke') {
      if (len < STROKE_SPACING || !this.stroke || this.points >= MAX_STROKE_POINTS_3D) return;
      const n = Math.floor(len / STROKE_SPACING);
      for (let s = 1; s <= n; s++) {
        const q = (s * STROKE_SPACING) / len;
        const p = { x: last.x + dx * q * CELL, y: last.y + dy * q * CELL, z: last.z + dz * q * CELL };
        this.stroke.push(p);
        this.points++;
        sim.hold(p.x, p.y, p.z, R, 0.45, n3(this.points * 0.21, sim.frame * 0.02, 11), this.holdScale);
      }
      this.last = this.stroke[this.stroke.length - 1];
      this.moved = true;
      return;
    }

    if (len < 0.3) return;
    const sp = Math.min(1.2, len * 0.45), n = Math.max(1, Math.ceil(len / 0.7));
    for (let s = 1; s <= n; s++) {
      const q = s / n;
      sim.inject(last.x + dx * q * CELL, last.y + dy * q * CELL, last.z + dz * q * CELL, R, 0.19);
    }
    sim.impulse(g.x, g.y, g.z, (dx / len) * sp, (dy / len) * sp, (dz / len) * sp);
    this.last = g;
    this.moved = true;
  }

  end() {
    this.drawing = false;
    this.stroke = null;
  }

  /** Per simulation tick: smolder under a still brush, re-emit living strokes. */
  tick(sim) {
    const R = this.radiusCells, frame = sim.frame;
    if (this.drawing && !this.moved && this.last && this.mode === 'brush') {
      sim.inject(this.last.x, this.last.y, this.last.z, R * 0.8, 0.16);
      sim.impulse(this.last.x, this.last.y, this.last.z, 0, 0.5, 0);
    }
    this.moved = false;
    // Many stroke points share a fixed particle budget.
    this.holdScale = Math.min(1, 900 / Math.max(1, this.points * 3));
    // Living-stroke smoke belongs to no brush stroke, so a brush undo leaves it.
    const id = sim.strokeId;
    sim.strokeId = 0;
    let s = 0;
    for (const stroke of this.strokes) {
      for (const p of stroke) {
        s++;
        sim.hold(p.x, p.y, p.z, R * 0.9, 0.25 + 0.25 * n3(s * 0.07, frame * 0.012, 3), n3(s * 0.21, frame * 0.02, 11), this.holdScale);
      }
    }
    sim.strokeId = id;
  }
}

/**
 * Draw a recorded 3D brush stroke again (redo), all at once.
 * @param {{x: number, y: number, z: number}[]} points  world positions
 */
export function replayStroke3D(sim, points, radius) {
  if (!points.length) return;
  const e = new Emitter3D();
  e.radius = radius;
  e.begin(sim, points[0]);
  for (let i = 1; i < points.length; i++) e.move(sim, points[i]);
  e.end();
}
