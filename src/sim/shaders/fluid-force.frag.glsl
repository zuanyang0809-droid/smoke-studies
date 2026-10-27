// Forces: impulses from strokes, buoyancy, vorticity confinement
// (Fedkiw et al. 2001) and a little noise turbulence inside the smoke,
// then damping in clear air and a speed limit.
uniform sampler2D uVel;
uniform sampler2D uCurl;
uniform sampler2D uScal;  // density, temperature, texture, age
uniform sampler2D uSrcV;
uniform float uBuoy;
uniform float uEps;
uniform float uTurb;
uniform float uTime;

void main() {
  ivec3 v = voxelAt(gl_FragCoord.xy);
  vec3 u = fetch(uVel, v).xyz + fetch(uSrcV, v).xyz;
  vec4 s = fetch(uScal, v);
  // Hot smoke rises fast; it cools, slows and spreads.
  u.y += uBuoy * (s.y + 0.2 * s.x);

  vec3 g = 0.5 * vec3(
    fetch(uCurl, v + X).w - fetch(uCurl, v - X).w,
    fetch(uCurl, v + Y).w - fetch(uCurl, v - Y).w,
    fetch(uCurl, v + Z).w - fetch(uCurl, v - Z).w);
  // Confinement and turbulence act inside the smoke only; in clear air the
  // flow calms down, otherwise confinement keeps feeding stray swirls.
  float inSmoke = min(1.0, s.x * 10.0);
  u += inSmoke * uEps * cross(g / (length(g) + 1e-5), fetch(uCurl, v).xyz);
  if (s.x > 0.002) {
    vec3 q = vec3(v) * 0.15 + vec3(0.0, -uTime * 0.6, uTime * 0.2);
    u += uTurb * min(1.0, s.x * 4.0) * (vec3(noise3(q), noise3(q + 17.3), noise3(q + 41.9)) - 0.5);
  }
  u *= mix(0.96, 1.0, inSmoke);
  // Keep the step stable: at most 3 voxels per step.
  float speed = length(u);
  if (speed > 3.0) u *= 3.0 / speed;
  outColor = vec4(u, 0.0);
}
