// Right-hand side of the pressure solve, in the 2D solver's convention
// (div = -0.5 * du), plus expansion: hot smoke pushes outward.
uniform sampler2D uVel;
uniform sampler2D uScal;
uniform float uExpand;

void main() {
  ivec3 v = voxelAt(gl_FragCoord.xy);
  float du = fetch(uVel, v + X).x - fetch(uVel, v - X).x
           + fetch(uVel, v + Y).y - fetch(uVel, v - Y).y
           + fetch(uVel, v + Z).z - fetch(uVel, v - Z).z;
  outColor = vec4(-0.5 * du + 0.5 * uExpand * fetch(uScal, v).y, 0.0, 0.0, 0.0);
}
