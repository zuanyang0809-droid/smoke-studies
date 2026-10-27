// Vorticity w = curl(u), and |w| for the confinement direction.
uniform sampler2D uVel;

void main() {
  ivec3 v = voxelAt(gl_FragCoord.xy);
  vec3 dx = fetch(uVel, v + X).xyz - fetch(uVel, v - X).xyz;
  vec3 dy = fetch(uVel, v + Y).xyz - fetch(uVel, v - Y).xyz;
  vec3 dz = fetch(uVel, v + Z).xyz - fetch(uVel, v - Z).xyz;
  vec3 w = 0.5 * vec3(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x);
  outColor = vec4(w, length(w));
}
