// Run an archived single-file prototype in a Node vm with a stub DOM and a
// seeded Math.random, so its state can be compared with the modules.

import fs from 'node:fs';
import vm from 'node:vm';

export const ARCHIVE = new URL('../../archive/', import.meta.url);

/** Small deterministic PRNG (mulberry32). */
export function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fakeContext2D() {
  const noop = () => {};
  return {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: noop, clearRect: noop, fillRect: noop, beginPath: noop, arc: noop, stroke: noop, strokeRect: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
  };
}

export function fakeElement(extra = {}) {
  const listeners = {};
  const ctx = fakeContext2D();
  return {
    style: {}, dataset: {}, listeners, value: '0', checked: false, textContent: '', innerHTML: '', width: 480, height: 320, clientWidth: 680,
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    removeEventListener() {}, setPointerCapture() {}, appendChild() {}, append() {}, remove() {}, setAttribute() {}, dispatchEvent() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 320 }),
    getContext: () => ctx,
    ...extra,
  };
}

/**
 * @param {string} file     path inside archive/
 * @param {number} seed
 * @param {object} [o]
 * @param {object} [o.elements]  stub overrides by element id
 * @param {object} [o.globals]   extra globals (e.g. THREE)
 */
export function loadPrototype(file, seed, { elements = {}, globals = {} } = {}) {
  const html = fs.readFileSync(new URL(file, ARCHIVE), 'utf8');
  const isModule = html.includes('<script type="module">');
  const open = isModule ? '<script type="module">' : '<script>';
  let src = html.slice(html.lastIndexOf(open) + open.length, html.lastIndexOf('</script>'));
  if (isModule) src = src.replace(/^import .*$/m, ''); // three.js is injected instead
  const els = {};
  const document = {
    getElementById: (id) => (els[id] ||= fakeElement(elements[id])),
    querySelectorAll: () => [],
    createElement: () => fakeElement(),
  };
  const context = vm.createContext({
    document, window: { devicePixelRatio: 1 }, navigator: {}, localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame() {}, ResizeObserver: class { observe() {} }, Event: class {}, performance: { now: () => 0 }, console,
    __random: seeded(seed), ...globals,
  });
  vm.runInContext('Math.random = __random', context);
  vm.runInContext(src, context);
  return { els, run: (code) => vm.runInContext(code, context), context };
}

/** Largest absolute difference between two arrays. */
export function maxDiff(a, b) {
  let m = a.length === b.length ? 0 : Infinity;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}
