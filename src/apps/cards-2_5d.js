// Study 2, 2.5D: every stroke lives on its own 2D fluid card placed in 3D
// space. Shift + drag rotates the world (freely, all the way round); drawing
// after a rotation starts a new card facing the camera. Same simulation and
// toon rules as the 2D study, all cards drawn by one WebGL canvas.
// Reference behavior: archive/2d/smoke-brush-2d-v15.html.

import '../ui/theme.css';
import { hexToRgb } from '../core/color.js';
import { History } from '../core/history.js';
import { clone, DEFAULT_STYLE } from '../core/style.js';
import { SmokeLayer2D, layerParamsFromStyle } from '../sim/layer2d.js';
import { Emitter2D } from '../sim/emitters.js';
import { gridForViewport } from '../sim/fluid2d.js';
import { AdaptiveScheduler } from '../sim/scheduler.js';
import { strokeEntry2D } from '../sim/undo2d.js';
import { toonLookFromStyle } from '../render/toon2d.js';
import { ToonRendererGL } from '../render/toon-gl.js';
import { CardSpace } from '../render/card-space.js';
import { PalettePanel } from '../ui/palette.js';
import { mountStyleUI } from '../ui/controls.js';
import { mountPanel } from '../ui/panel.js';
import { WorldTilt } from '../ui/tilt.js';
import { $, toggleGroup } from '../ui/dom.js';

const canvas = $('gl');
const renderer = new ToonRendererGL(canvas);
if (!renderer.ok) $('nogl').style.display = 'flex';

let style = clone(DEFAULT_STYLE);
let params, look, frame = 0;
let brushRGB = hexToRgb(style.color.base);
let colorMode = 'all';
let drawCard = null;
let redraw = true;

const emitter = new Emitter2D();
const scheduler = new AdaptiveScheduler({ budgetMs: 12, maxSkip: 2 });
// New cards get a grid with the current window's aspect (see resize).
let grid = gridForViewport(innerWidth, innerHeight);
const cards = new CardSpace({
  width: grid.nx * 3,
  height: grid.ny * 3,
  // Cards carry per-cell color and only simulate the region that holds smoke.
  createLayer: () => new SmokeLayer2D({ nx: grid.nx, ny: grid.ny, color: true, rgb: brushRGB, trackBounds: true, pressureIterations: 14 }),
  onRemove: (c) => renderer.release(c),
});
const tilt = new WorldTilt(cards);
const view = { width: innerWidth, height: innerHeight, perspective: cards.perspective };

function applyStyle() {
  params = layerParamsFromStyle(style);
  look = toonLookFromStyle(style);
  emitter.mode = style.emission.mode;
  uploadAll();
}

/** Idle cards are not re-uploaded by the loop, so refresh them after a style or color edit. */
function uploadAll() {
  if (renderer.ok) for (const c of cards.cards) renderer.upload(c, look, frame);
  redraw = true;
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

const palette = new PalettePanel($('palette'), {
  onChange(hex) {
    style.color.base = hex;
    brushRGB = hexToRgb(hex);
    emitter.rgb = brushRGB;
    if (colorMode === 'all') recolorAll();
    applyStyle();
    ui.refresh();
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
  },
  onLoad: loadStyle,
});

// Undo / redo, one stroke at a time. Undoing the stroke that created a card
// removes the card; redo brings it back with the same orientation and depth.
let stroke = null; // history entry of the stroke being drawn
const chrome = mountPanel({
  undo() {
    up();
    strokeHistory.undo();
  },
  redo() {
    up();
    strokeHistory.redo();
  },
});
const strokeHistory = new History(30, () => chrome.syncHistory(strokeHistory));
chrome.syncHistory(strokeHistory);

/** Show a card's restored or replayed state right away. */
function refreshCard(card) {
  if (renderer.ok && cards.cards.includes(card)) renderer.upload(card, look, frame, true);
  updateCount();
  redraw = true;
}

function cardStrokeEntry(card, created, before, p) {
  const inner = strokeEntry2D(card.layer, emitter, before, p, () => frame);
  return {
    record: inner.record,
    undo() {
      inner.undo();
      if (created) cards.removeCard(card);
      else cards.ensureCard(card); // it may have emptied and been dropped since
      refreshCard(card);
    },
    redo() {
      cards.ensureCard(card);
      inner.redo();
      refreshCard(card);
    },
  };
}

$('dp').oninput = (e) => {
  cards.depth = +e.target.value;
  $('dpo').textContent = (cards.depth > 0 ? '+' : '') + cards.depth + ' px';
};

$('clr').onclick = () => {
  cards.clear();
  strokeHistory.clear();
  drawCard = null;
  updateCount();
  redraw = true;
};

function resize() {
  grid = gridForViewport(innerWidth, innerHeight);
  cards.width = grid.nx * 3;
  cards.height = grid.ny * 3;
  cards.setViewport(innerWidth, innerHeight);
  view.width = innerWidth;
  view.height = innerHeight;
  view.perspective = cards.perspective;
  renderer.resize(innerWidth, innerHeight);
  redraw = true;
}
addEventListener('resize', resize);

// Pointer: Shift + drag tilts the world, plain drag draws on a card.
function up() {
  emitter.end();
  stroke = null;
  if (tilt.active) {
    tilt.end();
    canvas.style.cursor = 'crosshair';
  }
}
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (e.shiftKey) {
    tilt.begin(e);
    canvas.style.cursor = 'grabbing';
    return;
  }
  const last = cards.cards[cards.cards.length - 1];
  drawCard = cards.pickCard();
  updateCount();
  const p = cards.toGrid(e.clientX, e.clientY, drawCard), before = drawCard.layer.fluid.snapshot();
  emitter.begin(drawCard.layer, p, frame);
  stroke = cardStrokeEntry(drawCard, drawCard !== last, before, p);
  strokeHistory.push(stroke);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons === 0 && (emitter.down || tilt.active)) return up();
  if (tilt.active) {
    tilt.move(e);
    redraw = true;
  } else if (emitter.down) {
    const p = cards.toGrid(e.clientX, e.clientY, drawCard);
    emitter.move(p, frame);
    stroke.record(p);
  }
});
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('lostpointercapture', up);
canvas.addEventListener('dblclick', () => tilt.reset());

function loop() {
  const list = cards.cards;
  const isDraw = (c) => emitter.isDrawing(c.layer);
  const busy = (c) => c.layer.isBusy(emitter);
  scheduler.beginFrame(list.filter((c) => busy(c) && !isDraw(c)).length, emitter.down);

  for (let i = 0; i < list.length; i++) {
    const c = list[i], drawing = isDraw(c);
    if (!scheduler.shouldStep(i, frame, drawing, busy(c))) continue;
    const t0 = performance.now(), was = c.layer.active;
    const wentIdle = c.layer.step(params, frame, scheduler.timeScale(drawing), emitter);
    // Snapshot to the GPU "on 2s" while the card is alive, and once when it settles.
    if (wentIdle || (c.layer.active && frame - c.lastRender >= style.timing.frameStep)) {
      if (renderer.ok) renderer.upload(c, look, frame);
      c.lastRender = frame;
      redraw = true;
    }
    if (was || c.layer.active) scheduler.record(performance.now() - t0);
  }
  scheduler.endFrame();

  if (cards.update()) redraw = true;
  if (renderer.ok && redraw) {
    renderer.draw(cards.drawList(), look, view);
    redraw = false;
  }
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
resize();
updateCount();
loop();
