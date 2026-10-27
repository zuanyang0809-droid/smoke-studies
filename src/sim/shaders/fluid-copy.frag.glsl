// Plain copy (undo snapshots, the frozen frame-step copy).
uniform sampler2D uSrc;

void main() {
  outColor = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
}
