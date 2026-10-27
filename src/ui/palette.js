// Color pickers.
//   PalettePanel  floating HSV picker with recent colors and swatches (2D, 2.5D)
//   SwatchRow     inline swatches plus a native color input (3D)

import { hexToHsv, hsvToRgb, rgbToHex } from '../core/color.js';
import { h } from './dom.js';

export const SWATCHES = [
  '#8a8f99', '#d8d4cc', '#46424f', '#1f1d24', '#62905f', '#9cc28e', '#cfbc9c', '#b08a5a',
  '#c4467f', '#e88fb6', '#d9772e', '#e8c060', '#5b8fd1', '#7fd0d8', '#8b5cc7', '#c03a3a',
];

const SV_W = 166, SV_H = 100, HUE_H = 12, MAX_RECENT = 10;

export class PalettePanel {
  /**
   * @param {HTMLElement} container  positioned element the panel floats in
   * @param {object} o
   * @param {(hex: string) => void} o.onChange  called for every color change
   */
  constructor(container, { onChange, swatches = SWATCHES }) {
    this.onChange = onChange;
    this.current = swatches[0];
    this.hsv = [0, 0, 0];
    this.recent = [];

    this.dot = h('span', { className: 'palette-dot' });
    this.button = h('button', { className: 'palette-button', attrs: { 'aria-label': 'Open color palette' }, onclick: () => this.toggle() },
      this.dot, h('i', { className: 'ti ti-palette', attrs: { 'aria-hidden': 'true' }, style: { fontSize: '18px' } }));

    this.sv = h('canvas', { width: SV_W, height: SV_H, style: { width: SV_W + 'px', height: SV_H + 'px', cursor: 'crosshair' } });
    this.hue = h('canvas', { width: SV_W, height: HUE_H, style: { width: SV_W + 'px', height: HUE_H + 'px', marginTop: '8px', cursor: 'pointer' } });
    this.preview = h('span', { className: 'palette-preview' });
    this.hex = h('span', { className: 'palette-hex' });
    this.recentEl = h('div', { className: 'palette-recent' });
    const swatchEl = h('div', { className: 'palette-swatches' },
      swatches.map((c) => h('button', { className: 'chip square', attrs: { 'aria-label': 'Swatch ' + c }, style: { background: c }, onclick: () => this.setColor(c, true) })));

    this.panel = h('div', { className: 'palette-panel', style: { display: 'none' } },
      this.sv, this.hue,
      h('div', { className: 'palette-current' }, this.preview, this.hex),
      h('div', { className: 'palette-caption', textContent: 'Recent' }), this.recentEl,
      h('div', { className: 'palette-caption', textContent: 'Swatches' }), swatchEl);
    container.append(this.button, this.panel);

    this._drag(this.sv, (e) => {
      const r = this.sv.getBoundingClientRect();
      this.hsv[1] = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      this.hsv[2] = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      this.setColor(rgbToHex(hsvToRgb(...this.hsv)), false, true);
    });
    this._drag(this.hue, (e) => {
      const r = this.hue.getBoundingClientRect();
      this.hsv[0] = Math.min(359.9, Math.max(0, ((e.clientX - r.left) / r.width) * 360));
      this.setColor(rgbToHex(hsvToRgb(...this.hsv)), false, true);
    });
  }

  toggle() {
    this.panel.style.display = this.panel.style.display === 'none' ? 'block' : 'none';
  }

  close() {
    this.panel.style.display = 'none';
  }

  /**
   * @param {boolean} commit      add to the recent colors
   * @param {boolean} fromPicker  keep the picker's own HSV (avoids hue jumps at s = 0)
   */
  setColor(hex, commit, fromPicker = false) {
    this.current = hex;
    if (!fromPicker) this.hsv = hexToHsv(hex);
    this._drawPicker();
    this.preview.style.background = hex;
    this.dot.style.background = hex;
    this.hex.textContent = hex.toUpperCase();
    if (commit) this._pushRecent(hex);
    this.onChange(hex);
  }

  /** Pointer drag on a picker canvas; releasing commits the color. */
  _drag(el, fn) {
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      fn(e);
      const move = (ev) => fn(ev);
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        this._pushRecent(this.current);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }

  _pushRecent(hex) {
    this.recent = [hex, ...this.recent.filter((c) => c !== hex)].slice(0, MAX_RECENT);
    this.recentEl.replaceChildren(...this.recent.map((c) =>
      h('button', { className: 'chip round', attrs: { 'aria-label': 'Recent color ' + c }, style: { background: c }, onclick: () => this.setColor(c, true) })));
  }

  _drawPicker() {
    const [H, S, V] = this.hsv;
    const sx = this.sv.getContext('2d'), hx = this.hue.getContext('2d');
    // Saturation / value square: hue fill, white-to-clear across, clear-to-black down.
    sx.fillStyle = rgbToHex(hsvToRgb(H, 1, 1));
    sx.fillRect(0, 0, SV_W, SV_H);
    let g = sx.createLinearGradient(0, 0, SV_W, 0);
    g.addColorStop(0, '#fff');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    sx.fillStyle = g;
    sx.fillRect(0, 0, SV_W, SV_H);
    g = sx.createLinearGradient(0, 0, 0, SV_H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, '#000');
    sx.fillStyle = g;
    sx.fillRect(0, 0, SV_W, SV_H);
    sx.lineWidth = 2;
    sx.strokeStyle = '#fff';
    sx.beginPath();
    sx.arc(S * SV_W, (1 - V) * SV_H, 5, 0, 7);
    sx.stroke();
    sx.lineWidth = 1;
    sx.strokeStyle = '#000';
    sx.beginPath();
    sx.arc(S * SV_W, (1 - V) * SV_H, 6.5, 0, 7);
    sx.stroke();
    // Hue bar with a marker.
    const hg = hx.createLinearGradient(0, 0, SV_W, 0);
    for (let i = 0; i <= 6; i++) hg.addColorStop(i / 6, rgbToHex(hsvToRgb((i * 60) % 360, 1, 1)));
    hx.fillStyle = hg;
    hx.fillRect(0, 0, SV_W, HUE_H);
    hx.fillStyle = '#fff';
    hx.fillRect((H / 360) * SV_W - 1.5, 0, 3, HUE_H);
    hx.strokeStyle = '#000';
    hx.strokeRect((H / 360) * SV_W - 2.5, 0, 5, HUE_H);
  }
}

export const SWATCHES_3D = ['#8a8f99', '#d8d4cc', '#46424f', '#62905f', '#cfbc9c', '#c4467f', '#d9772e', '#5b8fd1', '#8b5cc7', '#c03a3a'];

export class SwatchRow {
  /**
   * @param {HTMLElement} container
   * @param {(hex: string) => void} onChange
   */
  constructor(container, onChange, swatches = SWATCHES_3D) {
    this.buttons = swatches.map((c) => h('button', { className: 'chip large', attrs: { 'aria-label': 'Smoke color ' + c }, style: { background: c }, onclick: () => onChange(c) }));
    this.buttons.forEach((b, i) => (b.dataset.c = swatches[i]));
    this.input = h('input', { type: 'color', attrs: { 'aria-label': 'Custom smoke color' }, style: { width: '26px', height: '26px', padding: '0', border: '0', background: 'none', cursor: 'pointer' } });
    this.input.oninput = (e) => onChange(e.target.value);
    container.append(h('span', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } }, this.buttons), this.input);
  }

  /** Ring the active swatch. */
  sync(hex) {
    this.buttons.forEach((b) => (b.style.boxShadow = b.dataset.c === hex ? '0 0 0 2px var(--text-accent)' : 'none'));
    this.input.value = hex;
  }
}

