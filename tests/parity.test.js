// Parity with the archived prototypes: the same scripted input and the same
// seeded random numbers must give bit-identical simulation state and pixels.
// This is what "the refactor kept the behavior" means in practice.

import { afterEach, describe, expect, it, vi } from 'vitest';

// Each case simulates a few hundred frames on the CPU.
vi.setConfig({ testTimeout: 60_000 });
import * as THREE from 'three';
import { fakeContext2D, fakeElement, loadPrototype, maxDiff, seeded } from './helpers/prototype.js';
import { DEFAULT_STYLE, getPresets, mergeStyle } from '../src/core/style.js';

const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
  vi.unstubAllGlobals();
});

/** Fresh module graph with Math.random seeded before the noise table is built. */
async function importModules(seed, paths) {
  vi.resetModules();
  Math.random = seeded(seed);
  return Promise.all(paths.map((p) => import(p)));
}

const ev = (x, y, shiftKey = false) => ({ clientX: x, clientY: y, pointerId: 1, buttons: 1, button: 0, shiftKey });

describe('2D brush vs archive/2d/smoke-brush-2d-v10.html', () => {
  // frame -> [action, x, y] in canvas pixels
  const script = (f) => {
    if (f === 3) return ['down', 120, 220];
    if (f > 3 && f <= 40) return ['move', 120 + (f - 3) * 7, 220 - (f - 3) * 2 + Math.sin(f) * 8];
    if (f === 70) return ['up'];
    if (f === 90) return ['down', 300, 260];
    if (f > 90 && f <= 110) return ['move', 300 - (f - 90) * 5, 260 - (f - 90) * 3];
    if (f === 112) return ['up'];
    return null;
  };

  for (const mode of ['brush', 'livingStroke']) {
    it(`matches in ${mode} mode`, async () => {
      const SEED = 1234, FRAMES = 220, CHECK = [30, 100, 220];

      const P = loadPrototype('2d/smoke-brush-2d-v10.html', SEED);
      if (mode === 'livingStroke') P.run("setMode('trail')");
      const L = P.els.c.listeners, proto = {};
      for (let f = 1; f <= FRAMES; f++) {
        const a = script(f);
        if (a?.[0] === 'down') L.pointerdown[0](ev(a[1], a[2]));
        else if (a?.[0] === 'move') L.pointermove[0](ev(a[1], a[2]));
        else if (a?.[0] === 'up') L.pointerup[0]();
        P.run('loop()');
        if (CHECK.includes(f)) proto[f] = { d: Float32Array.from(P.run('d')), px: Uint8ClampedArray.from(P.run('D')), embers: P.run('embers.length') };
      }

      const [{ SmokeLayer2D, layerParamsFromStyle }, { Emitter2D }, { ToonRenderer2D, toonLookFromStyle }] = await importModules(SEED, [
        '../src/sim/layer2d.js', '../src/sim/emitters.js', '../src/render/toon2d.js',
      ]);
      // The prototype painted over #1a1d21; the default background is black now.
      const style = mergeStyle(DEFAULT_STYLE, { emission: { mode }, color: { background: '#1a1d21' } });
      const ctx = fakeContext2D();
      const layer = new SmokeLayer2D({ pressureIterations: 16 });
      const renderer = new ToonRenderer2D({ width: 480, height: 320, getContext: () => ctx }, { cellSize: 3 });
      const emitter = new Emitter2D();
      emitter.mode = mode;
      const params = layerParamsFromStyle(style), look = toonLookFromStyle(style);
      let frame = 0;
      const loop = () => {
        const wentIdle = layer.step(params, frame, 1, emitter);
        emitter.endFrame();
        if (wentIdle || (layer.active && frame % 2 === 0)) renderer.render(layer, look, frame);
        frame++;
      };
      const toGrid = (x, y) => ({ x: (x * 480) / 480 / 3, y: (y * 320) / 320 / 3 });
      renderer.render(layer, look, frame); // the prototype renders and runs one frame at load
      loop();
      for (let f = 1; f <= FRAMES; f++) {
        const a = script(f);
        if (a?.[0] === 'down') emitter.begin(layer, toGrid(a[1], a[2]), frame);
        else if (a?.[0] === 'move') emitter.move(toGrid(a[1], a[2]), frame);
        else if (a?.[0] === 'up') emitter.end();
        loop();
        if (CHECK.includes(f)) {
          expect(maxDiff(proto[f].d, layer.fluid.d), `density @${f}`).toBe(0);
          expect(maxDiff(proto[f].px, renderer.image.data), `pixels @${f}`).toBe(0);
          expect(layer.embers.count).toBe(proto[f].embers);
        }
      }
    });
  }
});

describe('2.5D cards vs archive/2d/smoke-brush-2d-v15.html', () => {
  const rect = { left: 0, top: 0, width: 680, height: 453 };
  const script = (f) => {
    const seg = (s, e) => f > s && f <= e;
    if (f === 3) return ['down', 200, 200];
    if (seg(3, 25)) return ['move', 200 + (f - 3) * 9, 200 - (f - 3) * 3];
    if (f === 26) return ['up'];
    if (f === 30) return ['down', 340, 226, true];
    if (seg(30, 40)) return ['move', 340 + (f - 30) * 8, 226, true];
    if (f === 41) return ['up'];
    if (f === 45) return ['mode'];
    if (f === 46) return ['down', 300, 150];
    if (seg(46, 70)) return ['move', 300 + (f - 46) * 6, 150 + Math.sin(f * 0.4) * 30];
    if (f === 71) return ['up'];
    if (f === 75) return ['color', '#c4467f'];
    if (f === 80) return ['down', 340, 226, true];
    if (seg(80, 88)) return ['move', 340, 226 - (f - 80) * 7, true];
    if (f === 89) return ['up'];
    if (f === 90) return ['depth', 100];
    if (f === 93) return ['down', 400, 300];
    if (seg(93, 110)) return ['move', 400 - (f - 93) * 8, 300 - (f - 93) * 4];
    if (f === 111) return ['up'];
    return null;
  };
  // Deterministic clock so the adaptive scheduler makes the same choices.
  const clock = () => {
    let t = 0;
    return { now: () => (t += 4.5) };
  };

  it('matches every card, including frames the scheduler skips', async () => {
    const SEED = 99, FRAMES = 200, CHECK = [24, 60, 100, 140, 200];

    const P = loadPrototype('2d/smoke-brush-2d-v15.html', SEED, { elements: { stage: { getBoundingClientRect: () => rect } } });
    P.context.performance = clock();
    P.run('resize()');
    const L = P.els.space.listeners, proto = {};
    for (let f = 1; f <= FRAMES; f++) {
      const a = script(f);
      if (a?.[0] === 'down') L.pointerdown[0](ev(a[1], a[2], a[3]));
      else if (a?.[0] === 'move') L.pointermove[0](ev(a[1], a[2], a[3]));
      else if (a?.[0] === 'up') L.pointerup[0]();
      else if (a?.[0] === 'mode') P.run("setMode('trail')");
      else if (a?.[0] === 'color') P.run(`setColor('${a[1]}', true)`);
      else if (a?.[0] === 'depth') P.run(`depth = ${a[1]}`);
      P.run('loop()');
      if (CHECK.includes(f)) {
        proto[f] = P.run('({ skip: skipN, cards: cards.map((c) => ({ d: Float32Array.from(c.d), cr: Float32Array.from(c.cr), px: Uint8ClampedArray.from(c.img.data), bb: c.bb && c.bb.slice(), prc: c.prc })) })');
      }
    }

    vi.stubGlobal('performance', clock());
    vi.stubGlobal('document', { createElement: () => fakeElement() });
    vi.stubGlobal('ResizeObserver', class { observe() {} });
    const [{ hexToRgb, PaletteCache }, { SmokeLayer2D, layerParamsFromStyle }, { Emitter2D }, { AdaptiveScheduler }, { toonLookFromStyle }, { CardSpace }, { WorldTilt }] = await importModules(SEED, [
      '../src/core/color.js', '../src/sim/layer2d.js', '../src/sim/emitters.js', '../src/sim/scheduler.js',
      '../src/render/toon2d.js', '../src/render/css-cards.js', '../src/ui/tilt.js',
    ]);
    // Same wiring as src/apps/cards-2_5d.js.
    const style = mergeStyle(DEFAULT_STYLE, {});
    let brushRGB = hexToRgb(style.color.base), frame = 0, drawCard = null;
    const cache = new PaletteCache(style.color.hueShift), emitter = new Emitter2D(), scheduler = new AdaptiveScheduler({ budgetMs: 12, maxSkip: 2 });
    const cards = new CardSpace({
      stage: fakeElement({ getBoundingClientRect: () => rect }), world: fakeElement(), width: 480, height: 320,
      createLayer: () => new SmokeLayer2D({ color: true, rgb: brushRGB, trackBounds: true, pressureIterations: 14 }),
    });
    const tilt = new WorldTilt(cards);
    const params = layerParamsFromStyle(style);
    let look = toonLookFromStyle(style, cache);
    emitter.rgb = brushRGB;
    cards.resize();
    const loop = () => {
      const list = cards.cards, isDraw = (c) => emitter.isDrawing(c.layer), busy = (c) => c.layer.isBusy(emitter);
      scheduler.beginFrame(list.filter((c) => busy(c) && !isDraw(c)).length, emitter.down);
      for (let i = 0; i < list.length; i++) {
        const c = list[i], drawing = isDraw(c);
        if (!scheduler.shouldStep(i, frame, drawing, busy(c))) continue;
        const t0 = performance.now(), was = c.layer.active;
        if (c.layer.step(params, frame, scheduler.timeScale(drawing), emitter)) c.renderer.clear();
        if (c.layer.active && frame - c.lastRender >= style.timing.frameStep) {
          c.renderer.render(c.layer, look, frame);
          c.lastRender = frame;
        }
        if (was || c.layer.active) scheduler.record(performance.now() - t0);
      }
      scheduler.endFrame();
      emitter.endFrame();
      frame++;
    };
    loop();
    for (let f = 1; f <= FRAMES; f++) {
      const a = script(f), e = a && ev(a[1], a[2], a[3]);
      if (a?.[0] === 'down') {
        if (e.shiftKey) tilt.begin(e);
        else {
          drawCard = cards.pickCard();
          emitter.begin(drawCard.layer, cards.toGrid(e, drawCard), frame);
        }
      } else if (a?.[0] === 'move') {
        if (tilt.active) tilt.move(e);
        else if (emitter.down) emitter.move(cards.toGrid(e, drawCard), frame);
      } else if (a?.[0] === 'up') {
        emitter.end();
        tilt.end();
      } else if (a?.[0] === 'mode') emitter.mode = 'livingStroke';
      else if (a?.[0] === 'color') {
        style.color.base = a[1];
        brushRGB = emitter.rgb = hexToRgb(a[1]);
        for (const c of cards.cards) {
          c.layer.fluid.recolor(brushRGB);
          for (const s of c.layer.strokes) s.col = brushRGB.slice();
        }
        look = toonLookFromStyle(style, cache);
        for (const c of cards.cards) if (!c.layer.active) c.renderer.render(c.layer, look, frame);
      } else if (a?.[0] === 'depth') cards.depth = a[1];
      loop();
      if (CHECK.includes(f)) {
        const p = proto[f];
        expect(cards.cards.length, `cards @${f}`).toBe(p.cards.length);
        expect(scheduler.skip, `skip @${f}`).toBe(p.skip);
        p.cards.forEach((pc, i) => {
          const m = cards.cards[i];
          expect(maxDiff(pc.d, m.layer.fluid.d), `card ${i} density @${f}`).toBe(0);
          expect(maxDiff(pc.cr, m.layer.fluid.cr), `card ${i} color @${f}`).toBe(0);
          expect(maxDiff(pc.px, m.renderer.image.data), `card ${i} pixels @${f}`).toBe(0);
          expect(m.layer.fluid.bounds).toEqual(pc.bb);
          expect(m.renderer.prevRect).toEqual(pc.prc);
        });
      }
    }
    expect(Object.values(proto).some((p) => p.skip > 1)).toBe(true);
  });
});

describe('3D vs archive/3d (v2 screen-space, v1 volume)', () => {
  const rect = { left: 0, top: 0, width: 680, height: 440 };
  class FakeWebGL {
    capabilities = { isWebGL2: true };
    setPixelRatio() {}
    setSize() {}
    setClearColor() {}
    render() {}
    getDrawingBufferSize(v) {
      return v.set(680, 440);
    }
  }
  const script = (f) => {
    if (f === 3) return ['down', 250, 300];
    if (f > 3 && f <= 30) return ['move', 250 + (f - 3) * 7, 300 - (f - 3) * 5];
    if (f === 60) return ['up'];
    if (f === 70) return ['mode'];
    if (f === 72) return ['down', 400, 320];
    if (f > 72 && f <= 90) return ['move', 400 - (f - 72) * 6, 320 - (f - 72) * 2];
    if (f === 91) return ['up'];
    return null;
  };

  for (const renderer of ['screen', 'volume']) {
    it(`matches particles, embers and the ${renderer} texture`, async () => {
      const SEED = 7, FRAMES = 160, CHECK = [40, 100, 160], PRESET = 2; // Lavender blast: embers on
      const file = renderer === 'screen' ? '3d/smoke-brush-3d-v2.html' : '3d/smoke-brush-3d-v1.html';
      const canvas = fakeElement({ clientWidth: 680, getBoundingClientRect: () => rect });
      const P = loadPrototype(file, SEED, { elements: { gl: canvas }, globals: { THREE: { ...THREE, WebGLRenderer: FakeWebGL, ColorManagement: {} } } });
      P.run(`S = clone(PRESETS[${PRESET}]); syncUI(); setView('draw')`);
      const L = P.els.gl.listeners, proto = {};
      for (let f = 1; f <= FRAMES; f++) {
        const a = script(f);
        if (a?.[0] === 'down') L.pointerdown[0](ev(a[1], a[2]));
        else if (a?.[0] === 'move') L.pointermove[0](ev(a[1], a[2]));
        else if (a?.[0] === 'up') L.pointerup[0]();
        else if (a?.[0] === 'mode') P.run("S.emission.mode = 'livingStroke'; syncUI(true)");
        // v1 relies on renderer.render() to update the camera matrices.
        P.run(`placeCam(); camera.updateMatrixWorld(); fr++; simTick(); ${renderer === 'screen' ? 'project()' : ''}`);
        if (CHECK.includes(f)) {
          proto[f] = P.run(`({ np, px: Float32Array.from(px.subarray(0, np)), ePos: Float32Array.from(ePos), embers: embers.length, tex: Uint8Array.from(${renderer === 'screen' ? 'gData' : 'texData'}) })`);
        }
      }

      const random = seeded(SEED);
      vi.resetModules();
      Math.random = random;
      await import('../src/core/noise.js'); // the permutation table takes the first draws, as in the prototype
      Math.random = seeded(1); // three.js draws UUIDs while objects are created; keep them off the seeded stream
      const [{ Particles3D, ParticleSnapshot, particleParamsFromStyle }, { Emitter3D }, { Embers3D }, { ScreenSpaceRenderer }, { VolumeRenderer }, { EmberPoints }, { OrbitCamera }] = await Promise.all([
        import('../src/sim/particles3d.js'), import('../src/sim/emitters.js'), import('../src/sim/embers.js'),
        import('../src/render/screenspace.js'), import('../src/render/volume.js'), import('../src/render/ember-points.js'), import('../src/ui/orbit.js'),
      ]);
      // Same wiring as src/apps/volume-3d.js.
      const style = getPresets()[PRESET];
      const camera = new THREE.PerspectiveCamera(45, 680 / 440, 0.01, 100), orbit = new OrbitCamera(camera);
      const sim = new Particles3D(), snapshot = new ParticleSnapshot(), embers = new Embers3D(), emitter = new Emitter3D();
      const screen = new ScreenSpaceRenderer(), volume = new VolumeRenderer(camera), points = new EmberPoints();
      let pal;
      const applyStyle = () => {
        sim.params = particleParamsFromStyle(style);
        emitter.mode = style.emission.mode;
        emitter.radius = style.emission.radius;
        pal = screen.setStyle(style);
        volume.setStyle(style);
      };
      camera.updateProjectionMatrix();
      screen.resize(680, 440);
      applyStyle();
      Math.random = random;
      const present = () => {
        if (renderer === 'screen') snapshot.capture(sim);
        else volume.update(sim);
        points.update(embers, pal, style.embers.matchSmoke, sim.frame);
      };
      const tick = () => {
        sim.frame++;
        emitter.tick(sim);
        sim.step();
        embers.spawn(sim, style.embers, renderer === 'volume' ? volume.densityAt : undefined);
        embers.step(sim);
        if (sim.frame % style.timing.frameStep === 0) present();
      };
      let drawing = false;
      for (let f = 1; f <= FRAMES; f++) {
        const a = script(f);
        if (a?.[0] === 'down') {
          orbit.setDrawPlane();
          const g = orbit.worldAt(ev(a[1], a[2]), canvas);
          if (g) {
            emitter.begin(sim, g);
            drawing = true;
          }
        } else if (a?.[0] === 'move' && drawing) {
          const g = orbit.worldAt(ev(a[1], a[2]), canvas);
          if (g) emitter.move(sim, g);
        } else if (a?.[0] === 'up') {
          drawing = false;
          emitter.end();
        } else if (a?.[0] === 'mode') {
          style.emission.mode = 'livingStroke';
          applyStyle();
        }
        orbit.place();
        tick();
        if (renderer === 'screen') screen.update(camera, snapshot);
        if (CHECK.includes(f)) {
          const p = proto[f];
          expect(sim.count, `particles @${f}`).toBe(p.np);
          expect(maxDiff(p.px, sim.px.subarray(0, sim.count)), `positions @${f}`).toBe(0);
          expect(embers.list.length, `embers @${f}`).toBe(p.embers);
          expect(maxDiff(p.ePos, points.pos), `ember positions @${f}`).toBe(0);
          expect(maxDiff(p.tex, renderer === 'screen' ? screen.data : volume.data), `texture @${f}`).toBe(0);
        }
      }
    });
  }
});
