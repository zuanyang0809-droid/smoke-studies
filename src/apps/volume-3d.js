// Study 3, 3D: smoke you can draw anywhere in space and orbit around.
// Three renderers read the same Style JSON:
//   fluid         a GPU smoke fluid, ray-marched as translucent layered smoke (default)
//   screen-space  curl-noise particles splatted to a screen grid, 2D toon rules (3D v2)
//   volume        the same particles in a fitted voxel grid, ray-marched surface (3D v1)
// The two particle renderers are kept for comparison: they read as liquid,
// which is what docs/3d-smoke-research.md is about.

import '../ui/theme.css';
import * as THREE from 'three';
import { History } from '../core/history.js';
import { getPresets } from '../core/style.js';
import { Particles3D, ParticleSnapshot, particleParamsFromStyle } from '../sim/particles3d.js';
import { Fluid3D, fluidParams3DFromStyle } from '../sim/fluid3d.js';
import { Emitter3D, replayStroke3D } from '../sim/emitters.js';
import { Embers3D } from '../sim/embers.js';
import { SmokeVolumeRenderer } from '../render/smoke-volume.js';
import { ScreenSpaceRenderer } from '../render/screenspace.js';
import { VolumeRenderer } from '../render/volume.js';
import { EmberPoints } from '../render/ember-points.js';
import { PalettePanel } from '../ui/palette.js';
import { mountStyleUI } from '../ui/controls.js';
import { OrbitCamera, attachOrbitInput } from '../ui/orbit.js';
import { mountPanel } from '../ui/panel.js';
import { mountBackground } from '../ui/background.js';
import { $, toggleGroup } from '../ui/dom.js';

const canvas = $('gl'), TICK_MS = 16.6;
const TIPS = {
  orbit: 'Drag to orbit · Shift + drag to draw · Right-drag to pan · Scroll to zoom',
  draw: 'Drag to draw · Shift + drag to orbit · Right-drag to pan · Scroll to zoom',
};

let style = getPresets()[0]; // starts on "Incense", like the prototype
let view = 'orbit', mode = 'fluid', pal;

// three.js setup: colors are authored in display space, so skip color management.
// Alpha so an imported photo can show through (see ui/background.js).
const gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
if (!gl.capabilities.isWebGL2) $('nogl').style.display = 'flex';
THREE.ColorManagement.enabled = false;
gl.outputColorSpace = THREE.LinearSRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
const orbit = new OrbitCamera(camera);

const particles = new Particles3D();
const fluid = new Fluid3D(gl);
const snapshot = new ParticleSnapshot();
const embers = new Embers3D();
const emitter = new Emitter3D();
const smoke = new SmokeVolumeRenderer(fluid);
const screen = new ScreenSpaceRenderer();
const volume = new VolumeRenderer(camera);
const emberPoints = new EmberPoints();
scene.add(smoke.object, screen.object, volume.object, emberPoints.object);

/** The simulation behind the active renderer; Emitter3D drives either. */
const sim = () => (mode === 'fluid' ? fluid : particles);
/** Embers in the fluid ride its tracers. */
const emberSource = () => (mode === 'fluid' ? fluid.tracers : particles);

function applyStyle() {
  particles.params = fluid.tracers.params = particleParamsFromStyle(style);
  fluid.params = fluidParams3DFromStyle(style);
  emitter.mode = style.emission.mode;
  emitter.radius = style.emission.radius;
  pal = screen.setStyle(style);
  volume.setStyle(style);
  smoke.setStyle(style);
  // With a photo behind, clear to transparent; the photo layer draws the color around it.
  gl.setClearColor(new THREE.Color(style.color.background), photo.layer.hasImage ? 0 : 1);
  emberPoints.object.visible = style.embers.enabled;
}

function resize() {
  const w = innerWidth, h = innerHeight;
  gl.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  screen.resize(w, h);
  const size = new THREE.Vector2();
  gl.getDrawingBufferSize(size);
  emberPoints.resize(size.y, camera.fov);
}
addEventListener('resize', resize);

/** Hand the current smoke to the active renderer (on the frame step). */
function present() {
  if (mode === 'fluid') smoke.update();
  else if (mode === 'screen') snapshot.capture(particles);
  else volume.update(particles);
  emberPoints.update(embers, pal, style.embers.matchSmoke, sim().frame);
}

const setRendererButton = toggleGroup('r', (r) => setRenderer(r));
function setRenderer(r) {
  // The fluid and the particles are different simulations: switching between
  // them starts a fresh scene. Screen-space and volume share the particles.
  if ((r === 'fluid') !== (mode === 'fluid')) clearScene();
  mode = r;
  setRendererButton(r);
  smoke.visible = r === 'fluid';
  screen.visible = r === 'screen';
  volume.visible = r === 'volume';
  // Ray marchers are heavier, so they render at a lower pixel ratio (as in v1).
  const dpr = window.devicePixelRatio || 1;
  gl.setPixelRatio(Math.min(dpr, r === 'screen' ? 2 : 1.5));
  resize();
  present();
}

const setViewButton = toggleGroup('v', (v) => setView(v));
function setView(v) {
  view = v;
  setViewButton(v);
  $('tip').textContent = TIPS[v];
}

const setModeButton = toggleGroup('mode', (m) => {
  style.emission.mode = m;
  syncUI();
});

const palette = new PalettePanel($('palette'), {
  onChange(hex) {
    style.color.base = hex;
    applyStyle();
    ui.refresh();
  },
});

const ui = mountStyleUI({
  getStyle: () => style,
  onChange: () => syncUI(),
  onLoad(s) {
    style = s;
    syncUI();
    photo.sync();
    palette.setColor(style.color.base, true);
  },
  overrides: { bu: { min: 0 } },
  initialPreset: 0,
});

function syncUI() {
  ui.sync();
  setModeButton(style.emission.mode);
  applyStyle();
  photo.sync();
}

// A screen-fixed photo to paint over: only the smoke orbits. Clear and undo leave it alone.
const photo = mountBackground({
  surface: canvas,
  getStyle: () => style,
  onPick: (hex) => palette.setColor(hex, true),
  onChange() {
    applyStyle();
    ui.refresh();
  },
});

// Undo / redo, one stroke at a time.
//   living stroke  taken off the emitter (its smoke fades) and put back
//   brush, fluid   the smoke is restored from a GPU snapshot; redo replays the points
//   brush, particles  the stroke's own particles are taken out and put back
let stroke = null, nextStrokeId = 1;
const chrome = mountPanel({
  undo() {
    endStroke();
    strokeHistory.undo();
    present();
  },
  redo() {
    endStroke();
    strokeHistory.redo();
    present();
  },
});
const strokeHistory = new History(30, () => chrome.syncHistory(strokeHistory));
chrome.syncHistory(strokeHistory);

function strokeEntry(target, first) {
  if (emitter.stroke) {
    const living = emitter.stroke;
    return { record() {}, undo: () => emitter.removeStroke(living), redo: () => emitter.addStroke(living) };
  }
  const points = [first], radius = emitter.radius;
  if (target === fluid) {
    let snap = before;
    return {
      record: (p) => points.push(p),
      undo: () => fluid.restore(snap),
      redo() {
        fluid.release(snap);
        snap = fluid.snapshot();
        replayStroke3D(fluid, points, radius);
      },
      dispose: () => fluid.release(snap),
    };
  }
  const id = particles.strokeId;
  let taken = null;
  return {
    record: (p) => points.push(p),
    undo: () => (taken = particles.extract(id)),
    redo: () => particles.append(taken),
  };
}

let before = null; // fluid snapshot taken as a brush stroke begins
function beginStroke(g) {
  const target = sim();
  if (target === fluid) {
    fluid.follow(g.x, g.y, g.z);
    before = fluid.snapshot(); // a full living stroke falls back to brush, so always
  } else particles.strokeId = nextStrokeId++;
  emitter.begin(target, g);
  stroke = strokeEntry(target, g);
  if (before && emitter.stroke) fluid.release(before); // fell back to a living stroke
  before = null;
  strokeHistory.push(stroke);
}

function endStroke() {
  emitter.end();
  particles.strokeId = 0;
  stroke = null;
}

function clearScene() {
  particles.clear();
  fluid.clear();
  emitter.clear();
  embers.clear();
  volume.clear();
  strokeHistory.clear();
}

$('clr').onclick = () => {
  clearScene();
  present();
};

attachOrbitInput(canvas, orbit, {
  drawMode: () => view === 'draw',
  onDrawStart(e) {
    orbit.setDrawPlane();
    const g = orbit.worldAt(e, canvas);
    if (!g) return false;
    beginStroke(g);
    return true;
  },
  onDrawMove(e) {
    const g = orbit.worldAt(e, canvas);
    if (!g || !stroke) return;
    if (mode === 'fluid') fluid.follow(g.x, g.y, g.z);
    emitter.move(sim(), g);
    stroke.record(g);
  },
  onEnd: endStroke,
});

/** Fixed 60 Hz simulation tick, independent of the display rate. */
function tick() {
  const s = sim();
  s.frame++;
  emitter.tick(s);
  s.step();
  const src = emberSource();
  embers.spawn(src, style.embers, mode === 'volume' ? volume.densityAt : undefined);
  embers.step(src);
  if (s.frame % style.timing.frameStep === 0) present();
}

let lastT = performance.now(), acc = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  acc = Math.min(acc + now - lastT, 50);
  lastT = now;
  orbit.update();
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    tick();
  }
  // The camera moves every frame; the smoke snapshot only changes on its frame step.
  if (mode === 'screen') screen.update(camera, snapshot);
  gl.render(scene, camera);
}

setView('orbit');
syncUI();
palette.setColor(style.color.base, true);
setRenderer('fluid');
orbit.place();
frame();
