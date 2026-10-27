// Study 1, 2D: one stable-fluids grid drawn with the toon renderer over a
// background color. Reference behavior: archive/2d/smoke-brush-2d-v10.html.

import '../ui/theme.css';
import { clone, DEFAULT_STYLE } from '../core/style.js';
import { SmokeLayer2D, layerParamsFromStyle } from '../sim/layer2d.js';
import { Emitter2D } from '../sim/emitters.js';
import { ToonRenderer2D, toonLookFromStyle } from '../render/toon2d.js';
import { PalettePanel } from '../ui/palette.js';
import { mountStyleUI } from '../ui/controls.js';
import { $, toggleGroup } from '../ui/dom.js';

const CELL_PX = 3;
const HINTS = {
  brush: 'Drag to draw smoke that drifts away. Hold still to let it smolder.',
  livingStroke: 'Drag to draw a line that keeps smoldering until you clear it.',
};

const canvas = $('c'); // 480 x 320 backing pixels over a 160 x 107 grid

let style = clone(DEFAULT_STYLE);
let params, look, frame = 0;
const layer = new SmokeLayer2D({ pressureIterations: 16 });
const renderer = new ToonRenderer2D(canvas, { cellSize: CELL_PX });
const emitter = new Emitter2D();

const render = () => renderer.render(layer, look, frame);
const renderIfIdle = () => {
  if (!layer.active) render();
};

/** Re-derive everything the simulation and renderer read from the style. */
function applyStyle() {
  params = layerParamsFromStyle(style);
  look = toonLookFromStyle(style);
  emitter.mode = style.emission.mode;
}

const palette = new PalettePanel(canvas.parentElement, {
  onChange(hex) {
    style.color.base = hex;
    applyStyle();
    ui.refresh();
    renderIfIdle();
  },
});

const setModeButton = toggleGroup('mode', (m) => setMode(m));
function setMode(m) {
  style.emission.mode = m;
  emitter.mode = m;
  setModeButton(m);
  $('hint').textContent = HINTS[m];
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
    renderIfIdle();
  },
  onLoad: loadStyle,
});

$('clr').onclick = () => {
  layer.clear();
  render();
};

// Pointer position in grid cells.
const toGrid = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * canvas.width) / r.width / CELL_PX, y: ((e.clientY - r.top) * canvas.height) / r.height / CELL_PX };
};
canvas.addEventListener('pointerdown', (e) => {
  palette.close();
  canvas.setPointerCapture(e.pointerId);
  emitter.begin(layer, toGrid(e), frame);
});
canvas.addEventListener('pointermove', (e) => emitter.move(toGrid(e), frame));
canvas.addEventListener('pointerup', () => emitter.end());
canvas.addEventListener('pointercancel', () => emitter.end());

function loop() {
  const wentIdle = layer.step(params, frame, 1, emitter);
  emitter.endFrame();
  // Render "on 2s" (or 1s-4s) while smoke is alive, and once more when it settles.
  if (wentIdle || (layer.active && frame % style.timing.frameStep === 0)) render();
  frame++;
  requestAnimationFrame(loop);
}

applyStyle();
ui.sync();
setMode(style.emission.mode);
palette.setColor(style.color.base, true);
render();
loop();
