// 2.5D card space. Every smoke layer is a flat card placed in 3D, the way
// Arcane composites flat 2D FX elements into a 3D shot. A new card faces the
// camera at the moment it is created; after that the world rotates freely,
// all the way round to the backs of the cards (which show mirrored).
//
// The matrices reproduce the CSS 3D setup of the prototypes: perspective
// 1100 px, rotateX(rx) rotateY(ry) on the world, and on each card the inverse
// rotation plus translateZ(depth). Coordinates are CSS px, y down, z toward
// the viewer, origin at the center of the window.

export const PERSPECTIVE = 1100; // px at the prototypes' 680 px stage width
const REFERENCE_WIDTH = 680;
const DEG = Math.PI / 180;
const EASE_MS = 400;

/** Signed difference a - b between two angles in degrees, in [-180, 180). */
export function angleDelta(a, b) {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

// Column-major 4 x 4 matrices, as WebGL expects them.
export function multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

const rotateX = (deg) => {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
};
const rotateY = (deg) => {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
};
const translateZ = (z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1];

/** CSS perspective as a projection: screen x = x * P / (P - z), y flipped for clip space. */
const perspective = (P, w, h) => [2 * P / w, 0, 0, 0, 0, -2 * P / h, 0, 0, 0, 0, -1, -1, 0, 0, P - 10, P];

/**
 * Card -> view transform (no projection).
 * @param {{rx: number, ry: number}} view   world rotation, degrees
 * @param {{rx: number, ry: number, z: number}} card  view at creation, depth in px
 */
export function cardToView(view, card) {
  return multiply(multiply(rotateX(view.rx), rotateY(view.ry)), multiply(multiply(rotateY(-card.ry), rotateX(-card.rx)), translateZ(card.z)));
}

/** Full card -> clip matrix for a viewport of w x h CSS px. */
export function cardMatrix(view, card, w, h, P) {
  return multiply(perspective(P, w, h), cardToView(view, card));
}

export class CardSpace {
  /**
   * @param {object} o
   * @param {() => import('../sim/layer2d.js').SmokeLayer2D} o.createLayer
   * @param {number} o.width   card size in grid pixels: the grid spans
   * @param {number} o.height  width / cellSize cells across the card
   * @param {number} [o.cellSize]
   * @param {number} [o.maxCards]
   * @param {(card: object) => void} [o.onRemove]  free a card's GPU resources
   */
  constructor({ createLayer, width, height, cellSize = 3, maxCards = 24, onRemove = () => {} }) {
    this.createLayer = createLayer;
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.maxCards = maxCards;
    this.onRemove = onRemove;
    this.cards = [];
    this.rx = 0; // world rotation, degrees, unbounded
    this.ry = 0;
    this.shown = { rx: 0, ry: 0 }; // rotation on screen (eases after a reset)
    this._ease = null;
    this.depth = 0; // z for new cards, px
    this.cw = REFERENCE_WIDTH; // on-screen card size = the viewport
    this.ch = 453;
    this.nextId = 1;
  }

  setViewport(w, h) {
    this.cw = w;
    this.ch = h;
  }

  /** Perspective distance; scales with wide windows so the depth effect keeps its strength. */
  get perspective() {
    return PERSPECTIVE * Math.max(1, this.cw / REFERENCE_WIDTH);
  }

  /** Show the world rotation; `animate` eases there (double-click to face the front). */
  apply(animate) {
    if (!animate) {
      this._ease = null;
      this.shown = { rx: this.rx, ry: this.ry };
      return;
    }
    this._ease = { from: { ...this.shown }, t0: performance.now() };
  }

  /** Advance the ease. @returns true while the shown rotation is changing */
  update(now = performance.now()) {
    const e = this._ease;
    if (!e) return false;
    const q = Math.min(1, (now - e.t0) / EASE_MS), k = q * q * (3 - 2 * q);
    this.shown = { rx: e.from.rx + (this.rx - e.from.rx) * k, ry: e.from.ry + (this.ry - e.from.ry) * k };
    if (q === 1) this._ease = null;
    return true;
  }

  /** New card facing the current view. Drops empty cards and the oldest one past the limit. */
  newCard() {
    this.cards = this.cards.filter((c) => {
      const keep = c.layer.active || c.layer.strokes.length > 0;
      if (!keep) this.onRemove(c);
      return keep;
    });
    if (this.cards.length >= this.maxCards) this.onRemove(this.cards.shift());

    const layer = this.createLayer();
    layer.fluid.noiseOffset = this.rx * 0.01 + this.ry * 0.013;
    const card = { id: this.nextId++, rx: this.rx, ry: this.ry, z: this.depth, layer, lastRender: 0 };
    this.cards.push(card);
    return card;
  }

  /** Keep drawing on the last card while the view (modulo 360) and depth are unchanged. */
  pickCard() {
    const c = this.cards[this.cards.length - 1];
    if (c && Math.abs(angleDelta(c.rx, this.rx)) < 1.5 && Math.abs(angleDelta(c.ry, this.ry)) < 1.5 && c.z === this.depth) return c;
    return this.newCard();
  }

  removeCard(card) {
    const i = this.cards.indexOf(card);
    if (i < 0) return;
    this.cards.splice(i, 1);
    this.onRemove(card);
  }

  /** Put a card back (undo / redo) if it was removed. */
  ensureCard(card) {
    if (!this.cards.includes(card)) this.cards.push(card);
  }

  clear() {
    this.cards.forEach((c) => this.onRemove(c));
    this.cards = [];
  }

  /** Cards with their clip matrices, back to front, for the current shown rotation. */
  drawList() {
    const P = this.perspective;
    return this.cards
      .map((card) => ({ card, depth: cardToView(this.shown, card)[14], matrix: cardMatrix(this.shown, card, this.cw, this.ch, P) }))
      .sort((a, b) => a.depth - b.depth);
  }

  /**
   * Viewport point (CSS px) -> grid cell on a card. Cards face the camera
   * when drawn on, so only depth scales. The arithmetic keeps the prototype's
   * order of operations, so the parity test stays bit-identical.
   */
  toGrid(x, y, card) {
    const k = (this.perspective - card.z) / this.perspective;
    const lx = (x - this.cw / 2) * k + this.cw / 2;
    const ly = (y - this.ch / 2) * k + this.ch / 2;
    return { x: (lx * this.width) / this.cw / this.cellSize, y: (ly * this.height) / this.ch / this.cellSize };
  }
}
