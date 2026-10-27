// 3D view input.
//   OrbitCamera       orbit / pan / zoom around a target with inertia
//   attachOrbitInput  pointer routing between orbiting, panning and drawing

import * as THREE from 'three';
import { clamp } from '../core/math.js';

export class OrbitCamera {
  /** @param {THREE.PerspectiveCamera} camera */
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.theta = 0.75; // azimuth
    this.phi = 1.22; // polar angle from +y
    this.radius = 2.5;
    this.vTheta = 0;
    this.vPhi = 0;
    this.dragging = false;
    this._plane = new THREE.Plane();
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._hit = new THREE.Vector3();
  }

  place() {
    const { camera, target: t, radius: r, theta, phi } = this;
    camera.position.set(t.x + r * Math.sin(phi) * Math.sin(theta), t.y + r * Math.cos(phi), t.z + r * Math.sin(phi) * Math.cos(theta));
    camera.lookAt(t);
    camera.updateMatrixWorld();
  }

  orbit(dx, dy) {
    this.vTheta = -dx * 0.007;
    this.vPhi = -dy * 0.007;
    this.theta += this.vTheta;
    this.phi = clamp(this.phi + this.vPhi, 0.12, 3.0);
  }

  pan(dx, dy) {
    const m = this.camera.matrixWorld, k = this.radius * 0.0013;
    const right = new THREE.Vector3().setFromMatrixColumn(m, 0), up = new THREE.Vector3().setFromMatrixColumn(m, 1);
    this.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
  }

  zoom(deltaY) {
    this.radius = clamp(this.radius * Math.exp(deltaY * 0.001), 0.25, 8);
  }

  /** Inertia after an orbit drag; call once per frame. */
  update() {
    if (!this.dragging) {
      this.theta += this.vTheta;
      this.phi = clamp(this.phi + this.vPhi, 0.12, 3.0);
      this.vTheta *= 0.9;
      this.vPhi *= 0.9;
    }
    this.place();
  }

  /** Strokes are drawn on the plane through the target facing the camera. */
  setDrawPlane() {
    const n = new THREE.Vector3();
    this.camera.getWorldDirection(n);
    this._plane.setFromNormalAndCoplanarPoint(n, this.target);
  }

  /** World point under the pointer on the draw plane, or null. */
  worldAt(e, canvas) {
    const r = canvas.getBoundingClientRect();
    this._ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
    if (!this._ray.ray.intersectPlane(this._plane, this._hit)) return null;
    return { x: this._hit.x, y: this._hit.y, z: this._hit.z };
  }
}

/**
 * Pointer routing for the 3D canvas.
 * Right / Ctrl / Cmd drag pans; otherwise the view mode (with Shift
 * flipping it) decides between drawing and orbiting. Wheel zooms.
 * @param {object} o
 * @param {() => boolean} o.drawMode          true when plain drag should draw
 * @param {(e: PointerEvent) => boolean} o.onDrawStart  return false to cancel
 * @param {(e: PointerEvent) => void} o.onDrawMove
 * @param {() => void} o.onEnd
 */
export function attachOrbitInput(canvas, orbit, { drawMode, onDrawStart, onDrawMove, onEnd }) {
  let drawing = false, panning = false, last = null;

  const up = () => {
    drawing = panning = orbit.dragging = false;
    onEnd();
    canvas.style.cursor = 'grab';
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    last = [e.clientX, e.clientY];
    if (e.button === 2 || e.ctrlKey || e.metaKey) {
      panning = true;
      canvas.style.cursor = 'move';
      return;
    }
    if (drawMode() !== e.shiftKey) drawing = onDrawStart(e) !== false;
    else {
      orbit.dragging = true;
      canvas.style.cursor = 'grabbing';
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons === 0 && (drawing || orbit.dragging || panning)) return up();
    const dx = e.clientX - (last ? last[0] : e.clientX), dy = e.clientY - (last ? last[1] : e.clientY);
    if (panning) {
      last = [e.clientX, e.clientY];
      orbit.pan(dx, dy);
    } else if (orbit.dragging) {
      last = [e.clientX, e.clientY];
      orbit.orbit(dx, dy);
    } else if (drawing) onDrawMove(e);
  });
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('lostpointercapture', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.zoom(e.deltaY);
  }, { passive: false });
}
