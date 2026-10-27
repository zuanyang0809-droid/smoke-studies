// A real 3D smoke fluid on the GPU (WebGL2 through three.js).
//
// The volume is 64 x 96 x 64 voxels stored as a 2D atlas of half-float
// textures (8 x 8 slices), so every solver step is a full-atlas fragment
// pass. Per step:
//   sources     brush, living strokes and impulses, splatted as point sprites
//   forces      buoyancy from heat and density, vorticity confinement, turbulence
//   velocity    semi-Lagrangian advection, expansion from heat, 20 Jacobi
//               pressure iterations, gradient subtraction
//   scalars     density, temperature, brush texture and age, carried with
//               MacCormack advection, then aged, dissipated and cooled
// The box follows the strokes: drawing near or past a face moves it by whole
// voxels, so smoke can be drawn anywhere in view. Faces are open.
//
// It has the same source interface as Particles3D (inject, hold, impulse),
// so Emitter3D drives either one. See docs/3d-smoke-research.md.

import * as THREE from 'three';
import { CELL, Particles3D } from './particles3d.js';
import common from './shaders/fluid-common.glsl?raw';
import passVert from './shaders/fluid-pass.vert.glsl?raw';
import splatVert from './shaders/fluid-splat.vert.glsl?raw';
import splatFrag from './shaders/fluid-splat.frag.glsl?raw';
import curlFrag from './shaders/fluid-curl.frag.glsl?raw';
import forceFrag from './shaders/fluid-force.frag.glsl?raw';
import advectFrag from './shaders/fluid-advect.frag.glsl?raw';
import maccormackFrag from './shaders/fluid-maccormack.frag.glsl?raw';
import divergenceFrag from './shaders/fluid-divergence.frag.glsl?raw';
import jacobiFrag from './shaders/fluid-jacobi.frag.glsl?raw';
import gradientFrag from './shaders/fluid-gradient.frag.glsl?raw';
import shiftFrag from './shaders/fluid-shift.frag.glsl?raw';
import copyFrag from './shaders/fluid-copy.frag.glsl?raw';

export const VOXEL = CELL * 1.25; // world size of one voxel
const MAX_SPLAT_VERTICES = 60000;
const MAX_IMPULSE_VERTICES = 4096;
const JACOBI_ITERATIONS = 20;
const SOURCE_GAIN = 1.6; // particle "amount" -> density added at a splat's center
const MARGIN = 6; // voxels kept between a stroke and the faces of the box
const HEADROOM = 36; // voxels kept above a stroke, so its smoke can rise and fade below the top

/** Map normalized Style JSON values to solver units (voxels and steps). */
export function fluidParams3DFromStyle(style) {
  return {
    buoyancy: style.motion.rise * 0.012,
    confinement: style.motion.curl * 0.35,
    turbulence: 0.004 + style.motion.curl * 0.01,
    // Old smoke fades where it is; slower than Fluid2D's 0.025 because a 3D
    // puff also thins by spreading in depth.
    ageDecay: style.motion.dissipation * 0.012,
    agingFrames: style.motion.agingFrames || 80,
    expansion: 0.03,
    cooling: 0.95,
  };
}

/**
 * Smallest whole-voxel shift of the box that keeps a point a margin away
 * from every face, with headroom above it (y), so the box moves with the
 * smoke instead of acting as a lid. Moving only as far as needed keeps as
 * much of the smoke already drawn as possible. Pure, so it is unit tested.
 * @param {number[]} p  point in voxel coordinates
 * @param {number[]} n  box size in voxels
 * @returns {number[]} shift of the box origin, in voxels
 */
export function followShift(p, n, margin = MARGIN, headroom = HEADROOM) {
  return p.map((v, i) => {
    const hi = n[i] - (i === 1 ? headroom : margin);
    return v < margin ? Math.floor(v - margin) : v > hi ? Math.ceil(v - hi) : 0;
  });
}

export class Fluid3D {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer, { nx = 64, ny = 96, nz = 64, tilesX = 8 } = {}) {
    this.renderer = renderer;
    this.n = [nx, ny, nz];
    this.voxel = VOXEL;
    this.cell = CELL;
    const tilesY = Math.ceil(nz / tilesX);
    this.W = nx * tilesX;
    this.H = ny * tilesY;
    // Strokes start near the bottom so rising smoke has room above them.
    this.home = [nx / 2, ny * 0.3, nz / 2];
    this.boxMin = new THREE.Vector3(-this.home[0] * VOXEL, -this.home[1] * VOXEL, -this.home[2] * VOXEL);
    this.boxSize = new THREE.Vector3(nx * VOXEL, ny * VOXEL, nz * VOXEL);
    this.frame = 0;
    this.seed = 0;
    this.params = null;
    this.strokeId = 0; // unused; Particles3D tags particles with it

    const rt = () => this.createTarget();
    this.vel = [rt(), rt()];
    this.scal = [rt(), rt()]; // density, temperature, texture, age
    this.p = [rt(), rt()];
    this.curl = rt();
    this.div = rt();
    this.fwd = rt();
    this.bwd = rt();
    this.srcS = rt();
    this.srcV = rt();
    /** Frozen copy of the scalars, taken on the frame step for rendering. */
    this.frozen = rt();

    this.atlas = {
      uN: { value: new THREE.Vector3(nx, ny, nz) },
      uTiles: { value: new THREE.Vector2(tilesX, tilesY) },
      uAtlas: { value: new THREE.Vector2(this.W, this.H) },
    };
    const pass = (frag, uniforms) => this.createPass(frag, uniforms);
    const tex = () => ({ value: null }), num = (v = 0) => ({ value: v });
    this.m = {
      curl: pass(curlFrag, { uVel: tex() }),
      force: pass(forceFrag, { uVel: tex(), uCurl: tex(), uScal: tex(), uSrcV: tex(), uBuoy: num(), uEps: num(), uTurb: num(), uTime: num(), uAgingFrames: num(80) }),
      advect: pass(advectFrag, { uVel: tex(), uSrc: tex(), uDt: num(1), uDamp: num(1) }),
      maccormack: pass(maccormackFrag, { uVel: tex(), uPhi: tex(), uFwd: tex(), uBwd: tex(), uSrcS: tex(), uAgeDecay: num(), uAgingFrames: num(80), uCool: num(1) }),
      divergence: pass(divergenceFrag, { uVel: tex(), uScal: tex(), uExpand: num() }),
      jacobi: pass(jacobiFrag, { uP: tex(), uDiv: tex() }),
      gradient: pass(gradientFrag, { uVel: tex(), uP: tex() }),
      shift: pass(shiftFrag, { uSrc: tex(), uShift: { value: new THREE.Vector3() } }),
      copy: pass(copyFrag, { uSrc: tex() }),
    };

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Sources: one vertex per (sphere, slice) pair, rebuilt every step.
    this.splatPos = new Float32Array(MAX_SPLAT_VERTICES * 3);
    this.splatParams = new Float32Array(MAX_SPLAT_VERTICES * 4);
    this.splatVel = new Float32Array(MAX_SPLAT_VERTICES * 3);
    this.splatCount = 0;
    this.velPos = new Float32Array(MAX_IMPULSE_VERTICES * 3);
    this.velParams = new Float32Array(MAX_IMPULSE_VERTICES * 4);
    this.velVel = new Float32Array(MAX_IMPULSE_VERTICES * 3);
    this.velCount = 0;
    const splatMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: splatVert, fragmentShader: common + splatFrag,
      uniforms: { ...this.atlas, uMode: { value: 0 }, uSeed: num(), uTime: num() },
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
    const points = (pos, params, vel) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aParams', new THREE.BufferAttribute(params, 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3).setUsage(THREE.DynamicDrawUsage));
      const p = new THREE.Points(g, splatMaterial);
      p.frustumCulled = false;
      return p;
    };
    this.splatPoints = points(this.splatPos, this.splatParams, this.splatVel);
    this.velPoints = points(this.velPos, this.velParams, this.velVel);
    this.splatScene = new THREE.Scene();

    // Sparse curl-noise tracers born with the smoke carry the embers.
    this.tracers = new Particles3D(3000);
    this.clear();
  }

  /** A half-float atlas render target. */
  createTarget() {
    return new THREE.WebGLRenderTarget(this.W, this.H, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
  }

  /** A full-atlas pass; `frag` gets fluid-common.glsl prepended. */
  createPass(frag, uniforms) {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: passVert, fragmentShader: common + frag,
      uniforms: { ...this.atlas, ...uniforms }, depthTest: false, depthWrite: false,
    });
  }

  // --- sources (the interface Emitter3D uses) -------------------------------

  /** World point -> voxel coordinates. */
  _voxel(x, y, z) {
    const b = this.boxMin, v = this.voxel;
    return [(x - b.x) / v, (y - b.y) / v, (z - b.z) / v];
  }

  /** Queue a sphere of source into every slice it touches. */
  _splat(x, y, z, radiusCells, amount, tex) {
    const [cx, cy, cz] = this._voxel(x, y, z), R = Math.max(1, (radiusCells * CELL) / this.voxel);
    const k0 = Math.max(0, Math.floor(cz - R)), k1 = Math.min(this.n[2] - 1, Math.floor(cz + R));
    for (let k = k0; k <= k1; k++) {
      if (this.splatCount >= MAX_SPLAT_VERTICES) return;
      const i = this.splatCount++;
      this.splatPos.set([cx, cy, cz], i * 3);
      this.splatParams.set([k, R, amount, tex], i * 4);
    }
  }

  /** A burst of smoke (brush), as Particles3D.inject. */
  inject(x, y, z, radiusCells, amount) {
    this._splat(x, y, z, radiusCells, amount * SOURCE_GAIN, -1);
    this.tracers.seed = this.seed;
    this.tracers.spawn(x, y, z, radiusCells * CELL);
  }

  /** Steady trickle for living strokes, as Particles3D.hold. */
  hold(x, y, z, radiusCells, target, tex, scale = 1) {
    this._splat(x, y, z, radiusCells, target * 0.32 * scale, tex);
    if (Math.random() < 0.05 * scale) this.tracers.spawn(x, y, z, radiusCells * CELL, tex);
  }

  /** A push from a fast stroke; velocity in cells per frame. */
  impulse(x, y, z, vx, vy, vz) {
    const [cx, cy, cz] = this._voxel(x, y, z), R = (3.5 * CELL) / this.voxel, k = CELL / this.voxel;
    const k0 = Math.max(0, Math.floor(cz - R)), k1 = Math.min(this.n[2] - 1, Math.floor(cz + R));
    for (let s = k0; s <= k1 && this.velCount < MAX_IMPULSE_VERTICES; s++) {
      const i = this.velCount++;
      this.velPos.set([cx, cy, cz], i * 3);
      this.velParams.set([s, R, 0, 0], i * 4);
      this.velVel.set([vx * k * 0.5, vy * k * 0.5, vz * k * 0.5], i * 3);
    }
  }

  /** Embers and tracers sample a curl-noise flow, like the particle smoke. */
  flow(x, y, z, o) {
    this.tracers.flow(x, y, z, o);
  }

  // --- the box follows the strokes ------------------------------------------

  /** Move the box (and the smoke in it) if a stroke point is near or past a face. */
  follow(x, y, z) {
    const s = followShift(this._voxel(x, y, z), this.n);
    if (!s[0] && !s[1] && !s[2]) return;
    this.flush(); // queued sources are in the old box coordinates
    this.m.shift.uniforms.uShift.value.set(...s);
    this.passes(() => {
      for (const pair of [this.vel, this.scal]) {
        this.run(this.m.shift, pair[1], { uSrc: pair[0].texture });
        pair.reverse();
      }
    });
    this.boxMin.addScaledVector(new THREE.Vector3(...s), this.voxel);
  }

  // --- simulation -----------------------------------------------------------

  /** Render one full-atlas pass into `target`. */
  run(material, target, uniforms = {}) {
    for (const k in uniforms) material.uniforms[k].value = uniforms[k];
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  _clearTarget(target, r = 0, g = 0, b = 0, a = 0) {
    const r0 = this.renderer, c = new THREE.Color(), alpha = r0.getClearAlpha();
    r0.getClearColor(c);
    r0.setRenderTarget(target);
    r0.setClearColor(new THREE.Color(r, g, b), a);
    r0.clear(true, false, false);
    r0.setClearColor(c, alpha);
  }

  /** Run a block of passes with the renderer's state saved. */
  passes(fn) {
    const r = this.renderer, target = r.getRenderTarget(), autoClear = r.autoClear;
    r.autoClear = false;
    fn();
    r.autoClear = autoClear;
    r.setRenderTarget(target);
  }

  clear() {
    this.passes(() => {
      for (const t of [...this.vel, ...this.scal, ...this.p, this.frozen]) this._clearTarget(t);
    });
    this.splatCount = this.velCount = 0;
    this.tracers.clear();
  }

  /** Draw the queued sources into the source targets. */
  _drawSources() {
    const m = this.splatPoints.material;
    m.uniforms.uSeed.value = this.seed;
    m.uniforms.uTime.value = this.frame;
    const draw = (points, count, mode, target) => {
      this._clearTarget(target);
      if (!count) return;
      const g = points.geometry;
      g.setDrawRange(0, count);
      for (const a of ['position', 'aParams', 'aVel']) g.attributes[a].needsUpdate = true;
      m.uniforms.uMode.value = mode;
      this.splatScene.add(points);
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.splatScene, this.camera);
      this.splatScene.remove(points);
    };
    draw(this.splatPoints, this.splatCount, 0, this.srcS);
    draw(this.velPoints, this.velCount, 1, this.srcV);
    this.splatCount = this.velCount = 0;
  }

  /** Apply queued sources now (before a shift or a snapshot). */
  flush() {
    if (!this.splatCount && !this.velCount) return;
    this.passes(() => {
      this._drawSources();
      // Add the sources with a zero-velocity scalar pass.
      this._clearTarget(this.fwd);
      this.run(this.m.maccormack, this.scal[1], {
        uVel: this.fwd.texture, uPhi: this.scal[0].texture, uFwd: this.scal[0].texture, uBwd: this.scal[0].texture, uSrcS: this.srcS.texture,
        uAgeDecay: 0, uCool: 1,
      });
      this.scal.reverse();
      this._clearTarget(this.srcS);
    });
  }

  /** One solver step (one 60 Hz tick). */
  step() {
    const P = this.params, m = this.m, vel = this.vel, scal = this.scal;
    this.tracers.frame = this.frame;
    this.passes(() => {
      this._drawSources();

      this.run(m.curl, this.curl, { uVel: vel[0].texture });
      this.run(m.force, vel[1], {
        uVel: vel[0].texture, uCurl: this.curl.texture, uScal: scal[0].texture, uSrcV: this.srcV.texture,
        uBuoy: P.buoyancy, uEps: P.confinement, uTurb: P.turbulence, uTime: this.frame * 0.01, uAgingFrames: P.agingFrames,
      });
      vel.reverse();
      this.run(m.advect, vel[1], { uVel: vel[0].texture, uSrc: vel[0].texture, uDt: 1, uDamp: 0.995 });
      vel.reverse();

      this.run(m.divergence, this.div, { uVel: vel[0].texture, uScal: scal[0].texture, uExpand: P.expansion });
      this._clearTarget(this.p[0]);
      for (let i = 0; i < JACOBI_ITERATIONS; i++) {
        this.run(m.jacobi, this.p[1], { uP: this.p[0].texture, uDiv: this.div.texture });
        this.p.reverse();
      }
      this.run(m.gradient, vel[1], { uVel: vel[0].texture, uP: this.p[0].texture });
      vel.reverse();

      this.run(m.advect, this.fwd, { uVel: vel[0].texture, uSrc: scal[0].texture, uDt: 1, uDamp: 1 });
      this.run(m.advect, this.bwd, { uVel: vel[0].texture, uSrc: this.fwd.texture, uDt: -1, uDamp: 1 });
      this.run(m.maccormack, scal[1], {
        uVel: vel[0].texture, uPhi: scal[0].texture, uFwd: this.fwd.texture, uBwd: this.bwd.texture, uSrcS: this.srcS.texture,
        uAgeDecay: P.ageDecay, uAgingFrames: P.agingFrames, uCool: P.cooling,
      });
      scal.reverse();
    });
    this.tracers.step();
  }

  /** Freeze the current scalars for rendering (on the frame step). */
  freeze() {
    this.passes(() => this.run(this.m.copy, this.frozen, { uSrc: this.scal[0].texture }));
  }

  // --- undo -----------------------------------------------------------------

  /** Copy of the smoke (not the velocity) and where the box was. */
  snapshot() {
    this.flush();
    const target = this.createTarget();
    this.passes(() => this.run(this.m.copy, target, { uSrc: this.scal[0].texture }));
    return { target, boxMin: this.boxMin.clone() };
  }

  restore(snap) {
    if (!snap.boxMin.equals(this.boxMin)) {
      // The box moved since: the old velocity no longer lines up with the smoke.
      this.boxMin.copy(snap.boxMin);
      this.passes(() => this.vel.forEach((t) => this._clearTarget(t)));
    }
    this.splatCount = this.velCount = 0;
    this.passes(() => this.run(this.m.copy, this.scal[0], { uSrc: snap.target.texture }));
  }

  release(snap) {
    snap.target.dispose();
  }
}
