import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE } from '../src/core/style.js';
import { Fluid2D, fluidParamsFromStyle, gridForViewport } from '../src/sim/fluid2d.js';
import { SmokeLayer2D } from '../src/sim/layer2d.js';
import { Emitter2D, replayStroke2D } from '../src/sim/emitters.js';
import { strokeEntry2D } from '../src/sim/undo2d.js';
import { AdaptiveScheduler } from '../src/sim/scheduler.js';
import { emberLook } from '../src/sim/embers.js';
import { Particles3D, particleParamsFromStyle } from '../src/sim/particles3d.js';

const params = fluidParamsFromStyle(DEFAULT_STYLE);
const mass = (f) => f.d.reduce((s, x) => s + x, 0);

describe('fluidParamsFromStyle', () => {
  it('uses the prototype slider mapping', () => {
    expect(params.buoyancy).toBeCloseTo(0.004);
    expect(params.curl).toBeCloseTo(0.16);
    expect(params.ageDecay).toBeCloseTo(0.01);
    expect(params.agingFrames).toBe(80);
  });
});

describe('Fluid2D', () => {
  it('injects density and tracks its bounds', () => {
    const f = new Fluid2D({ trackBounds: true });
    expect(f.hasSmoke()).toBe(false);
    f.inject(80, 50, 2, 0.08, 0, -0.6, 0, 0.5);
    expect(mass(f)).toBeGreaterThan(0);
    expect(f.bounds).toEqual([78, 82, 48, 52]);
    expect(f.hasSmoke()).toBe(true);
  });

  it('stays finite and loses mass over time', () => {
    const f = new Fluid2D({ trackBounds: true, pressureIterations: 14 });
    f.inject(80, 60, 2, 0.08, 0.5, -0.6, 0, 0.5);
    const m0 = mass(f);
    for (let i = 0; i < 60; i++) f.step(params, i);
    const m1 = mass(f);
    expect(Number.isFinite(m1)).toBe(true);
    expect(m1).toBeLessThan(m0);
  });

  it('moves smoke upward', () => {
    const f = new Fluid2D();
    f.inject(80, 70, 2, 0.08, 0, -0.6, 0, 0.5);
    const cy = () => {
      let s = 0, w = 0;
      for (let k = 0; k < f.n; k++) {
        s += f.d[k] * Math.floor(k / f.nx);
        w += f.d[k];
      }
      return s / w;
    };
    const y0 = cy();
    for (let i = 0; i < 30; i++) f.step(params, i);
    expect(cy()).toBeLessThan(y0);
  });

  it('blends injected color by density', () => {
    const f = new Fluid2D({ color: true, rgb: [0, 0, 0] });
    f.inject(80, 50, 2, 0.08, 0, 0, 0, 0.5, [255, 0, 0]);
    const k = 80 + 50 * f.nx;
    expect(f.cr[k]).toBeGreaterThan(250);
    expect(f.cg[k]).toBe(0);
  });

  it('hold keeps a minimum density', () => {
    const f = new Fluid2D();
    f.hold(40, 40, 1.6, 0.3, 0, -0.2, 0.5);
    expect(f.d[40 + 40 * f.nx]).toBeCloseTo(0.3);
  });
});

describe('AdaptiveScheduler', () => {
  it('skips background layers only when over budget', () => {
    const s = new AdaptiveScheduler({ budgetMs: 12 });
    s.beginFrame(2, false);
    expect(s.skip).toBe(1);
    s.avgCost = 8;
    s.beginFrame(6, true);
    expect(s.skip).toBe(2);
    expect(s.timeScale(true)).toBe(1);
    expect(s.timeScale(false)).toBe(2);
    expect(s.shouldStep(0, 1, false, true)).toBe(false);
    expect(s.shouldStep(1, 1, false, true)).toBe(true);
    expect(s.shouldStep(0, 1, true, true)).toBe(true);
  });
});

describe('emberLook', () => {
  it('grows in and shrinks out', () => {
    const stops = [[255, 255, 200], [255, 160, 50], [130, 30, 20]];
    expect(emberLook({ a: 0, l: 100, id: 1 }, 0, stops).scale).toBe(0);
    expect(emberLook({ a: 50, l: 100, id: 1 }, 0, stops).scale).toBe(1);
    expect(emberLook({ a: 100, l: 100, id: 1 }, 0, stops).scale).toBeCloseTo(0);
  });
});

describe('Particles3D', () => {
  it('spawns, rises and culls particles', () => {
    const sim = new Particles3D(5000);
    // No curl: the noise table is random per run and could outweigh the rise.
    sim.params = particleParamsFromStyle({ ...DEFAULT_STYLE, motion: { ...DEFAULT_STYLE.motion, curl: 0, dissipation: 1 } });
    sim.inject(0, 0, 0, 2, 0.2);
    const n0 = sim.count;
    expect(n0).toBe(Math.round(0.2 * 8 * 22));
    const y0 = sim.py.slice(0, n0).reduce((a, b) => a + b, 0) / n0;
    for (let i = 0; i < 20; i++) {
      sim.frame++;
      sim.step();
    }
    const y1 = sim.py.slice(0, sim.count).reduce((a, b) => a + b, 0) / sim.count;
    expect(y1).toBeGreaterThan(y0);
    for (let i = 0; i < 400; i++) sim.step();
    expect(sim.count).toBe(0);
  });
});

describe('2D grid helpers', () => {
  it('sizes the grid to the viewport aspect at about the cell budget', () => {
    const { nx, ny } = gridForViewport(1600, 900, 32000);
    expect(nx / ny).toBeCloseTo(16 / 9, 1);
    expect(nx * ny).toBeGreaterThan(30000);
    expect(nx * ny).toBeLessThan(34000);
    expect(gridForViewport(10, 2000)).toEqual({ nx: 89, ny: 356 }); // aspect clamped to 1:4
  });

  it('restores a snapshot exactly, including color and bounds', () => {
    const f = new Fluid2D({ color: true, trackBounds: true });
    f.inject(40, 40, 3, 0.4, 0.5, -0.5, 0, 0.5, [200, 10, 10]);
    f.step(params, 0);
    const snap = f.snapshot(), d = f.d.slice(), cr = f.cr.slice(), bounds = f.bounds.slice();
    f.inject(90, 60, 4, 0.5, 0, 0, 0, 0.5, [10, 200, 10]);
    for (let i = 0; i < 5; i++) f.step(params, i);
    f.restore(snap);
    expect(f.d).toEqual(d);
    expect(f.cr).toEqual(cr);
    expect(f.bounds).toEqual(bounds);
    f.bounds[0] = -1; // the snapshot keeps its own copy
    expect(snap.bounds).toEqual(bounds);
  });

  it('replays a recorded brush stroke into the layer', () => {
    const layer = new SmokeLayer2D({ trackBounds: true });
    replayStroke2D(layer, [{ x: 30, y: 50 }, { x: 40, y: 48 }, { x: 52, y: 45 }], [255, 0, 0], 0);
    expect(layer.fluid.hasSmoke()).toBe(true);
    expect(layer.fluid.bounds[0]).toBeLessThanOrEqual(28);
    expect(layer.fluid.bounds[1]).toBeGreaterThanOrEqual(54);
  });

  it('removes and re-adds living strokes with their point count', () => {
    const layer = new SmokeLayer2D();
    const stroke = [{ x: 1, y: 1 }, { x: 2, y: 1 }];
    layer.addStroke(stroke);
    layer.addStroke(stroke);
    expect(layer.points).toBe(2);
    layer.removeStroke(stroke);
    expect(layer.strokes).toEqual([]);
    expect(layer.points).toBe(0);
  });
});

describe('strokeEntry2D', () => {
  const drawStroke = (layer, emitter, pts) => {
    const before = layer.fluid.snapshot();
    emitter.begin(layer, pts[0], 0);
    const entry = strokeEntry2D(layer, emitter, before, pts[0], () => 0);
    for (const p of pts.slice(1)) {
      emitter.move(p, 0);
      entry.record(p);
    }
    emitter.end();
    return entry;
  };
  const pts = [{ x: 30, y: 50 }, { x: 40, y: 48 }, { x: 50, y: 45 }];

  it('brush: undo restores the fluid, redo draws the stroke again', () => {
    const layer = new SmokeLayer2D({ trackBounds: true }), emitter = new Emitter2D();
    const entry = drawStroke(layer, emitter, pts);
    expect(layer.fluid.hasSmoke()).toBe(true);
    entry.undo();
    expect(layer.fluid.hasSmoke()).toBe(false);
    entry.redo();
    expect(layer.fluid.hasSmoke()).toBe(true);
    entry.undo(); // undo after redo goes back to the state before the redo
    expect(layer.fluid.hasSmoke()).toBe(false);
  });

  it('living stroke: undo stops it emitting, redo restarts it', () => {
    const layer = new SmokeLayer2D(), emitter = new Emitter2D();
    emitter.mode = 'livingStroke';
    const entry = drawStroke(layer, emitter, pts);
    const stroke = layer.strokes[0];
    entry.undo();
    expect(layer.strokes).toEqual([]);
    expect(layer.points).toBe(0);
    entry.redo();
    expect(layer.strokes).toEqual([stroke]);
    expect(layer.points).toBe(stroke.length);
  });
});
