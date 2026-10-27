// Shift + drag rotates the 2.5D world. Angles are unbounded, so the view can
// turn all the way round to the backs of the cards. Plain DOM, no three.js.

import { angleDelta } from '../render/card-space.js';

/** Drag-to-rotate for a view object with { rx, ry, apply(animate) } in degrees. */
export class WorldTilt {
  constructor(view, { sensitivity = 0.35 } = {}) {
    this.view = view;
    this.sensitivity = sensitivity;
    this.active = false;
    this._last = null;
  }

  begin(e) {
    this.active = true;
    this._last = [e.clientX, e.clientY];
  }

  move(e) {
    const v = this.view, k = this.sensitivity;
    v.ry += (e.clientX - this._last[0]) * k;
    v.rx -= (e.clientY - this._last[1]) * k;
    this._last = [e.clientX, e.clientY];
    v.apply(false);
  }

  end() {
    this.active = false;
  }

  /** Face the front again (double-click), turning the short way round. */
  reset() {
    const v = this.view;
    v.rx -= angleDelta(v.rx, 0);
    v.ry -= angleDelta(v.ry, 0);
    v.apply(true);
  }
}
