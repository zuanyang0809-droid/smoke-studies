// Move a field by whole voxels when the box follows the strokes.
uniform sampler2D uSrc;
uniform vec3 uShift;

void main() {
  outColor = fetch0(uSrc, voxelAt(gl_FragCoord.xy) + ivec3(uShift));
}
