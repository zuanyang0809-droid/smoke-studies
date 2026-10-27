#version 300 es
// A smoke card: a quad in card pixels (y down, origin at the center),
// placed in the 3D world by uMVP. The 2D study is one card facing the camera.
in vec2 aPos; // 0..1 over the card
uniform mat4 uMVP;
uniform vec2 uSize; // card size in CSS px
out vec2 vUv;

void main() {
  vUv = aPos;
  gl_Position = uMVP * vec4((aPos - 0.5) * uSize, 0.0, 1.0);
}
