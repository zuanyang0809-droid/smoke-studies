// Embers as screen-facing points sized by distance.
attribute float size;
attribute vec3 col;
varying vec3 vC;
uniform float scale;

void main() {
  vC = col;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, size * scale / -mv.z);
  gl_Position = projectionMatrix * mv;
}
