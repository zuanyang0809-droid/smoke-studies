// Diamond-shaped sprite, matching the 2D pixel embers.
varying vec3 vC;

void main() {
  vec2 q = abs(gl_PointCoord - 0.5);
  if (q.x + q.y > 0.5) discard;
  gl_FragColor = vec4(vC, 1.0);
}
