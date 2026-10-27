// GPU toon renderer for 2D smoke layers (2D and 2.5D studies).
//
// The CPU keeps simulating the fluid; on each frame step (render "on 2s")
// a layer's fields are snapshotted into textures, and every display frame
// the cards are drawn as quads and shaded by shaders/toon-card.frag.glsl,
// a port of the rules in toon2d.js. Only the region around the smoke is
// uploaded, so 24 cards stay cheap. Embers are drawn as pixel diamonds.

import { createProgram, createTexture, uploadRegion } from './gl.js';
import { blurDensity, blurRegion } from './toon2d.js';
import { mix } from '../core/color.js';
import { emberLook } from '../sim/embers.js';
import cardVert from './shaders/toon-card.vert.glsl?raw';
import cardFrag from './shaders/toon-card.frag.glsl?raw';
import emberVert from './shaders/ember-sprite.vert.glsl?raw';
import emberFrag from './shaders/ember-sprite.frag.glsl?raw';

const MAX_AGE = 1000; // frames; keeps age inside half-float range
const EMBER_FLOATS = 9; // x, y, r, color rgb, core rgb
const MAX_EMBERS = 160;

const union = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3])]);

export class ToonRendererGL {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    const gl = (this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false }));
    if (!gl) return;
    this.card = createProgram(gl, cardVert, cardFrag);
    this.ember = createProgram(gl, emberVert, emberFrag);

    this.quadVAO = gl.createVertexArray();
    gl.bindVertexArray(this.quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.card.program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.emberVAO = gl.createVertexArray();
    gl.bindVertexArray(this.emberVAO);
    this.emberBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.emberBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_EMBERS * EMBER_FLOATS * 4, gl.DYNAMIC_DRAW);
    const attr = (name, size, offset) => {
      const loc = gl.getAttribLocation(this.ember.program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, EMBER_FLOATS * 4, offset * 4);
    };
    attr('aPos', 2, 0);
    attr('aR', 1, 2);
    attr('aCol', 3, 3);
    attr('aCore', 3, 6);
    gl.bindVertexArray(null);
    this.dpr = 1;
  }

  get ok() {
    return !!this.gl;
  }

  /** Size the drawing buffer to the window (CSS px). */
  resize(width, height) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
  }

  /**
   * Snapshot a layer into its card's textures (call on the frame step).
   * @param {{ layer: import('../sim/layer2d.js').SmokeLayer2D, gpu?: object }} card
   * @param {ReturnType<import('./toon2d.js').toonLookFromStyle>} look
   * @param {boolean} [full]  upload the whole grid (after an undo restored a snapshot)
   */
  upload(card, look, frame, full = false) {
    const gl = this.gl, fluid = card.layer.fluid, { nx, ny, d, t, A } = fluid;
    let g = card.gpu;
    if (!g || g.nx !== nx || g.ny !== ny) {
      this.release(card);
      g = card.gpu = {
        nx, ny,
        fields: createTexture(gl, gl.RGBA16F, nx, ny, gl.RGBA, gl.FLOAT),
        color: fluid.hasColor ? createTexture(gl, gl.RGBA8, nx, ny, gl.RGBA, gl.UNSIGNED_BYTE) : null,
        packF: new Float32Array(nx * ny * 4),
        packC: fluid.hasColor ? new Uint8Array(nx * ny * 4) : null,
        prev: null,
        embers: new Float32Array(MAX_EMBERS * EMBER_FLOATS),
        emberCount: 0,
      };
      full = true;
    }

    // Smoke bounds plus the margin the CPU renderer redraws, merged with the
    // last upload so cells that just emptied are cleared too.
    const all = [0, nx - 1, 0, ny - 1];
    const r = full || !fluid.trackBounds ? all : fluid.bounds ? blurRegion(fluid, fluid.bounds, 5) : null;
    const up = full ? all : union(r, g.prev);
    g.prev = r;
    if (up) {
      const B = r ? blurDensity(fluid, r) : null, F = g.packF;
      for (let j = up[2]; j <= up[3]; j++) {
        for (let i = up[0]; i <= up[1]; i++) {
          const k = i + j * nx, o = k * 4;
          F[o] = d[k];
          F[o + 1] = t[k];
          F[o + 2] = Math.min(MAX_AGE, A[k]);
          F[o + 3] = B ? B[k] : 0;
        }
      }
      gl.bindTexture(gl.TEXTURE_2D, g.fields);
      uploadRegion(gl, F, nx, up, gl.RGBA, gl.FLOAT);
      if (g.color) {
        const C = g.packC, { cr, cg, cb } = fluid;
        for (let j = up[2]; j <= up[3]; j++) {
          for (let i = up[0]; i <= up[1]; i++) {
            const k = i + j * nx, o = k * 4;
            C[o] = cr[k];
            C[o + 1] = cg[k];
            C[o + 2] = cb[k];
          }
        }
        gl.bindTexture(gl.TEXTURE_2D, g.color);
        uploadRegion(gl, C, nx, up, gl.RGBA, gl.UNSIGNED_BYTE);
      }
    }
    this._snapshotEmbers(g, card.layer.embers.list, look, frame);
  }

  /** Ember sizes and colors at this frame, as in ToonRenderer2D._drawEmbers. */
  _snapshotEmbers(g, list, look, frame) {
    g.emberCount = 0;
    if (!look.embers) return;
    const E = g.embers, stops = look.emberStops;
    for (const s of list) {
      if (g.emberCount >= MAX_EMBERS) break;
      const { scale, color } = emberLook(s, frame, stops);
      const r = Math.round((s.sz - 1) * scale + (scale > 0.35 ? 0 : -1));
      if (r < 0) continue;
      const core = mix(color, stops[0], 0.65), o = g.emberCount++ * EMBER_FLOATS;
      E[o] = s.x;
      E[o + 1] = s.y;
      E[o + 2] = r;
      for (let c = 0; c < 3; c++) {
        E[o + 3 + c] = color[c] / 255;
        E[o + 6 + c] = core[c] / 255;
      }
    }
  }

  release(card) {
    const g = card.gpu;
    if (!g) return;
    this.gl.deleteTexture(g.fields);
    if (g.color) this.gl.deleteTexture(g.color);
    card.gpu = null;
  }

  /**
   * Draw cards back to front over the background.
   * @param {{ card: object, matrix: Float32Array }[]} list
   * @param {object} look
   * @param {{ width: number, height: number, perspective: number }} view  CSS px
   */
  draw(list, look, view) {
    const gl = this.gl, bg = look.background;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(bg[0] / 255, bg[1] / 255, bg[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    for (const { card, matrix } of list) {
      const g = card.gpu;
      if (!g) continue;
      this._drawCard(g, matrix, look, view);
      if (g.emberCount) this._drawEmbers(g, matrix, view);
    }
  }

  _drawCard(g, matrix, look, view) {
    const gl = this.gl, U = this.card.uniforms;
    gl.useProgram(this.card.program);
    gl.bindVertexArray(this.quadVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.fields);
    gl.uniform1i(U.F, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, g.color);
    gl.uniform1i(U.C, 1);
    gl.uniform1i(U.uPerCell, g.color ? 1 : 0);
    gl.uniform3fv(U.uBase, look.base);
    gl.uniform1f(U.uHueShift, look.hueShift);
    gl.uniform2f(U.uLight, look.lightX / g.nx, look.lightY / g.ny);
    gl.uniform1f(U.TH, look.silhouette);
    gl.uniform1f(U.SH, look.shadow);
    gl.uniform1f(U.tex, look.texture);
    gl.uniform1f(U.sol, look.solidity);
    gl.uniform1f(U.ga, look.opacity);
    gl.uniform1i(U.fHaze, look.haze ? 1 : 0);
    gl.uniform1i(U.fMot, look.mottle ? 1 : 0);
    gl.uniform1i(U.fAge, look.ageTint ? 1 : 0);
    gl.uniform1i(U.fAO, look.ao ? 1 : 0);
    gl.uniform1i(U.fEmb, look.emberCore ? 1 : 0);
    gl.uniformMatrix4fv(U.uMVP, false, matrix);
    gl.uniform2f(U.uSize, view.width, view.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _drawEmbers(g, matrix, view) {
    const gl = this.gl, U = this.ember.uniforms;
    const cellX = view.width / g.nx, cellY = view.height / g.ny;
    gl.useProgram(this.ember.program);
    gl.bindVertexArray(this.emberVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.emberBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.embers, 0, g.emberCount * EMBER_FLOATS);
    gl.uniformMatrix4fv(U.uMVP, false, matrix);
    gl.uniform2f(U.uSize, view.width, view.height);
    gl.uniform2f(U.uCell, cellX, cellY);
    gl.uniform1f(U.uPix, cellX / 3); // the prototypes drew embers in 3 px per cell
    gl.uniform1f(U.uScale, view.perspective * this.dpr);
    gl.drawArrays(gl.POINTS, 0, g.emberCount);
  }
}
