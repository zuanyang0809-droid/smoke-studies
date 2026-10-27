// 3D embers drawn as distance-scaled point sprites.

import * as THREE from 'three';
import { emberStops } from '../core/color.js';
import { emberLook } from '../sim/embers.js';
import vertexShader from './shaders/ember-points.vert.glsl?raw';
import fragmentShader from './shaders/ember-points.frag.glsl?raw';

export class EmberPoints {
  constructor(max = 200) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    const geo = (this.geometry = new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('col', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.material = new THREE.ShaderMaterial({ uniforms: { scale: { value: 400 } }, transparent: false, depthWrite: false, depthTest: false, vertexShader, fragmentShader });
    this.points = new THREE.Points(geo, this.material);
    this.points.renderOrder = 2;
    this.points.frustumCulled = false;
  }

  get object() {
    return this.points;
  }

  /** Point size scale so `size` is in world units at the given buffer height. */
  resize(bufferHeight, fovDeg) {
    this.material.uniforms.scale.value = bufferHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /**
   * @param {import('../sim/embers.js').Embers3D} embers
   * @param {object} pal  0..1 palette
   */
  update(embers, pal, matchSmoke, frame) {
    const stops = emberStops(pal, matchSmoke);
    let n = 0;
    for (const e of embers.list) {
      if (n >= this.max) break;
      const { scale, color } = emberLook(e, frame, stops);
      this.pos.set([e.x, e.y, e.z], n * 3);
      this.col.set(color, n * 3);
      this.size[n] = (0.004 + 0.005 * e.sz) * scale;
      n++;
    }
    const a = this.geometry.attributes;
    this.geometry.setDrawRange(0, n);
    a.position.needsUpdate = a.col.needsUpdate = a.size.needsUpdate = true;
  }
}
