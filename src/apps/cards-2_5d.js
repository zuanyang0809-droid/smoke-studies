// Study 2, 2.5D: every stroke lives on its own 2D fluid card placed in CSS
// 3D space. Shift + drag rotates the world; drawing after a rotation starts a
// new card facing the camera. Same simulation and renderer as the 2D study.
// Reference behavior: archive/2d/smoke-brush-2d-v15.html.

import '../ui/theme.css';
import { hexToRgb, PaletteCache } from '../core/color.js';
import { clone, DEFAULT_STYLE } from '../core/style.js';
import { SmokeLayer2D, layerParamsFromStyle } from '../sim/layer2d.js';
import { Emitter2D } from '../sim/emitters.js';
import { AdaptiveScheduler } from '../sim/scheduler.js';
import { toonLookFromStyle } from '../render/toon2d.js';
import { CardSpace } from '../render/css-cards.js';
import { PalettePanel } from '../ui/palette.js';
import { mountStyleUI } from '../ui/controls.js';
import { WorldTilt } from '../ui/tilt.js';
import { $, toggleGroup } from '../ui/dom.js';

const stage = $('stage'), space = $('space');

let style = clone(DEFAULT_STYLE);
let params, look, frame = 0;
let brushRGB = hexToRgb(style.color.base);
let colorMode = 'all';
let drawCard = null;

const cache = new PaletteCache(style.color.hueShift);
const emitter = new Emitter2D();
const scheduler = new AdaptiveScheduler({ budgetMs: 12, maxSkip: 2 });
const cards = new CardSpace({
  stage,
  world: $('world'),
  width: 480,
  height: 320,
  // Cards carry per-cell color and only simulate the region that holds smoke.
  createLayer: () => new SmokeLayer2D({ color: true, rgb: brushRGB, trackBounds: true, pressureIterations: 14 }),
});
const tilt = new WorldTilt(cards);

function applyStyle() {
  params = layerParamsFromStyle(style);
  look = toonLookFromStyle(style, cache);
  emitter.mode = style.emission.mode;
}

/** Idle cards are not redrawn by the loop, so redraw them after a style edit. */
function renderIdle() {
  for (const c of cards.cards) if (!c.layer.active) c.renderer.render(c.layer, look, frame);
}

function updateCount() {
  const n = cards.cards.length;
  $('pc').textContent = n
    ? `${n} ${n === 1 ? 'plane' : 'planes'}${scheduler.skip > 1 ? ` · busy planes update every ${scheduler.skip} frames` : ''}`
    : 'Draw to create a plane';
}

/** "Recolor all" repaints every card and living stroke with the new color. */
function recolorAll() {
  for (const c of cards.cards) {
    c.layer.fluid.recolor(brushRGB);
    for (const stroke of c.layer.strokes) stroke.col = brushRGB.slice();
  }
}

const palette = new PalettePanel(stage, {
  onChange(hex) {
    style.color.base = hex;
    brushRGB = hexToRgb(hex);
    emitter.rgb = brushRGB;
    if (colorMode === 'all') recolorAll();
    applyStyle();
    ui.refresh();
    renderIdle();
  },
});

const setModeButton = toggleGroup('mode', (m) => setMode(m));
function setMode(m) {
  style.emission.mode = m;
  emitter.mode = m;
  setModeButton(m);
  ui.refresh();
}

const setColorModeButton = toggleGroup('cm', (m) => setColorMode(m));
function setColorMode(m) {
  colorMode = m;
  setColorModeButton(m);
}

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
    renderIdle();
  },
  onLoad: loadStyle,
});

$('dp').oninput = (e) => {
  cards.depth = +e.target.value;
  $('dpo').textContent = (cards.depth > 0 ? '+' : '') + cards.depth + ' px';
};

$('clr').onclick = () => {
  cards.clear();
  drawCard = null;
  updateCount();
};

// Pointer: Shift + drag tilts the world, plain drag draws on a card.
function up() {
  emitter.end();
  if (tilt.active) {
    tilt.end();
    space.style.cursor = 'crosshair';
  }
}
space.addEventListener('pointerdown', (e) => {
  palette.close();
  space.setPointerCapture(e.pointerId);
  if (e.shiftKey) {
    tilt.begin(e);
    space.style.cursor = 'grabbing';
    return;
  }
  drawCard = cards.pickCard();
  updateCount();
  emitter.begin(drawCard.layer, cards.toGrid(e, drawCard), frame);
});
space.addEventListener('pointermove', (e) => {
  if (e.buttons === 0 && (emitter.down || tilt.active)) return up();
  if (tilt.active) return tilt.move(e);
  if (emitter.down) emitter.move(cards.toGrid(e, drawCard), frame);
});
space.addEventListener('pointerup', up);
space.addEventListener('pointercancel', up);
space.addEventListener('lostpointercapture', up);
space.addEventListener('dblclick', () => tilt.reset());

function loop() {
  const list = cards.cards;
  const isDraw = (c) => emitter.isDrawing(c.layer);
  const busy = (c) => c.layer.isBusy(emitter);
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

  if (frame % 30 === 0) updateCount();
  emitter.endFrame();
  frame++;
  requestAnimationFrame(loop);
}

applyStyle();
ui.sync();
setColorMode('all');
setMode(style.emission.mode);
palette.setColor(style.color.base, true);
emitter.rgb = brushRGB;
cards.apply(false);
cards.resize();
updateCount();
loop();
