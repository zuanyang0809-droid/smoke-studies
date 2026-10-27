// A photo behind the smoke ("VFX add-on"): import or drop an image, fit it
// to the window (cover or contain), dim it, and pick smoke colors from it.
//
// The photo is drawn on its own canvas under the WebGL canvas, which turns
// transparent while a photo is loaded, so the browser composites the same
// premultiplied smoke over the photo that it composites over the plain
// background color. The photo is screen-fixed: only the smoke rotates.
// It stays in memory (a decoded bitmap); it is never uploaded or stored.
// Fit mode and brightness live in the Style JSON (`backgroundImage`).

import { DEFAULT_STYLE } from '../core/style.js';
import { rgbToHex } from '../core/color.js';
import { $, h, icon } from './dom.js';

/**
 * Where an image of iw x ih lands in a view of vw x vh, centered.
 * cover fills the view (cropping), contain fits inside it (letterboxed).
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function fitRect(iw, ih, vw, vh, mode = 'cover') {
  const s = mode === 'contain' ? Math.min(vw / iw, vh / ih) : Math.max(vw / iw, vh / ih);
  const w = iw * s, h = ih * s;
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

/** View point -> image pixel for a fitted rect, or null outside the image. */
export function viewToImage(px, py, rect, iw, ih) {
  const u = (px - rect.x) / rect.w, v = (py - rect.y) / rect.h;
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return null;
  return { x: Math.floor(u * iw), y: Math.floor(v * ih) };
}

/** The style's photo settings, with defaults for styles saved before they existed. */
export const photoSettings = (style) => ({ ...DEFAULT_STYLE.backgroundImage, ...style.backgroundImage });

export class BackgroundLayer {
  /**
   * @param {HTMLCanvasElement} canvas  sits under the WebGL canvas
   * @param {() => object} getStyle
   */
  constructor(canvas, getStyle) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getStyle = getStyle;
    this.image = null; // ImageBitmap
    this.pixels = null; // the un-dimmed image, for the eyedropper
  }

  get hasImage() {
    return !!this.image;
  }

  async load(file) {
    if (!file || !file.type.startsWith('image/')) return false;
    const image = await createImageBitmap(file);
    this.image?.close();
    this.image = image;
    const c = new OffscreenCanvas(image.width, image.height);
    c.getContext('2d').drawImage(image, 0, 0);
    this.pixels = c.getContext('2d', { willReadFrequently: true });
    this.render();
    return true;
  }

  remove() {
    this.image?.close();
    this.image = this.pixels = null;
    this.render();
  }

  /** Size to the window and draw: background color, the fitted photo, then the dim. */
  render() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), vw = innerWidth, vh = innerHeight;
    const { canvas, ctx } = this;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    canvas.style.display = this.image ? 'block' : 'none';
    if (!this.image) return;
    const style = this.getStyle(), { fit, brightness } = photoSettings(style);
    ctx.fillStyle = style.color.background;
    ctx.fillRect(0, 0, vw, vh);
    const r = fitRect(this.image.width, this.image.height, vw, vh, fit);
    ctx.drawImage(this.image, r.x, r.y, r.w, r.h);
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - brightness})`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  /** Photo color under a view point (CSS px), un-dimmed, as '#rrggbb'; null off the photo. */
  sampleAt(x, y) {
    if (!this.image) return null;
    const { fit } = photoSettings(this.getStyle());
    const p = viewToImage(x, y, fitRect(this.image.width, this.image.height, innerWidth, innerHeight, fit), this.image.width, this.image.height);
    if (!p) return null;
    const d = this.pixels.getImageData(p.x, p.y, 1, 1).data;
    return rgbToHex([d[0], d[1], d[2]]);
  }
}

/**
 * The "Background image" panel section, drag and drop, and the eyedropper.
 * @param {object} o
 * @param {HTMLCanvasElement} o.surface   the canvas that takes pointer input
 * @param {() => object} o.getStyle
 * @param {(hex: string) => void} o.onPick  set the smoke color (the normal color path)
 * @param {() => void} o.onChange           the photo, fit or brightness changed
 * @returns {{ layer: BackgroundLayer, sync: () => void }}
 */
export function mountBackground({ surface, getStyle, onPick, onChange }) {
  const layer = new BackgroundLayer($('bg'), getStyle);
  const settings = () => {
    const s = getStyle();
    s.backgroundImage = photoSettings(s);
    return s.backgroundImage;
  };

  const file = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  const thumb = h('img', { className: 'bg-thumb', alt: 'Background photo' });
  const remove = h('button', {
    onclick: () => update(() => {
      layer.remove();
      URL.revokeObjectURL(thumb.src);
      thumb.removeAttribute('src');
    }),
  }, icon('trash'), ' Remove');
  const pick = h('button', { onclick: () => setPicking(!picking), title: 'Click the canvas to take a smoke color from the photo' }, icon('color-picker'), ' Pick from photo');
  const fitButtons = ['cover', 'contain'].map((m) => h('button', { textContent: m === 'cover' ? 'Cover' : 'Contain', onclick: () => update(() => (settings().fit = m)) }));
  const dim = h('input', { type: 'range', id: 'bgdim', min: 0, max: 100, step: 5 });
  const dimOut = h('output', { attrs: { for: 'bgdim' } });
  dim.oninput = () => update(() => (settings().brightness = dim.value / 100));
  const loaded = h('div', { className: 'bg-loaded' },
    h('div', { className: 'row' }, thumb, h('span', { className: 'spacer' }), remove),
    h('div', { className: 'seg' }, fitButtons),
    h('div', { className: 'slider' }, h('label', { attrs: { for: 'bgdim' }, textContent: 'Brightness' }), dim, dimOut),
    pick);

  $('bg-panel').append(
    h('span', { className: 'section-label', textContent: 'Background image' }),
    h('div', { className: 'row' },
      h('button', { onclick: () => file.click() }, icon('photo'), ' Import'),
      h('span', { className: 'status', textContent: 'or drop an image on the canvas' })),
    file, loaded);

  let picking = false;
  function setPicking(on) {
    picking = on && layer.hasImage;
    pick.classList.toggle('is-on', picking);
    surface.style.cursor = picking ? 'copy' : '';
  }

  function sync() {
    const { fit, brightness } = photoSettings(getStyle());
    loaded.style.display = layer.hasImage ? 'flex' : 'none';
    fitButtons.forEach((b, i) => b.classList.toggle('is-on', ['cover', 'contain'][i] === fit));
    dim.value = Math.round(brightness * 100);
    dimOut.textContent = dim.value + '%';
    layer.render();
  }

  function update(fn) {
    fn();
    if (!layer.hasImage) setPicking(false);
    sync();
    onChange();
  }

  async function open(f) {
    if (!(await layer.load(f))) return;
    if (thumb.src) URL.revokeObjectURL(thumb.src);
    thumb.src = URL.createObjectURL(f); // local only, for the thumbnail
    update(() => {});
  }
  file.onchange = () => open(file.files[0]).finally(() => (file.value = ''));
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    open(e.dataTransfer.files[0]);
  });

  // Eyedropper: runs before the study's own pointer handlers and stops them.
  surface.addEventListener('pointerdown', (e) => {
    if (!picking) return;
    e.stopImmediatePropagation();
    const hex = layer.sampleAt(e.clientX, e.clientY);
    if (hex) onPick(hex);
    setPicking(false);
  }, { capture: true });

  addEventListener('resize', () => layer.render());
  sync();
  return { layer, sync };
}
