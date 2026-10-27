// Study 1, 2D: one stable-fluids grid over the whole window, toon shaded on
// the GPU over a background color. Reference behavior: archive/2d/smoke-brush-2d-v10.html.

import '../ui/theme.css';
import { History } from '../core/history.js';
import { clone, DEFAULT_STYLE } from '../core/style.js';
import { SmokeLayer2D, layerParamsFromStyle } from '../sim/layer2d.js';
import { Emitter2D } from '../sim/emitters.js';
import { gridForViewport, gridMismatch } from '../sim/fluid2d.js';
import { strokeEntry2D } from '../sim/undo2d.js';
import { toonLookFromStyle } from '../render/toon2d.js';
import { ToonRendererGL } from '../render/toon-gl.js';
import { cardMatrix, PERSPECTIVE } from '../render/card-space.js';
import { PalettePanel } from '../ui/palette.js';
import { mountStyleUI } from '../ui/controls.js';
import { mountPanel } from '../ui/panel.js';
import { mountBackground } from '../ui/background.js';
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
/**
 * A grid with the window's aspect. After a resize (or when a page loaded
 * hidden, at 0 x 0, is shown) the grid is rebuilt as soon as it holds no
 * smoke, so strokes always have the same cell size as at load.
 */
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
  photo.sync();
  setMode(style.emission.mode);
  palette.setColor(style.color.base, true);
}

const ui = mountStyleUI({
  getStyle: () => style,
  onChange() {
    applyStyle();
    photo.sync(); // the background color shows around a contained photo
    ui.refresh();
  },
  onLoad: loadStyle,
});

// A photo to paint over; Clear and undo leave it alone.
const photo = mountBackground({
  surface: canvas,
  getStyle: () => style,
  onPick: (hex) => palette.setColor(hex, true),
  onChange() {
    renderer.transparent = photo.layer.hasImage;
    ui.refresh();
  },
});

// Undo / redo, one stroke at a time.
let stroke = null; // history entry of the stroke being drawn
const afterHistory = () => {
  if (renderer.ok) renderer.upload(card, look, frame, true);
};
const chrome = mountPanel({
  undo() {
    endStroke();
    if (strokeHistory.undo()) afterHistory();
  },
  redo() {
    endStroke();
    if (strokeHistory.redo()) afterHistory();
  },
});
const strokeHistory = new History(30, () => chrome.syncHistory(strokeHistory));
chrome.syncHistory(strokeHistory);

$('clr').onclick = () => {
  newLayer();
  strokeHistory.clear();
  needsUpload = true;
};

function resize() {
  view.width = innerWidth;
  view.height = innerHeight;
  renderer.resize(view.width, view.height);
}

/** Rebuild a grid that no longer fits the window once nothing is drawn on it. */
function refitGrid() {
  const layer = card.layer;
  if (emitter.down || layer.active || layer.strokes.length || !gridMismatch(layer.fluid, view.width, view.height)) return;
  newLayer();
  strokeHistory.clear(); // its snapshots belong to the old grid
  needsUpload = true;
}
addEventListener('resize', resize);

// Pointer position in grid cells (the grid spans the window).
const toGrid = (e) => ({ x: (e.clientX / view.width) * card.layer.fluid.nx, y: (e.clientY / view.height) * card.layer.fluid.ny });
function endStroke() {
  emitter.end();
  stroke = null;
}
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = toGrid(e), before = card.layer.fluid.snapshot();
  emitter.begin(card.layer, p, frame);
  stroke = strokeEntry2D(card.layer, emitter, before, p, () => frame);
  strokeHistory.push(stroke);
});
canvas.addEventListener('pointermove', (e) => {
  if (!emitter.down) return;
  const p = toGrid(e);
  emitter.move(p, frame);
  stroke.record(p);
});
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

function loop() {
  refitGrid();
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
