// Study 1, 2D: one stable-fluids grid over the whole window, toon shaded on
// the GPU over a background color. Reference behavior: archive/2d/smoke-brush-2d-v10.html.

import '../ui/theme.css';
import { clone, DEFAULT_STYLE } from '../core/style.js';
import { SmokeLayer2D, layerParamsFromStyle } from '../sim/layer2d.js';
import { Emitter2D } from '../sim/emitters.js';
import { gridForViewport } from '../sim/fluid2d.js';
import { toonLookFromStyle } from '../render/toon2d.js';
import { ToonRendererGL } from '../render/toon-gl.js';
import { cardMatrix, PERSPECTIVE } from '../render/card-space.js';
import { PalettePanel } from '../ui/palette.js';
import { mountStyleUI } from '../ui/controls.js';
import { mountPanel } from '../ui/panel.js';
import { $, toggleGroup } from '../ui/dom.js';

const HINTS = {
  brush: 'Drag to draw smoke that drifts away. Hold still to let it smolder.',
  livingStroke: 'Drag to draw a line that keeps smoldering until you clear it.',
};

const canvas = $('gl');
const renderer = new ToonRendererGL(canvas);
if (!renderer.ok) $('nogl').style.display = 'flex';

let style = clone(DEFAULT_STYLE);
let params, look, frame = 0;
const emitter = new Emitter2D();
const view = { width: innerWidth, height: innerHeight, perspective: PERSPECTIVE };

/** The single layer is a card facing the camera that covers the window. */
const card = { rx: 0, ry: 0, z: 0, layer: null };
/** A grid with the window's aspect; a new one is made on Clear after a resize. */
function newLayer() {
  const { nx, ny } = gridForViewport(view.width, view.height);
  card.layer = new SmokeLayer2D({ nx, ny, pressureIterations: 16 });
}
newLayer();

let needsUpload = true;
const upload = () => {
  renderer.upload(card, look, frame);
  needsUpload = false;
};
const draw = () => renderer.draw([{ card, matrix: cardMatrix(card, card, view.width, view.height, view.perspective) }], look, view);

/** Re-derive everything the simulation and renderer read from the style. */
function applyStyle() {
  params = layerParamsFromStyle(style);
  look = toonLookFromStyle(style);
  emitter.mode = style.emission.mode;
  needsUpload = true; // ember colors are baked at upload
}

const palette = new PalettePanel($('palette'), {
  onChange(hex) {
    style.color.base = hex;
    applyStyle();
    ui.refresh();
  },
});

const setModeButton = toggleGroup('mode', (m) => setMode(m));
function setMode(m) {
  style.emission.mode = m;
  emitter.mode = m;
  setModeButton(m);
  $('tip').textContent = HINTS[m];
  ui.refresh();
}

/** Load a whole style (preset, saved effect or edited JSON). */
function loadStyle(s) {
  style = s;
  ui.sync();
  setMode(style.emission.mode);
  palette.setColor(style.color.base, true);
}

const ui = mountStyleUI({
  getStyle: () => style,
  onChange() {
    applyStyle();
    ui.refresh();
  },
  onLoad: loadStyle,
});

mountPanel({ undo() {}, redo() {} });

$('clr').onclick = () => {
  newLayer();
  needsUpload = true;
};

function resize() {
  view.width = innerWidth;
  view.height = innerHeight;
  renderer.resize(view.width, view.height);
}
addEventListener('resize', resize);

// Pointer position in grid cells (the grid spans the window).
const toGrid = (e) => ({ x: (e.clientX / view.width) * card.layer.fluid.nx, y: (e.clientY / view.height) * card.layer.fluid.ny });
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  emitter.begin(card.layer, toGrid(e), frame);
});
canvas.addEventListener('pointermove', (e) => emitter.move(toGrid(e), frame));
canvas.addEventListener('pointerup', () => emitter.end());
canvas.addEventListener('pointercancel', () => emitter.end());

function loop() {
  const layer = card.layer;
  const wentIdle = layer.step(params, frame, 1, emitter);
  emitter.endFrame();
  // Snapshot "on 2s" (or 1s-4s) while smoke is alive, and once more when it settles.
  if (wentIdle || (layer.active && frame % style.timing.frameStep === 0)) needsUpload = true;
  if (renderer.ok) {
    if (needsUpload) upload();
    draw();
  }
  frame++;
  requestAnimationFrame(loop);
}

applyStyle();
ui.sync();
setMode(style.emission.mode);
palette.setColor(style.color.base, true);
resize();
loop();
