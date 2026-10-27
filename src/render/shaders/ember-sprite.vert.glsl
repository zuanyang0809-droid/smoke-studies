#version 300 es
// Embers on a card: point sprites drawn as pixel diamonds (see toon2d.js).
in vec2 aPos;   // grid cells
in float aR;    // diamond radius in ember pixels
in vec3 aCol;   // 0..1
in vec3 aCore;
uniform mat4 uMVP;
uniform vec2 uSize;  // card size in CSS px
uniform vec2 uCell;  // CSS px per grid cell
uniform float uPix;  // CSS px per ember pixel
uniform float uScale; // perspective distance * device pixel ratio
flat out float vR;
flat out vec3 vCol;
flat out vec3 vCore;

void main() {
  vR = aR;
  vCol = aCol;
  vCore = aCore;
  gl_Position = uMVP * vec4(aPos * uCell - uSize * 0.5, 0.0, 1.0);
  gl_PointSize = (2.0 * aR + 1.0) * uPix * uScale / gl_Position.w;
}
