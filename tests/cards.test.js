import { describe, expect, it } from 'vitest';
import { angleDelta, CardSpace, cardToView } from '../src/render/card-space.js';
import { WorldTilt } from '../src/ui/tilt.js';

/** A layer stub: busy layers are kept when a new card is created. */
const layerStub = () => ({ fluid: {}, active: true, strokes: [] });
const space = (o = {}) => new CardSpace({ width: 480, height: 320, createLayer: layerStub, ...o });

describe('angleDelta', () => {
  it('wraps to [-180, 180)', () => {
    expect(angleDelta(370, 0)).toBe(10);
    expect(angleDelta(-350, 0)).toBe(10);
    expect(angleDelta(0, 720)).toBe(0);
    expect(angleDelta(181, 0)).toBe(-179);
    expect(angleDelta(-90.5, 270)).toBeCloseTo(-0.5);
  });
});

describe('CardSpace', () => {
  it('reuses the last card when the view is the same modulo 360', () => {
    const s = space();
    const a = s.pickCard();
    s.ry = 360;
    s.rx = -720.5;
    expect(s.pickCard()).toBe(a);
    s.ry = 361.6;
    expect(s.pickCard()).not.toBe(a);
  });

  it('starts a new card when the draw depth changes', () => {
    const s = space();
    const a = s.pickCard();
    s.depth = 100;
    const b = s.pickCard();
    expect(b).not.toBe(a);
    expect(b.z).toBe(100);
  });

  it('removes and restores cards, telling the renderer', () => {
    const removed = [];
    const s = space({ onRemove: (c) => removed.push(c.id) });
    const a = s.newCard();
    s.removeCard(a);
    expect(s.cards).toEqual([]);
    expect(removed).toEqual([a.id]);
    s.ensureCard(a);
    s.ensureCard(a);
    expect(s.cards).toEqual([a]);
  });

  it('drops empty cards and the oldest past the limit', () => {
    const removed = [];
    const s = space({ maxCards: 2, onRemove: (c) => removed.push(c.id) });
    const a = s.newCard(), b = s.newCard();
    b.layer.active = false;
    s.newCard(); // b is empty and goes; a stays
    expect(removed).toEqual([b.id]);
    s.newCard(); // over the limit: a goes
    expect(removed).toEqual([b.id, a.id]);
    expect(s.cards.length).toBe(2);
  });

  it('a card faces the camera in the view it was created in', () => {
    const m = cardToView({ rx: 33, ry: -250 }, { rx: 33, ry: -250, z: 40 });
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 40, 1];
    m.forEach((v, i) => expect(v).toBeCloseTo(I[i], 5)); // Float32 matrices
  });

  it('turning 180 degrees shows the back of a card, mirrored', () => {
    const m = cardToView({ rx: 0, ry: 180 }, { rx: 0, ry: 0, z: 0 });
    expect(m[0]).toBeCloseTo(-1); // x flips
    expect(m[5]).toBeCloseTo(1);
  });

  it('lists cards back to front', () => {
    const s = space();
    s.depth = -200;
    const far = s.newCard();
    s.depth = 200;
    const near = s.newCard();
    expect(s.drawList().map((d) => d.card)).toEqual([far, near]);
    s.ry = s.shown.ry = 180; // from behind, the order flips
    expect(s.drawList().map((d) => d.card)).toEqual([near, far]);
  });

  it('keeps each card on the grid it was made with after a resize', () => {
    const s = space();
    s.setViewport(680, 453);
    const old = s.newCard();
    s.width = 600; // a wider grid for cards made from now on
    s.depth = 50;
    const card = s.newCard();
    expect(s.toGrid(680, 0, old).x).toBeCloseTo(160 * (1 + 0.0), 0);
    expect(card.width).toBe(600);
    expect(s.toGrid(340, 226.5, card).x).toBeCloseTo(100);
  });

  it('maps the pointer to grid cells, scaled by depth', () => {
    const s = space();
    s.setViewport(680, 453);
    const card = s.newCard();
    expect(s.toGrid(340, 226.5, card)).toEqual({ x: 80, y: 320 / 6 });
    card.z = 550; // half way to the eye: the card looks twice as big
    expect(s.toGrid(680, 226.5, card).x).toBeCloseTo(120);
  });
});

describe('WorldTilt', () => {
  it('rotates without limits and resets the short way round', () => {
    const s = space();
    const tilt = new WorldTilt(s);
    tilt.begin({ clientX: 0, clientY: 0 });
    tilt.move({ clientX: 1400, clientY: -600 }); // 490 and 210 degrees
    expect(s.ry).toBeCloseTo(490);
    expect(s.rx).toBeCloseTo(210);
    expect(s.shown).toEqual({ rx: s.rx, ry: s.ry });
    tilt.end();
    tilt.reset();
    expect(s.ry).toBeCloseTo(360);
    expect(s.rx).toBeCloseTo(360);
    s.update(Infinity);
    expect(s.shown.ry).toBeCloseTo(360);
  });
});
