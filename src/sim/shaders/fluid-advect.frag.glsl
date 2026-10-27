// Semi-Lagrangian advection: trace back along the velocity and sample.
// uDt = -1 traces forward (the backward step of MacCormack).
uniform sampler2D uVel;
uniform sampler2D uSrc;
uniform float uDt;
uniform float uDamp;

void main() {
  ivec3 v = voxelAt(gl_FragCoord.xy);
  vec3 p = vec3(v) + 0.5 - uDt * fetch(uVel, v).xyz;
  outColor = sample3(uSrc, p) * uDamp;
}
