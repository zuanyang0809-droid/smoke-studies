// Controls bound to the Style JSON. Every app keeps one style object as its
// state; sliders and checkboxes read and write it through the tables below,
// so the same control means the same field in 2D, 2.5D and 3D.

import { getPresets, loadStyle } from '../core/style.js';
import { $, h, icon } from './dom.js';
import { SavedEffects } from './saved-effects.js';

/** Sliders show 0..10 (hue shift in steps of 4 degrees); the style stays normalized. */
export const SLIDERS = {
  st: { label: 'Frame step', min: 1, max: 4, get: (s) => s.timing.frameStep, set: (s, v) => (s.timing.frameStep = v), format: (v) => `on ${v}s` },
  tx: { label: 'Brush texture', min: 0, max: 10, get: (s) => Math.round(s.texture.amount * 10), set: (s, v) => (s.texture.amount = v / 10) },
  bu: { label: 'Rise', min: 1, max: 10, get: (s) => Math.round(s.motion.rise * 10), set: (s, v) => (s.motion.rise = v / 10) },
  ds: { label: 'Dissipation', min: 1, max: 10, get: (s) => Math.round(s.motion.dissipation * 10), set: (s, v) => (s.motion.dissipation = v / 10) },
  tb: { label: 'Curl', min: 0, max: 10, get: (s) => Math.round(s.motion.curl * 10), set: (s, v) => (s.motion.curl = v / 10) },
  so: { label: 'Solidity', min: 0, max: 10, get: (s) => Math.round(s.form.solidity * 10), set: (s, v) => (s.form.solidity = v / 10) },
  hs: { label: 'Hue shift', min: 0, max: 10, get: (s) => Math.round(s.color.hueShift / 4), set: (s, v) => (s.color.hueShift = v * 4) },
  ea: { label: 'Embers', min: 0, max: 10, get: (s) => Math.round(s.embers.amount * 10), set: (s, v) => (s.embers.amount = v / 10) },
};

export const CHECKBOXES = {
  hz: { label: 'Haze', get: (s) => s.layers.haze, set: (s, v) => (s.layers.haze = v) },
  mt: { label: 'Mottle', get: (s) => s.texture.mottle, set: (s, v) => (s.texture.mottle = v) },
  ag: { label: 'Age tint', get: (s) => s.layers.ageTint, set: (s, v) => (s.layers.ageTint = v) },
  ao: { label: 'AO', get: (s) => s.layers.ambientOcclusion, set: (s, v) => (s.layers.ambientOcclusion = v) },
  em: { label: 'Ember core', get: (s) => s.layers.emberCore, set: (s, v) => (s.layers.emberCore = v) },
  sp: { label: 'Embers', get: (s) => s.embers.enabled, set: (s, v) => (s.embers.enabled = v) },
  sm: { label: 'Embers match smoke', get: (s) => s.embers.matchSmoke, set: (s, v) => (s.embers.matchSmoke = v) },
};

/**
 * Build the layer checkboxes and the slider grid.
 * @param {object} o
 * @param {HTMLElement} o.layersEl
 * @param {HTMLElement} o.slidersEl
 * @param {() => object} o.getStyle     current style (mutated in place)
 * @param {() => void} o.onChange       called after any control edits the style
 * @param {object} [o.overrides]        per-slider tweaks, e.g. { bu: { min: 0 } }
 * @returns {{ sync: () => void }} pushes the style back into the controls
 */
export function buildControls({ layersEl, slidersEl, getStyle, onChange, overrides = {}, sliders = Object.keys(SLIDERS), checkboxes = Object.keys(CHECKBOXES) }) {
  const sl = sliders.map((id) => ({ id, ...SLIDERS[id], ...overrides[id] }));
  const cb = checkboxes.map((id) => ({ id, ...CHECKBOXES[id] }));
  const fmt = (c, v) => (c.format ? c.format(v) : String(v));

  layersEl.append(h('span', { className: 'section-label', textContent: 'Layers' }));
  for (const c of cb) {
    c.input = h('input', { type: 'checkbox', id: c.id });
    c.input.onchange = (e) => {
      c.set(getStyle(), e.target.checked);
      onChange();
    };
    layersEl.append(h('label', {}, c.input, ' ' + c.label));
  }

  for (const c of sl) {
    c.input = h('input', { type: 'range', id: c.id, min: c.min, max: c.max, step: 1 });
    c.output = h('output', { attrs: { for: c.id } });
    c.input.oninput = (e) => {
      const v = +e.target.value;
      c.set(getStyle(), v);
      c.output.textContent = fmt(c, v);
      onChange();
    };
    slidersEl.append(h('div', { className: 'slider' }, h('label', { attrs: { for: c.id }, textContent: c.label }), c.input, c.output));
  }

  return {
    sync() {
      const s = getStyle();
      for (const c of sl) {
        const v = c.get(s);
        c.input.value = v;
        c.output.textContent = fmt(c, v);
      }
      for (const c of cb) c.input.checked = c.get(s);
    },
  };
}

/**
 * Preset picker plus an editable Style JSON panel (apply, copy, download).
 * @param {HTMLElement} container
 * @param {object} o
 * @param {object[]} o.presets
 * @param {() => object} o.getStyle
 * @param {(style: object) => void} o.onLoad   a validated, complete style
 * @param {number} [o.initialPreset]           index shown at start, or none
 */
export function createStylePanel(container, { presets, getStyle, onLoad, initialPreset = -1 }) {
  const select = h('select', { id: 'preset' },
    initialPreset < 0 ? h('option', { value: '', textContent: 'Custom', disabled: true, selected: true }) : null,
    presets.map((p, i) => h('option', { value: String(i), textContent: p.name, selected: i === initialPreset })));
  select.onchange = (e) => onLoad(structuredClone(presets[+e.target.value]));

  const text = h('textarea', { spellcheck: false, attrs: { 'aria-label': 'Style JSON' } });
  const error = h('span', { className: 'json-error' });
  const show = () => {
    text.value = JSON.stringify(getStyle(), null, 2);
    error.textContent = '';
  };
  const panel = h('div', { className: 'json-panel', style: { display: 'none', marginTop: '8px' } },
    text,
    h('div', { className: 'json-actions' },
      h('button', {
        textContent: 'Apply',
        onclick: () => {
          const { style, errors } = loadStyle(text.value);
          if (style) {
            onLoad(style);
            error.textContent = '';
          } else error.textContent = errors.join(' ');
        },
      }),
      h('button', {
        textContent: 'Copy',
        onclick: () => {
          try {
            navigator.clipboard.writeText(JSON.stringify(getStyle(), null, 2));
          } catch (e) {
            /* clipboard unavailable */
          }
        },
      }),
      h('button', {
        textContent: 'Download',
        onclick: () => {
          const s = getStyle();
          const url = URL.createObjectURL(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }));
          const name = (s.name || 'smoke-style').toLowerCase().replace(/[^a-z0-9]+/g, '-');
          h('a', { href: url, download: `${name}.json` }).click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
      }),
      error));
  text.oninput = () => (error.textContent = '');

  const toggle = h('button', {
    onclick: () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      show();
    },
  }, icon('braces'), ' Style JSON');

  container.append(
    h('div', { className: 'section', style: { marginTop: '14px', marginBottom: '0' } },
      h('label', { className: 'section-label', attrs: { for: 'preset' }, textContent: 'Preset' }), select,
      h('span', { className: 'spacer' }), toggle),
    panel);

  return {
    /** Keep the open editor in sync with the live style. */
    refresh() {
      if (panel.style.display !== 'none') show();
    },
  };
}

/**
 * Mount the style UI every demo shares into its standard containers:
 * #saves (saved effects), #layers (checkboxes), #sliders, #style-panel.
 * @param {object} o
 * @param {() => object} o.getStyle
 * @param {() => void} o.onChange             a control edited the style in place
 * @param {(style: object) => void} o.onLoad  replace the whole style
 * @returns {{ sync: () => void, refresh: () => void }}
 *   sync: push the style into every control; refresh: update the JSON editor only
 */
export function mountStyleUI({ getStyle, onChange, onLoad, overrides, initialPreset }) {
  const controls = buildControls({ layersEl: $('layers'), slidersEl: $('sliders'), getStyle, onChange, overrides });
  new SavedEffects($('saves'), { getStyle, onLoad });
  const panel = createStylePanel($('style-panel'), { presets: getPresets(), getStyle, onLoad, initialPreset });
  return {
    sync() {
      controls.sync();
      panel.refresh();
    },
    refresh: () => panel.refresh(),
  };
}
