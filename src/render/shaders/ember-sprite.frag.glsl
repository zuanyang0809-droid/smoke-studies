#version 300 es
precision highp float;
flat in float vR;
flat in vec3 vCol;
flat in vec3 vCore;
out vec4 outColor;

void main() {
  vec2 q = floor(gl_PointCoord * (2.0 * vR + 1.0)) - vR;
  if (abs(q.x) + abs(q.y) > vR) discard;
  outColor = vec4(q == vec2(0.0) && vR > 0.0 ? vCore : vCol, 1.0);
}
