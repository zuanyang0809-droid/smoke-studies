// A smoke layer bundles one fluid grid with what lives on it: living
// strokes and embers. The 2D app has a single layer; in the 2.5D app every
// card is a layer. Both run the exact same per-frame update.

import { Fluid2D, fluidParamsFromStyle } from './fluid2d.js';
import { Embers2D } from './embers.js';
import { sustainStrokes2D } from './emitters.js';

/** Everything a layer needs per frame, from the Style JSON. */
export function layerParamsFromStyle(style) {
  return { ...fluidParamsFromStyle(style), emberRate: style.embers.amount };
}

export class SmokeLayer2D {
  /** @param {ConstructorParameters<typeof Fluid2D>[0]} fluidOptions */
  constructor(fluidOptions) {
    this.fluid = new Fluid2D(fluidOptions);
    this.strokes = [];
    this.points = 0;
    this.embers = new Embers2D();
    this.active = false;
  }

  clear() {
    this.fluid.clear();
    this.strokes = [];
    this.points = 0;
    this.embers.clear();
    this.active = false;
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

  /** Undo of a brush stroke: back to the fluid as it was when the stroke began. */
  restore(snap) {
    this.fluid.restore(snap);
    this.active = true; // step once more; the layer goes idle if nothing is left
  }

  /** Busy layers need simulation time even if they hold no smoke yet. */
  isBusy(emitter) {
    return this.active || this.strokes.length > 0 || emitter.isDrawing(this);
  }

  /**
   * Advance one frame.
   * @param {import('./emitters.js').Emitter2D} emitter
   * @returns {boolean} true on the frame the layer goes idle (nothing left to
   *   simulate), so the app can draw or clear it one last time.
   */
  step(params, frame, f, emitter) {
    const drawingHere = emitter.isDrawing(this);
    if (drawingHere) emitter.holdStill(frame);
    if (this.strokes.length) sustainStrokes2D(this, frame);

    this.embers.spawn(this.fluid, params.emberRate);
    this.embers.step(this.fluid, frame, f);

    const busy = this.fluid.hasSmoke() || drawingHere || this.strokes.length > 0 || this.embers.count > 0;
    if (!busy) {
      const wentIdle = this.active;
      this.active = false;
      return wentIdle;
    }
    this.active = true;
    this.fluid.step(params, frame, f);
    return false;
  }
}
