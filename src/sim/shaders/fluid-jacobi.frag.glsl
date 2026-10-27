// One Jacobi iteration; pressure is zero outside the box.
uniform sampler2D uP;
uniform sampler2D uDiv;

void main() {
  ivec3 v = voxelAt(gl_FragCoord.xy);
  float s = fetch0(uP, v + X).x + fetch0(uP, v - X).x + fetch0(uP, v + Y).x
          + fetch0(uP, v - Y).x + fetch0(uP, v + Z).x + fetch0(uP, v - Z).x;
  outColor = vec4((fetch(uDiv, v).x + s) / 6.0, 0.0, 0.0, 0.0);
}
