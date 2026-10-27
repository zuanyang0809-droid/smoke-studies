// Renderer for the GPU smoke fluid (study 03).
//
// On the frame step a light pass computes, per voxel, how much light gets
// through the smoke toward the light and from around it. Every display
// frame a box mesh is ray-marched: translucent density accumulates and is
// stylized into the hand-drawn bands and three opacity levels
// (shaders/smoke-march.frag.glsl). See docs/3d-smoke-research.md.

import * as THREE from 'three';
import { applyToonStyle, createToonUniforms } from './toon-uniforms.js';
import common from '../sim/shaders/fluid-common.glsl?raw';
import lightFrag from './shaders/smoke-light.frag.glsl?raw';
import marchVert from './shaders/smoke-march.vert.glsl?raw';
import marchFrag from './shaders/smoke-march.frag.glsl?raw';

const SIGMA = 0.55; // extinction per voxel per unit density along the view ray
const LIGHT_SIGMA = 0.8; // stronger toward the light, so self-shadowing reads in thin smoke too

export class SmokeVolumeRenderer {
  /** @param {import('../sim/fluid3d.js').Fluid3D} fluid */
  constructor(fluid) {
    this.fluid = fluid;
    this.shade = fluid.createTarget();
    this.light = fluid.createPass(lightFrag, {
      uScal: { value: fluid.frozen.texture },
      uL: { value: new THREE.Vector3(-0.5, 0.85, 0.3).normalize() },
      uSigma: { value: LIGHT_SIGMA },
    });
    this.U = {
      ...createToonUniforms(),
      ...fluid.atlas,
      uShade: { value: this.shade.texture },
      uAge: { value: fluid.frozen.texture },
      uBoxMin: { value: fluid.boxMin },
      uBoxSize: { value: fluid.boxSize },
      uVoxel: { value: fluid.voxel },
      uSigma: { value: SIGMA },
      uLightHi: { value: 0.62 },
      uLightLo: { value: 0.3 },
      ga: { value: 0.92 },
    };
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: marchVert, fragmentShader: common + marchFrag,
      uniforms: this.U, side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
  }

  get object() {
    return this.mesh;
  }

  set visible(v) {
    this.mesh.visible = v;
  }

  /** @returns the 0..1 palette (for ember colors) */
  setStyle(style) {
    const pal = applyToonStyle(this.U, style);
    this.U.ga.value = style.shading.opacity;
    this.light.uniforms.uL.value.fromArray(style.shading.lightDirection).normalize();
    // A higher shadow threshold widens the shadow band, as in 2D.
    this.U.uLightHi.value = 0.95 - style.shading.shadowThreshold * 0.8;
    this.U.uLightLo.value = this.U.uLightHi.value - 0.3;
    return pal;
  }

  /** Freeze the smoke and relight it (call on the frame step). */
  update() {
    const f = this.fluid;
    f.freeze();
    f.passes(() => f.run(this.light, this.shade));
    this.mesh.position.copy(f.boxMin).addScaledVector(f.boxSize, 0.5);
    this.mesh.scale.copy(f.boxSize);
  }
}
