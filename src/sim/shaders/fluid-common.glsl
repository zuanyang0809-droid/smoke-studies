// Shared by every 3D fluid pass. The nx * ny * nz volume is stored as a 2D
// atlas of z slices, uTiles.x slices per row. Voxel centers sit at
// integer + 0.5 in voxel coordinates. Prepended to each fragment shader.
precision highp float;
precision highp int;
precision highp sampler2D;

uniform vec3 uN;     // nx, ny, nz
uniform vec2 uTiles; // slices per atlas row, rows
uniform vec2 uAtlas; // atlas size in texels
out vec4 outColor;

/** Voxel written by this fragment. */
ivec3 voxelAt(vec2 frag) {
  ivec2 p = ivec2(frag);
  ivec3 n = ivec3(uN);
  int tx = p.x / n.x, ty = p.y / n.y;
  return ivec3(p.x - tx * n.x, p.y - ty * n.y, ty * int(uTiles.x) + tx);
}

bool outside(ivec3 v) {
  return any(lessThan(v, ivec3(0))) || any(greaterThanEqual(v, ivec3(uN)));
}

/** One voxel; out-of-box reads repeat the face (zero gradient). */
vec4 fetch(sampler2D t, ivec3 v) {
  v = clamp(v, ivec3(0), ivec3(uN) - 1);
  int tx = v.z % int(uTiles.x), ty = v.z / int(uTiles.x);
  return texelFetch(t, ivec2(tx * int(uN.x) + v.x, ty * int(uN.y) + v.y), 0);
}

/** One voxel; zero outside the box (open boundary for pressure). */
vec4 fetch0(sampler2D t, ivec3 v) {
  return outside(v) ? vec4(0.0) : fetch(t, v);
}

vec2 sliceUV(vec2 xy, float k) {
  float ty = floor(k / uTiles.x), tx = k - ty * uTiles.x;
  return (vec2(tx, ty) * uN.xy + xy) / uAtlas;
}

/** Trilinear sample at voxel coordinates: hardware bilinear in xy, mixed across two slices. */
vec4 sample3(sampler2D t, vec3 p) {
  p = clamp(p, vec3(0.5), uN - 0.5);
  float z = p.z - 0.5, k0 = floor(z), k1 = min(k0 + 1.0, uN.z - 1.0);
  return mix(texture(t, sliceUV(p.xy, k0)), texture(t, sliceUV(p.xy, k1)), z - k0);
}

// Value noise in 0..1 (brush texture at injection, turbulence).
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

const ivec3 X = ivec3(1, 0, 0), Y = ivec3(0, 1, 0), Z = ivec3(0, 0, 1);
