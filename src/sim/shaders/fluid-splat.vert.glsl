// A source (brush, living stroke, impulse) drawn into one z slice of the
// atlas as a point sprite; the fragment shader cuts it to a sphere.
precision highp float;
in vec3 position;  // sphere center, voxel coordinates
in vec4 aParams;   // slice, radius (voxels), amount, texture (-1 = noise)
in vec3 aVel;      // impulse, voxels per step
uniform vec3 uN;
uniform vec2 uTiles;
uniform vec2 uAtlas;
flat out vec3 vCenter;
flat out vec4 vParams;
flat out vec3 vVel;

void main() {
  vCenter = position;
  vParams = aParams;
  vVel = aVel;
  float ty = floor(aParams.x / uTiles.x), tx = aParams.x - ty * uTiles.x;
  vec2 px = vec2(tx, ty) * uN.xy + position.xy;
  gl_Position = vec4(px / uAtlas * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 2.0 * aParams.y + 2.0;
}
