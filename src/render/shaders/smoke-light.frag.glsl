// Light through the smoke, per voxel, on the frame step (fluid-common.glsl
// is prepended). Output: r density, g transmittance toward the light
// (Beer-Lambert over a short march), b ambient visibility from six short
// marches, a brush texture.
uniform sampler2D uScal; // frozen scalars: density, temperature, texture, age
uniform vec3 uL;         // toward the light
uniform float uSigma;    // extinction per voxel per unit density

float transmittance(vec3 p, vec3 d, float stepLen, int steps) {
  float tau = 0.0;
  for (int i = 1; i <= 12; i++) {
    if (i > steps) break;
    vec3 q = p + d * (float(i) * stepLen);
    if (any(lessThan(q, vec3(0.0))) || any(greaterThan(q, uN))) break;
    tau += sample3(uScal, q).x;
  }
  return exp(-tau * uSigma * stepLen);
}

void main() {
  ivec3 v = voxelAt(gl_FragCoord.xy);
  vec4 s = fetch(uScal, v);
  if (s.x < 0.002) {
    outColor = vec4(0.0, 1.0, 1.0, s.z); // empty: fully lit, so thin edges catch the light
    return;
  }
  vec3 p = vec3(v) + 0.5;
  float amb = transmittance(p, vec3(1, 0, 0), 2.0, 3) + transmittance(p, vec3(-1, 0, 0), 2.0, 3)
            + transmittance(p, vec3(0, 1, 0), 2.0, 3) + transmittance(p, vec3(0, -1, 0), 2.0, 3)
            + transmittance(p, vec3(0, 0, 1), 2.0, 3) + transmittance(p, vec3(0, 0, -1), 2.0, 3);
  outColor = vec4(s.x, transmittance(p, uL, 1.5, 12), amb / 6.0, s.z);
}
