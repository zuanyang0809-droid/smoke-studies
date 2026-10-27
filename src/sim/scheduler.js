// Adaptive scheduling for many fluid layers (2.5D cards).
//
// The card being drawn on always steps every frame. When the measured cost
// of the other busy cards would blow the frame budget, they step every N
// frames instead, with a time scale of N so the motion keeps its speed.

export class AdaptiveScheduler {
  constructor({ budgetMs = 12, maxSkip = 2 } = {}) {
    this.budgetMs = budgetMs;
    this.maxSkip = maxSkip;
    this.avgCost = 3; // running average ms per layer step
    this.skip = 1;
    this._spent = 0;
    this._count = 0;
  }

  /** Decide this frame's skip factor from how many background layers are busy. */
  beginFrame(busyBackgroundLayers, drawing) {
    const room = Math.max(2, this.budgetMs - (drawing ? this.avgCost : 0));
    this.skip = Math.min(this.maxSkip, Math.max(1, Math.ceil((this.avgCost * busyBackgroundLayers) / room)));
    this._spent = 0;
    this._count = 0;
  }

  /** Time scale for a layer this frame. */
  timeScale(isDrawTarget) {
    return isDrawTarget ? 1 : this.skip;
  }

  /** Busy background layers are staggered by index so the work spreads out. */
  shouldStep(index, frame, isDrawTarget, busy) {
    return isDrawTarget || !busy || (frame + index) % this.skip === 0;
  }

  record(ms) {
    this._spent += ms;
    this._count++;
  }

  endFrame() {
    if (this._count) this.avgCost = this.avgCost * 0.9 + (this._spent / this._count) * 0.1;
  }
}
