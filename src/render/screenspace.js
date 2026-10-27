// Screen-space renderer for 3D particles.
//
// Every frame the particle snapshot is projected through the camera and
// splatted into a coarse screen grid (about one cell per 2.8 CSS px), the
// same resolution as the 2D fluid. A full-screen shader then shades that
// grid with the 2D toon rules. The smoke stays graphic from any angle
// because the bands are decided in screen space, as a 2D FX artist would.

import * as THREE from 'three';
import { CELL } from '../sim/particles3d.js';
import { applyToonStyle, createToonUniforms } from './toon-uniforms.js';
import vertexShader from './shaders/fullscreen.vert.glsl?raw';
import fragmentShader from './shaders/toon-screen.frag.glsl?raw';

const CELL_PX = 2.8;

export class ScreenSpaceRenderer {
  constructor() {
    this.U = {
      ...createToonUniforms(),
      D: { value: null },
      tx: { value: new THREE.Vector2() },
      L2: { value: new THREE.Vector2(-0.5, 0.85) },
      sol: { value: 0.3 },
      ga: { value: 0.92 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.U, transparent: true, depthTest: false, depthWrite: false, vertexShader, fragmentShader });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.lightWorld = new THREE.Vector3(-0.5, 0.85, 0.3).normalize();
    this._PM = new THREE.Matrix4();
    this._lv = new THREE.Vector3();
    this.GW = 0;
    this.GH = 0;
  }

  get object() {
    return this.mesh;
  }

  set visible(v) {
    this.mesh.visible = v;
  }

  /** @returns the 0..1 palette */
  setStyle(style) {
    const pal = applyToonStyle(this.U, style);
    this.U.ga.value = style.shading.opacity;
    this.U.sol.value = style.form.solidity;
    this.lightWorld.fromArray(style.shading.lightDirection).normalize();
    return pal;
  }

  /** (Re)allocate the screen grid for a canvas size in CSS px. */
  resize(width, height) {
    const nw = Math.max(80, Math.round(width / CELL_PX)), nh = Math.max(60, Math.round(height / CELL_PX));
    if (nw === this.GW && nh === this.GH) return;
    this.GW = nw;
    this.GH = nh;
    const n = nw * nh;
    this.G = new Float32Array(n); // density
    this.GT = new Float32Array(n); // density-weighted texture
    this.GA = new Float32Array(n); // density-weighted age
    this.GB = new Float32Array(n); // blurred density
    this.G2 = new Float32Array(n); // blur scratch
    this.data = new Uint8Array(n * 4);
    if (this.texture) this.texture.dispose();
    this.texture = new THREE.DataTexture(this.data, nw, nh, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
    this.U.D.value = this.texture;
    this.U.tx.value.set(1 / nw, 1 / nh);
  }

  _boxBlur(src, dst) {
    const { GW, GH, G2 } = this;
    for (let j = 0; j < GH; j++) {
      const o = j * GW;
      for (let i = 0; i < GW; i++) {
        let s = 0, c = 0;
        for (let k = -2; k <= 2; k++) {
          const ii = i + k;
          if (ii >= 0 && ii < GW) {
            s += src[o + ii];
            c++;
          }
        }
        G2[o + i] = s / c;
      }
    }
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        let s = 0, c = 0;
        for (let k = -2; k <= 2; k++) {
          const jj = j + k;
          if (jj >= 0 && jj < GH) {
            s += G2[jj * GW + i];
            c++;
          }
        }
        dst[j * GW + i] = s / c;
      }
    }
  }

  /**
   * Splat the snapshot into the screen grid and upload it.
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('../sim/particles3d.js').ParticleSnapshot} snap
   */
  update(camera, snap) {
    const { GW, GH, G, GT, GA, GB, data } = this;
    if (!GW) return;
    G.fill(0);
    GT.fill(0);
    GA.fill(0);
    this._PM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = this._PM.elements, P5 = camera.projectionMatrix.elements[5];
    // Weight keeps total density roughly constant with distance and splat size.
    const K = 0.057, ref = 2.5;

    for (let n = 0; n < snap.count; n++) {
      const x = snap.x[n], y = snap.y[n], z = snap.z[n];
      const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (cw < 0.05) continue;
      const gx = (((e[0] * x + e[4] * y + e[8] * z + e[12]) / cw) * 0.5 + 0.5) * GW - 0.5;
      const gy = (((e[1] * x + e[5] * y + e[9] * z + e[13]) / cw) * 0.5 + 0.5) * GH - 0.5;
      const rk = Math.min(8, Math.max(0.75, ((P5 * 1.5 * CELL) / cw) * GH * 0.5)); // splat radius in cells
      if (gx < -rk || gy < -rk || gx > GW + rk || gy > GH + rk) continue;
      const wgt = (snap.w[n] * K * (cw / ref) * (cw / ref)) / Math.max(1, 1.047 * rk * rk);
      const tv = snap.t[n], av = snap.a[n];
      const i0 = Math.max(0, Math.ceil(gx - rk)), i1 = Math.min(GW - 1, Math.floor(gx + rk));
      const j0 = Math.max(0, Math.ceil(gy - rk)), j1 = Math.min(GH - 1, Math.floor(gy + rk));
      for (let j = j0; j <= j1; j++) {
        const dy = j - gy, o = j * GW;
        for (let i = i0; i <= i1; i++) {
          const r = Math.sqrt((i - gx) * (i - gx) + dy * dy);
          if (r >= rk) continue;
          const k = (1 - r / rk) * wgt, q = o + i;
          G[q] += k;
          GT[q] += k * tv;
          GA[q] += k * av;
        }
      }
    }

    this._boxBlur(G, GB);
    for (let q = 0; q < GW * GH; q++) {
      const v = G[q], o = q * 4;
      data[o] = Math.min(255, v * 170);
      data[o + 1] = v > 1e-5 ? Math.min(255, (GT[q] / v) * 255) : 128;
      data[o + 2] = v > 1e-5 ? Math.min(255, GA[q] / v) : 255;
      data[o + 3] = Math.min(255, GB[q] * 170);
    }
    this.texture.needsUpdate = true;

    // Light direction projected into screen space.
    const L2 = this.U.L2.value;
    this._lv.copy(this.lightWorld).transformDirection(camera.matrixWorldInverse);
    L2.set(this._lv.x, this._lv.y);
    if (L2.lengthSq() < 1e-4) L2.set(0, 1);
    L2.normalize();
  }
}
