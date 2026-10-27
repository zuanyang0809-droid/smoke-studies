// Sources, added up with additive blending.
//   mode 0, scalars:  density, heat, texture * density, falloff (resets age)
//   mode 1, velocity: impulse * falloff
flat in vec3 vCenter;
flat in vec4 vParams;
flat in vec3 vVel;
uniform int uMode;
uniform float uSeed;
uniform float uTime;

void main() {
  ivec3 v = voxelAt(gl_FragCoord.xy);
  if (v.z != int(vParams.x + 0.5)) discard; // the sprite spilled into a neighbor slice
  float r = length(vec3(v) + 0.5 - vCenter) / vParams.y;
  if (r >= 1.0) discard;
  float fall = 1.0 - r;
  if (uMode == 1) {
    outColor = vec4(vVel * fall, fall);
    return;
  }
  // Brush texture: noise per voxel, pulled toward the stroke's own value for living strokes.
  float n = noise3(vec3(v) * 0.4 + vec3(uSeed, 0.0, uTime * 0.05));
  float t = vParams.w < 0.0 ? n : mix(n, vParams.w, 0.5);
  float add = vParams.z * fall;
  outColor = vec4(add, add, t * add, fall);
}
