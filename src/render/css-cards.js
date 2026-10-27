// 2.5D compositor: each smoke layer gets its own transparent canvas, placed
// as a "card" in CSS 3D space. The browser does the perspective and
// compositing, the way Arcane layers flat 2D FX elements in a 3D scene.

import { ToonRenderer2D } from './toon2d.js';

export const PERSPECTIVE = 1100; // px, must match the #space CSS perspective

export class CardSpace {
  /**
   * @param {object} o
   * @param {HTMLElement} o.stage   sized container (the visible frame)
   * @param {HTMLElement} o.world   preserve-3d element rotated by the view
   * @param {() => import('../sim/layer2d.js').SmokeLayer2D} o.createLayer
   * @param {number} o.width        card canvas size in px (grid * cellSize)
   * @param {number} o.height
   * @param {number} [o.cellSize]
   * @param {number} [o.maxCards]
   */
  constructor({ stage, world, createLayer, width, height, cellSize = 3, maxCards = 24 }) {
    this.stage = stage;
    this.world = world;
    this.createLayer = createLayer;
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.maxCards = maxCards;
    this.cards = [];
    this.rx = 0; // world rotation, degrees
    this.ry = 0;
    this.depth = 0; // z for new cards, px
    this.cw = 680; // on-screen card size, follows the stage
    this.ch = 453;
    new ResizeObserver(() => this.resize()).observe(stage);
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    this.cw = r.width;
    this.ch = r.height;
    this.cards.forEach((c) => this._layout(c));
  }

  /** Apply the world rotation; `animate` eases back to the front view. */
  apply(animate) {
    const w = this.world;
    if (animate) {
      w.style.transition = 'transform .4s';
      setTimeout(() => (w.style.transition = ''), 450);
    }
    w.style.transform = `rotateX(${this.rx.toFixed(2)}deg) rotateY(${this.ry.toFixed(2)}deg)`;
  }

  /** Undo the world rotation at the moment of creation so the card faces the camera. */
  _layout(c) {
    const s = c.canvas.style;
    s.width = this.cw + 'px';
    s.height = this.ch + 'px';
    s.left = -this.cw / 2 + 'px';
    s.top = -this.ch / 2 + 'px';
    s.transform = `rotateY(${(-c.ry).toFixed(2)}deg) rotateX(${(-c.rx).toFixed(2)}deg) translateZ(${c.z}px)`;
  }

  _remove(c) {
    c.canvas.remove();
  }

  /** New card facing the current view. Drops empty cards and the oldest one past the limit. */
  newCard() {
    this.cards = this.cards.filter((c) => {
      const keep = c.layer.active || c.layer.strokes.length > 0;
      if (!keep) this._remove(c);
      return keep;
    });
    if (this.cards.length >= this.maxCards) this._remove(this.cards.shift());

    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    Object.assign(canvas.style, { position: 'absolute', pointerEvents: 'none' });
    const layer = this.createLayer();
    layer.fluid.noiseOffset = this.rx * 0.01 + this.ry * 0.013;
    const card = {
      rx: this.rx,
      ry: this.ry,
      z: this.depth,
      layer,
      canvas,
      renderer: new ToonRenderer2D(canvas, { cellSize: this.cellSize, transparent: true, dirtyRects: true }),
      lastRender: 0,
    };
    this.world.appendChild(canvas);
    this._layout(card);
    this.cards.push(card);
    return card;
  }

  /** Keep drawing on the last card while the view and depth are unchanged. */
  pickCard() {
    const c = this.cards[this.cards.length - 1];
    if (c && Math.abs(c.rx - this.rx) < 1.5 && Math.abs(c.ry - this.ry) < 1.5 && c.z === this.depth) return c;
    return this.newCard();
  }

  clear() {
    this.cards.forEach((c) => this._remove(c));
    this.cards = [];
  }

  /** Pointer position -> grid cell on a card (cards face the camera, so only depth scales). */
  toGrid(e, card) {
    const r = this.stage.getBoundingClientRect(), k = (PERSPECTIVE - card.z) / PERSPECTIVE;
    const lx = (e.clientX - r.left - r.width / 2) * k + this.cw / 2;
    const ly = (e.clientY - r.top - r.height / 2) * k + this.ch / 2;
    return { x: (lx * this.width) / this.cw / this.cellSize, y: (ly * this.height) / this.ch / this.cellSize };
  }
}
