// Volume renderer for 3D particles (from the 3D v1 prototype).
//
// A fixed 48 x 64 x 48 voxel grid is fitted around the particles each update
// (voxel size snaps to quarter powers of two so it does not flicker), the
// particles are splatted trilinearly and blurred, and a ray marcher shades
// the first surface it hits. Because the bands come from a true 3D surface,
// this version reads less like drawn smoke and more like a liquid.

import * as THREE from 'three';
import { CELL } from '../sim/particles3d.js';
import { applyToonStyle, createToonUniforms } from './toon-uniforms.js';
import vertexShader from './shaders/volume.vert.glsl?raw';
import fragmentShader from './shaders/volume.frag.glsl?raw';

const NX = 48, NY = 64, NZ = 48, SXY = NX * NY, N = SXY * NZ;

export class VolumeRenderer {
  /** @param {THREE.PerspectiveCamera} camera  its position feeds the ray origin */
  constructor(camera) {
    this.d = new Float32Array(N);
    this.t = new Float32Array(N).fill(0.5);
    this.A = new Float32Array(N);
    this.TW = new Float32Array(N);
    this.AW = new Float32Array(N);
    this.tmp = new Float32Array(N);
    this.voxel = CELL;
    this.bmin = new THREE.Vector3();
    this.bsize = new THREE.Vector3(NX * CELL, NY * CELL, NZ * CELL);

    this.data = new Uint8Array(N * 4);
    this.texture = new THREE.Data3DTexture(this.data, NX, NY, NZ);
    this.texture.format = THREE.RGBAFormat;
    this.texture.type = THREE.UnsignedByteType;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;

    this.U = {
      ...createToonUniforms(),
      vol: { value: this.texture },
      cam: { value: camera.position },
      bmin: { value: this.bmin },
      bsize: { value: this.bsize },
      L: { value: new THREE.Vector3(-0.5, 0.85, 0.3).normalize() },
      vs: { value: CELL },
      dtS: { value: 0.007 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.U, side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false, vertexShader, fragmentShader });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this._visible = true;
  }

  get object() {
    return this.mesh;
  }

  set visible(v) {
    this._visible = v;
    if (!v) this.mesh.visible = false;
  }

  setStyle(style) {
    const pal = applyToonStyle(this.U, style);
    this.U.L.value.fromArray(style.shading.lightDirection).normalize();
    return pal;
  }

  clear() {
    this.d.fill(0);
    this.t.fill(0.5);
    this.A.fill(0);
    this.mesh.visible = false;
  }

  /** Density at a world point (nearest voxel); embers use it to find dense smoke. */
  densityAt = (x, y, z) => {
    const v = this.voxel, b = this.bmin;
    const i = Math.floor((x - b.x) / v), j = Math.floor((y - b.y) / v), k = Math.floor((z - b.z) / v);
    return i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ ? 0 : this.d[i + j * NX + k * SXY];
  };

  /** Separable [1 2 1] / 4 blur along x, y and z. */
  _blur3(a) {
    const tmp = this.tmp;
    for (let k = 0; k < NZ; k++) {
      for (let j = 0; j < NY; j++) {
        const o = j * NX + k * SXY;
        tmp[o] = a[o];
        tmp[o + NX - 1] = a[o + NX - 1];
        for (let i = 1; i < NX - 1; i++) tmp[o + i] = (a[o + i - 1] + 2 * a[o + i] + a[o + i + 1]) * 0.25;
      }
    }
    for (let k = 0; k < NZ; k++) {
      for (let i = 0; i < NX; i++) {
        const o = i + k * SXY;
        a[o] = tmp[o];
        a[o + (NY - 1) * NX] = tmp[o + (NY - 1) * NX];
        for (let j = 1; j < NY - 1; j++) {
          const q = o + j * NX;
          a[q] = (tmp[q - NX] + 2 * tmp[q] + tmp[q + NX]) * 0.25;
        }
      }
    }
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const o = i + j * NX;
        tmp[o] = a[o];
        tmp[o + (NZ - 1) * SXY] = a[o + (NZ - 1) * SXY];
        for (let k = 1; k < NZ - 1; k++) {
          const q = o + k * SXY;
          tmp[q] = (a[q - SXY] + 2 * a[q] + a[q + SXY]) * 0.25;
        }
      }
    }
    a.set(tmp);
  }

  /** Fit the voxel box around all particles with a margin. */
  _fit(sim) {
    const { px, py, pz } = sim;
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let n = 0; n < sim.count; n++) {
      const x = px[n], y = py[n], z = pz[n];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const pad = 6 * CELL;
    x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;
    let v = Math.max(CELL, (x1 - x0) / (NX - 2), (y1 - y0) / (NY - 2), (z1 - z0) / (NZ - 2));
    v = CELL * Math.pow(2, Math.ceil(Math.log2(v / CELL) * 4) / 4);
    this.voxel = v;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    this.bmin.set(Math.floor((cx - (NX * v) / 2) / v) * v, Math.floor((cy - (NY * v) / 2) / v) * v, Math.floor((cz - (NZ * v) / 2) / v) * v);
    this.bsize.set(NX * v, NY * v, NZ * v);
  }

  /** Trilinear splat of particle weight, texture and age into the voxels. */
  _splat(sim) {
    const { d, t, A, TW, AW } = this, v = this.voxel, b = this.bmin;
    d.fill(0);
    TW.fill(0);
    AW.fill(0);
    const sc = Math.pow(CELL / v, 3) * 0.1;
    const os = [0, 1, NX, NX + 1, SXY, SXY + 1, SXY + NX, SXY + NX + 1];
    for (let n = 0; n < sim.count; n++) {
      const x = (sim.px[n] - b.x) / v - 0.5, y = (sim.py[n] - b.y) / v - 0.5, z = (sim.pz[n] - b.z) / v - 0.5;
      if (x < 0 || y < 0 || z < 0 || x >= NX - 1 || y >= NY - 1 || z >= NZ - 1) continue;
      const i = x | 0, j = y | 0, k = z | 0, fx = x - i, fy = y - j, fz = z - k;
      const q = i + j * NX + k * SXY, w = sim.pw[n] * sc, tv = sim.pt[n], av = sim.pa[n];
      const ws = [
        (1 - fx) * (1 - fy) * (1 - fz), fx * (1 - fy) * (1 - fz), (1 - fx) * fy * (1 - fz), fx * fy * (1 - fz),
        (1 - fx) * (1 - fy) * fz, fx * (1 - fy) * fz, (1 - fx) * fy * fz, fx * fy * fz,
      ];
      for (let c = 0; c < 8; c++) {
        const qq = q + os[c], ww = w * ws[c];
        d[qq] += ww;
        TW[qq] += ww * tv;
        AW[qq] += ww * av;
      }
    }
    this._blur3(d);
    this._blur3(TW);
    this._blur3(AW);
    for (let q = 0; q < N; q++) {
      const val = d[q];
      if (val > 1e-4) {
        t[q] = TW[q] / val;
        A[q] = AW[q] / val;
      } else {
        t[q] = 0.5;
        A[q] = 255;
      }
    }
  }

  /** Rebuild the volume from the live particles (called on the frame step). */
  update(sim) {
    if (!sim.count) {
      this.mesh.visible = false;
      return;
    }
    this._fit(sim);
    this._splat(sim);
    const { d, t, A, data } = this;
    for (let q = 0; q < N; q++) {
      const o = q * 4;
      data[o] = Math.min(255, d[q] * 170);
      data[o + 1] = t[q] * 255;
      data[o + 2] = Math.min(255, A[q]);
    }
    this.texture.needsUpdate = true;
    this.U.vs.value = this.voxel;
    this.U.dtS.value = this.voxel * 0.32;
    this.mesh.position.copy(this.bmin).addScaledVector(this.bsize, 0.5);
    this.mesh.scale.copy(this.bsize);
    this.mesh.visible = this._visible;
  }
}
