// Landing page: three tiles, each a small live demo of its study made with
// the real engines at low resolution. Every few seconds a tile "clicks once":
// a short dab of smoke that rises and fades, at a slightly different place
// and color each time. Tiles pause off screen and while the tab is hidden;
// with reduced motion each shows one still frame.

import '../ui/theme.css';
import * as THREE from 'three';
import { hexToRgb } from '../core/color.js';
import { clone, DEFAULT_STYLE, getPresets } from '../core/style.js';
import { SmokeLayer2D, layerParamsFromStyle } from '../sim/layer2d.js';
import { Emitter2D, Emitter3D } from '../sim/emitters.js';
import { particleParamsFromStyle } from '../sim/particles3d.js';
import { Fluid3D, fluidParams3DFromStyle } from '../sim/fluid3d.js';
import { toonLookFromStyle } from '../render/toon2d.js';
import { ToonRendererGL } from '../render/toon-gl.js';
import { CardSpace, cardMatrix } from '../render/card-space.js';
import { SmokeVolumeRenderer } from '../render/smoke-volume.js';
import { OrbitCamera } from '../ui/orbit.js';

const LOOP = 170; // frames between dabs
const N2D = 44; // grid cells across a 2D / 2.5D tile: coarse, so a puff reads at tile size
const COLORS = ['#8a8f99', '#9b8fb0', '#8fa39a', '#a8998a', '#8b5cc7', '#62905f'];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Dab n of a tile: where (0..1 across the tile) and which color. */
function dabFor(n) {
  const r = (k) => (Math.sin(n * 12.9898 + k * 78.233) * 43758.5453) % 1;
  return { x: 0.35 + Math.abs(r(1)) * 0.3, y: 0.66 + Math.abs(r(2)) * 0.1, color: COLORS[n % COLORS.length] };
}

/** A dab is a short press: a few small moves, then holding still so it smolders. */
function dabPhase(t) {
  return t === 0 ? 'down' : t < 8 ? 'move' : t < 60 ? 'hold' : t === 60 ? 'up' : null;
}

/** The default look, with puffs that linger a little so each tile stays readable. */
function tileStyle() {
  const s = clone(DEFAULT_STYLE);
  s.motion.dissipation = 0.2;
  return s;
}

class Tile2D {
  constructor(canvas) {
    this.renderer = new ToonRendererGL(canvas);
    this.style = tileStyle();
    this.layer = new SmokeLayer2D({ nx: N2D, ny: N2D, pressureIterations: 12 });
    this.card = { rx: 0, ry: 0, z: 0, layer: this.layer };
    this.emitter = new Emitter2D();
    this.frame = 0;
    this.n = 0;
    this.view = { width: 1, height: 1, perspective: 1100 };
    this._applyStyle();
  }

  _applyStyle() {
    this.params = layerParamsFromStyle(this.style);
    this.look = toonLookFromStyle(this.style);
  }

  resize(w, h) {
    this.view.width = w;
    this.view.height = h;
    this.renderer.resize(w, h);
  }

  step() {
    const t = this.frame % LOOP, phase = dabPhase(t), { nx, ny } = this.layer.fluid;
    if (t === 0) {
      this.dab = dabFor(this.n++);
      this.style.color.base = this.dab.color;
      this._applyStyle();
    }
    const p = { x: this.dab.x * nx + t * 0.4, y: this.dab.y * ny - t * 0.2 };
    if (phase === 'down') this.emitter.begin(this.layer, p, this.frame);
    else if (phase === 'move') this.emitter.move(p, this.frame);
    else if (phase === 'up') this.emitter.end();
    const wentIdle = this.layer.step(this.params, this.frame, 1, this.emitter);
    this.emitter.endFrame();
    if (wentIdle || (this.layer.active && this.frame % 2 === 0)) this.renderer.upload(this.card, this.look, this.frame);
    this.frame++;
  }

  draw() {
    const v = this.view;
    this.renderer.draw([{ card: this.card, matrix: cardMatrix(this.card, this.card, v.width, v.height, v.perspective) }], this.look, v);
  }
}

class Tile25D {
  constructor(canvas) {
    this.renderer = new ToonRendererGL(canvas);
    this.style = tileStyle();
    this.params = layerParamsFromStyle(this.style);
    this.look = toonLookFromStyle(this.style);
    this.cards = new CardSpace({ width: 270, height: 270, createLayer: () => null });
    // Three planes at different angles and depths, each with its own puffs.
    for (const [rx, ry, z] of [[0, -38, -160], [8, 0, 0], [-6, 38, 160]]) {
      this.cards.cards.push({ rx, ry, z, layer: new SmokeLayer2D({ nx: N2D, ny: N2D, color: true, trackBounds: true, pressureIterations: 10 }), lastRender: 0 });
    }
    this.emitter = new Emitter2D();
    this.frame = 0;
    this.n = 0;
    this.view = { width: 1, height: 1, perspective: 1 };
    // Faint card frames on an overlay, so the separate planes read even between puffs.
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'tile-overlay';
    canvas.after(this.overlay);
  }

  resize(w, h) {
    this.cards.setViewport(w, h);
    this.view = { width: w, height: h, perspective: this.cards.perspective };
    this.renderer.resize(w, h);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.round(w * dpr);
    this.overlay.height = Math.round(h * dpr);
    this.overlay.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Card corners through the same matrices as the smoke, drawn as thin outlines. */
  _drawFrames(list) {
    const ctx = this.overlay.getContext('2d'), { width: w, height: h } = this.view, inset = 0.34;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    for (const { matrix: m } of list) {
      ctx.beginPath();
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy], i) => {
        const x = sx * w * inset, y = sy * h * inset;
        const cw = m[3] * x + m[7] * y + m[15];
        const px = ((m[0] * x + m[4] * y + m[12]) / cw * 0.5 + 0.5) * w;
        const py = (0.5 - (m[1] * x + m[5] * y + m[13]) / cw * 0.5) * h;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();
    }
  }

  step() {
    // Planes take turns, faster than the other tiles so all three hold smoke
    // at once; each plane has its own slot (left, middle, right).
    const loop = Math.round(LOOP * 0.42), t = this.frame % loop, phase = dabPhase(t);
    if (t === 0) {
      const i = this.n % 3, d = dabFor(this.n);
      this.dab = { ...d, x: 0.24 + i * 0.26 + (d.x - 0.5) * 0.1, card: this.cards.cards[i] };
      this.emitter.rgb = hexToRgb(this.dab.color);
      this.n++;
    }
    const { layer } = this.dab.card, p = { x: this.dab.x * N2D + t * 0.4, y: this.dab.y * N2D - t * 0.2 };
    if (phase === 'down') this.emitter.begin(layer, p, this.frame);
    else if (phase === 'move') this.emitter.move(p, this.frame);
    else if (phase === 'up') this.emitter.end();
    for (const c of this.cards.cards) {
      const wentIdle = c.layer.step(this.params, this.frame, 1, this.emitter);
      if (wentIdle || (c.layer.active && this.frame - c.lastRender >= 2)) {
        this.renderer.upload(c, this.look, this.frame);
        c.lastRender = this.frame;
      }
    }
    this.emitter.endFrame();
    // A slow sway, so the separate planes read.
    this.cards.ry = this.cards.shown.ry = 28 * Math.sin(this.frame * 0.006);
    this.cards.rx = this.cards.shown.rx = -10 + 6 * Math.sin(this.frame * 0.004);
    this.frame++;
  }

  draw() {
    const list = this.cards.drawList();
    this.renderer.draw(list, this.look, this.view);
    this._drawFrames(list);
  }
}

class Tile3D {
  constructor(canvas) {
    const gl = (this.gl = new THREE.WebGLRenderer({ canvas, antialias: false }));
    THREE.ColorManagement.enabled = false;
    gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.style = getPresets()[2]; // Lavender blast reads well small
    this.style.embers.enabled = false;
    gl.setClearColor(new THREE.Color(this.style.color.background));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.fluid = new Fluid3D(gl, { nx: 40, ny: 64, nz: 40 });
    this.fluid.params = fluidParams3DFromStyle(this.style);
    this.fluid.tracers.params = particleParamsFromStyle(this.style);
    this.smoke = new SmokeVolumeRenderer(this.fluid);
    this.scene.add(this.smoke.object);
    this.orbit = new OrbitCamera(this.camera);
    const f = this.fluid, b = f.boxMin, v = f.voxel;
    this.orbit.target.set(b.x + f.n[0] * v * 0.5, b.y + f.n[1] * v * 0.48, b.z + f.n[2] * v * 0.5);
    this.orbit.radius = 1.7;
    this.orbit.phi = 1.4;
    this.emitter = new Emitter3D();
    this.n = 0;
  }

  resize(w, h) {
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  step() {
    const f = this.fluid, t = f.frame % LOOP, phase = dabPhase(t);
    if (t === 0) {
      this.dab = dabFor(this.n++);
      this.style.color.base = this.dab.color;
      this.smoke.setStyle(this.style);
      this.emitter.radius = 1;
    }
    const b = f.boxMin, v = f.voxel, [nx, ny, nz] = f.n;
    const g = { x: b.x + (this.dab.x * nx + t * 0.3) * v, y: b.y + ny * 0.22 * v, z: b.z + (nz * 0.5 + (this.dab.x - 0.5) * 10) * v };
    f.frame++;
    if (phase === 'down') this.emitter.begin(f, g);
    else if (phase === 'move') this.emitter.move(f, g);
    else if (phase === 'up') this.emitter.end();
    this.emitter.tick(f);
    f.step();
    if (f.frame % 2 === 0) this.smoke.update();
    this.orbit.theta += 0.003; // slow orbit
  }

  draw() {
    this.orbit.place();
    this.gl.render(this.scene, this.camera);
  }
}

const TILES = { '2d': Tile2D, '2_5d': Tile25D, '3d': Tile3D };
const tiles = [];
for (const canvas of document.querySelectorAll('canvas[data-tile]')) {
  let tile;
  try {
    tile = new TILES[canvas.dataset.tile](canvas);
  } catch (e) {
    continue; // no WebGL2: the tile stays a plain dark square
  }
  if (tile.renderer && !tile.renderer.ok) continue;
  tile.canvas = canvas;
  tile.visible = true;
  tiles.push(tile);
}

function resize() {
  for (const t of tiles) {
    const r = t.canvas.getBoundingClientRect();
    if (r.width) t.resize(r.width, r.height);
  }
}
addEventListener('resize', resize);
resize();

// Only tiles on screen run.
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const t = tiles.find((x) => x.canvas === e.target);
    if (t) t.visible = e.isIntersecting;
  }
});
tiles.forEach((t) => io.observe(t.canvas));

if (reducedMotion) {
  // One still frame: a puff part way through its life.
  for (const t of tiles) {
    for (let i = 0; i < 70; i++) t.step();
    t.draw();
  }
} else {
  const loop = () => {
    requestAnimationFrame(loop);
    if (document.hidden) return;
    for (const t of tiles) {
      if (!t.visible) continue;
      t.step();
      t.draw();
    }
  };
  loop();
}
