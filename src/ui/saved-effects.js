// Saved effects: a row of Style JSON snapshots kept in localStorage.
// All three apps use the same storage key, so an effect saved in 2D can be
// loaded in 2.5D or 3D. Saves from the single-file prototypes (stored under
// "smokeSaves" as slider values) are migrated on first load.

import { makePalette, rgbToHex } from '../core/color.js';
import { clone, mergeStyle, DEFAULT_STYLE, styleFromLegacySave, validateStyle } from '../core/style.js';
import { h, icon } from './dom.js';

const KEY = 'smokeStudies.savedEffects';
const LEGACY_KEY = 'smokeSaves';
const MAX_SAVES = 12;

function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch (e) {
    return null;
  }
}

/** Load saved styles, migrating prototype saves if there are no new ones yet. */
export function loadSavedStyles() {
  const saved = readStorage(KEY);
  if (Array.isArray(saved)) return saved.map((s) => mergeStyle(DEFAULT_STYLE, s)).filter((s) => validateStyle(s).valid);
  const legacy = readStorage(LEGACY_KEY);
  return Array.isArray(legacy) ? legacy.map(styleFromLegacySave).filter((s) => validateStyle(s).valid) : [];
}

export class SavedEffects {
  /**
   * @param {HTMLElement} container
   * @param {object} o
   * @param {() => object} o.getStyle
   * @param {(style: object) => void} o.onLoad
   */
  constructor(container, { getStyle, onLoad }) {
    this.getStyle = getStyle;
    this.onLoad = onLoad;
    this.saves = loadSavedStyles();
    this.list = h('div', { className: 'saves' });
    container.append(
      h('span', { className: 'section-label', textContent: 'Saved effects' }),
      this.list,
      h('button', { onclick: () => this.save() }, icon('device-floppy'), ' Save effect'));
    this.draw();
  }

  save() {
    this.saves.push(clone(this.getStyle()));
    if (this.saves.length > MAX_SAVES) this.saves.shift();
    this._persist();
    this.draw();
  }

  remove(i) {
    this.saves.splice(i, 1);
    this._persist();
    this.draw();
  }

  _persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.saves));
    } catch (e) {
      /* storage unavailable (private mode) */
    }
  }

  /** Each save shows its three tone bands and B (brush) or L (living stroke). */
  draw() {
    if (!this.saves.length) {
      this.list.replaceChildren(h('span', { className: 'saves-empty', textContent: 'Your saved effects show up here' }));
      return;
    }
    this.list.replaceChildren(...this.saves.map((s, i) => {
      const living = s.emission.mode === 'livingStroke';
      const pal = makePalette(s.color.base, s.color.hueShift);
      const swatch = h('button', {
        className: 'save-swatch',
        title: `${living ? 'Living stroke' : 'Brush'} · ${s.color.base.toUpperCase()}`,
        attrs: { 'aria-label': `Load saved effect ${i + 1}` },
        onclick: () => this.onLoad(clone(s)),
      },
      pal.base.map((c) => h('span', { style: { background: rgbToHex(c) } })),
      h('span', { className: 'tag', textContent: living ? 'L' : 'B' }));
      const del = h('button', { className: 'save-delete', textContent: '×', attrs: { 'aria-label': `Delete saved effect ${i + 1}` }, onclick: () => this.remove(i) });
      return h('span', { className: 'save' }, swatch, del);
    }));
  }
}
