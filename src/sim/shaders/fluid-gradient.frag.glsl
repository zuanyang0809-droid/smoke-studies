// Subtract the pressure gradient: the velocity becomes divergence-free.
uniform sampler2D uVel;
uniform sampler2D uP;

void main() {
  ivec3 v = voxelAt(gl_FragCoord.xy);
  vec3 g = vec3(
    fetch0(uP, v + X).x - fetch0(uP, v - X).x,
    fetch0(uP, v + Y).x - fetch0(uP, v - Y).x,
    fetch0(uP, v + Z).x - fetch0(uP, v - Z).x);
  outColor = vec4(fetch(uVel, v).xyz - 0.5 * g, 0.0);
}
