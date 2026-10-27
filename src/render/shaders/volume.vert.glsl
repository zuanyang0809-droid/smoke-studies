// Box proxy for the volume: pass the world position to the ray marcher.
varying vec3 vW;

void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
