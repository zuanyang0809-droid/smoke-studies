// Shift + drag rotates a CSS 3D world (2.5D cards). Plain DOM, no three.js.

import { clamp } from '../core/math.js';

/** Drag-to-rotate for a view object with { rx, ry, apply(animate) } in degrees. */
export class WorldTilt {
  constructor(view, { sensitivity = 0.35, maxX = 70, maxY = 80 } = {}) {
    this.view = view;
    this.sensitivity = sensitivity;
    this.maxX = maxX;
    this.maxY = maxY;
    this.active = false;
    this._last = null;
  }

  begin(e) {
    this.active = true;
    this._last = [e.clientX, e.clientY];
  }

  move(e) {
    const v = this.view, k = this.sensitivity;
    v.ry = clamp(v.ry + (e.clientX - this._last[0]) * k, -this.maxY, this.maxY);
    v.rx = clamp(v.rx - (e.clientY - this._last[1]) * k, -this.maxX, this.maxX);
    this._last = [e.clientX, e.clientY];
    v.apply(false);
  }

  end() {
    this.active = false;
  }

  /** Face the front again (double-click). */
  reset() {
    this.view.rx = this.view.ry = 0;
    this.view.apply(true);
  }
}
