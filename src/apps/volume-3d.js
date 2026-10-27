// Study 3, 3D: unbounded curl-noise particles with two interchangeable
// renderers that read the same Style JSON:
//   screen-space  splat to a screen grid, shade with the 2D toon rules (3D v2, default)
//   volume        fitted voxel grid, ray-marched toon surface (3D v1)
// Reference behavior: archive/3d/smoke-brush-3d-v2.html.

import '../ui/theme.css';
import * as THREE from 'three';
import { getPresets } from '../core/style.js';
import { Particles3D, ParticleSnapshot, particleParamsFromStyle } from '../sim/particles3d.js';
import { Emitter3D } from '../sim/emitters.js';
import { Embers3D } from '../sim/embers.js';
import { ScreenSpaceRenderer } from '../render/screenspace.js';
import { VolumeRenderer } from '../render/volume.js';
import { EmberPoints } from '../render/ember-points.js';
import { SwatchRow } from '../ui/palette.js';
import { mountStyleUI } from '../ui/controls.js';
import { OrbitCamera, attachOrbitInput } from '../ui/orbit.js';
import { $, toggleGroup } from '../ui/dom.js';

const canvas = $('gl'), HEIGHT = 440, TICK_MS = 16.6;
const TIPS = {
  orbit: 'Drag to orbit · Shift + drag to draw · Right-drag to pan · Scroll to zoom',
  draw: 'Drag to draw · Shift + drag to orbit · Right-drag to pan · Scroll to zoom',
};

let style = getPresets()[0]; // starts on "Incense", like the prototype
let view = 'orbit', mode = 'screen', pal;

// three.js setup: colors are authored in display space, so skip color management.
const gl = new THREE.WebGLRenderer({ canvas, antialias: false });
if (!gl.capabilities.isWebGL2) $('nogl').style.display = 'flex';
THREE.ColorManagement.enabled = false;
gl.outputColorSpace = THREE.LinearSRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
const orbit = new OrbitCamera(camera);

const sim = new Particles3D();
const snapshot = new ParticleSnapshot();
const embers = new Embers3D();
const emitter = new Emitter3D();
const screen = new ScreenSpaceRenderer();
const volume = new VolumeRenderer(camera);
const emberPoints = new EmberPoints();
scene.add(screen.object, volume.object, emberPoints.object);

function applyStyle() {
  sim.params = particleParamsFromStyle(style);
  emitter.mode = style.emission.mode;
  emitter.radius = style.emission.radius;
  pal = screen.setStyle(style);
  volume.setStyle(style);
  gl.setClearColor(new THREE.Color(style.color.background));
  canvas.style.background = style.color.background;
  emberPoints.object.visible = style.embers.enabled;
}

function resize() {
  const w = canvas.clientWidth || 680;
  gl.setSize(w, HEIGHT, false);
  camera.aspect = w / HEIGHT;
  camera.updateProjectionMatrix();
  screen.resize(w, HEIGHT);
  const size = new THREE.Vector2();
  gl.getDrawingBufferSize(size);
  emberPoints.resize(size.y, camera.fov);
}
new ResizeObserver(resize).observe(canvas);

/** Upload the current particles to whichever renderer is active. */
function present() {
  if (mode === 'screen') snapshot.capture(sim);
  else volume.update(sim);
  emberPoints.update(embers, pal, style.embers.matchSmoke, sim.frame);
}

const setRendererButton = toggleGroup('r', (r) => setRenderer(r));
function setRenderer(r) {
  mode = r;
  setRendererButton(r);
  screen.visible = r === 'screen';
  volume.visible = r === 'volume';
  // The ray marcher is heavier, so it renders at a lower pixel ratio (as in v1).
  gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, r === 'volume' ? 1.5 : 2));
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

const swatches = new SwatchRow($('sws'), (hex) => {
  style.color.base = hex;
  syncUI();
});

const ui = mountStyleUI({
  getStyle: () => style,
  onChange: () => syncUI(),
  onLoad(s) {
    style = s;
    syncUI();
  },
  overrides: { bu: { min: 0 } },
  initialPreset: 0,
});

function syncUI() {
  ui.sync();
  setModeButton(style.emission.mode);
  swatches.sync(style.color.base);
  applyStyle();
}

$('clr').onclick = () => {
  sim.clear();
  emitter.clear();
  embers.clear();
  volume.clear();
  present();
};

attachOrbitInput(canvas, orbit, {
  drawMode: () => view === 'draw',
  onDrawStart(e) {
    orbit.setDrawPlane();
    const g = orbit.worldAt(e, canvas);
    if (!g) return false;
    emitter.begin(sim, g);
    return true;
  },
  onDrawMove(e) {
    const g = orbit.worldAt(e, canvas);
    if (g) emitter.move(sim, g);
  },
  onEnd: () => emitter.end(),
});

/** Fixed 60 Hz simulation tick, independent of the display rate. */
function tick() {
  sim.frame++;
  emitter.tick(sim);
  sim.step();
  embers.spawn(sim, style.embers, mode === 'volume' ? volume.densityAt : undefined);
  embers.step(sim);
  if (sim.frame % style.timing.frameStep === 0) present();
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
setRenderer('screen');
orbit.place();
frame();
