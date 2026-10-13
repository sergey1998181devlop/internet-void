// Spaghettification ribbon.
//
// Both passes share this vertex shader: a strip whose centreline follows an
// accelerating inspiral. The tail lags behind the head and the lag grows as it
// falls, so the object is drawn out into a thread instead of shrinking into a
// card. Everything is then tested against the shadow edge in screen space —
// matter is eaten exactly at the rim and never floats across the black disk.

export const voidObjectVertex = /* glsl */ `
precision highp float;

uniform float uProgress;   // 0 = spawned, 1 = swallowed
uniform float uTime;
uniform float uR0;         // spawn radius (world)
uniform float uAng0;       // spawn azimuth
uniform float uY0;         // spawn height above the disk plane
uniform float uSwirl;      // radians of orbit over the whole fall
uniform float uWidth;      // ribbon half-width at spawn
uniform float uLag0;       // tail lag at spawn (path units)
uniform float uLagK;       // extra lag near the end (spaghettification)
uniform float uRim;        // shadow radius in BH-uv units
uniform float uAspect;

varying vec2 vUv;
varying float vVis;
varying float vHeat;
varying float vUh;

vec3 pathAt(float u) {
  float uu = clamp(u, 0.0, 1.0);
  float e = uu * uu;                       // gravity speeds the fall up
  float r = uR0 * (1.0 - e) + 0.10;
  float ang = uAng0 + e * uSwirl;
  float y = uY0 * (1.0 - pow(uu, 1.35));
  return vec3(cos(ang) * r, y, sin(ang) * r);
}

void main() {
  vUv = uv;
  float uh = clamp(uProgress, 0.0, 1.0);
  vUh = uh;

  // tail lag: grows as the object is stretched, collapses at the very end so
  // the whole thread is swallowed at once
  float lag = (uLag0 + uLagK * pow(uh, 1.7)) * (1.0 - smoothstep(0.66, 1.0, uh));
  float uHead = uh;
  float uTail = max(0.0, uh - lag);
  float t = uv.x;                          // 0 = tail, 1 = head
  float u = mix(uTail, uHead, t);

  vec3 P = pathAt(u);
  vec3 Pa = pathAt(u - 0.014);
  vec3 Pb = pathAt(u + 0.014);
  vec3 T = normalize(Pb - Pa);
  vec3 V = normalize(cameraPosition - P);
  vec3 S = cross(T, V);
  float sl = length(S);
  S = sl > 1e-5 ? S / sl : vec3(0.0, 1.0, 0.0);

  // long and needle-thin near the singularity, chunky and readable at spawn
  float w = uWidth * mix(1.0, 0.20, uh) * mix(1.0, 0.40, t);
  w *= 1.0 + 0.10 * sin(u * 55.0 + uTime * 7.0);
  P += S * (uv.y - 0.5) * w;

  vec4 clip = projectionMatrix * modelViewMatrix * vec4(P, 1.0);
  if (clip.w <= 0.001) {
    vVis = 0.0;
    vHeat = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec2 ndc = clip.xy / clip.w;
  vec2 suv = vec2(ndc.x * 0.5 * uAspect, ndc.y * 0.5);
  float d = length(suv);

  // swallowed by the horizon: gone exactly at the rim of the shadow
  vVis = smoothstep(uRim * 1.0, uRim * 1.55, d);
  // friction with the photon sphere heats the matter up as it nears the edge
  vHeat = 1.0 - smoothstep(uRim * 1.05, uRim * 3.4, d);

  gl_Position = clip;
}
`;

export const voidObjectFragment = /* glsl */ `
precision highp float;

uniform sampler2D uMap;
uniform float uTime;
uniform float uProgress;

varying vec2 vUv;
varying float vVis;
varying float vHeat;
varying float vUh;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  if (vVis < 0.012) discard;

  vec2 uv = vUv;
  vec4 tex = texture2D(uMap, uv);

  // opaque dark shard so the object stays readable against the glowing disk
  float ex = smoothstep(0.0, 0.11, uv.x) * smoothstep(1.0, 0.89, uv.x);
  float ey = smoothstep(0.0, 0.28, uv.y) * smoothstep(1.0, 0.72, uv.y);
  float plate = ex * ey;

  float streak = 0.5 + 0.5 * sin(uv.x * 74.0 - uTime * 6.0 + uv.y * 9.0);
  float grain = hash21(floor(vec2(uv.x * 150.0, uv.y * 14.0)) + floor(uTime * 8.0));

  vec3 col = mix(vec3(0.030, 0.020, 0.045), vec3(0.20, 0.075, 0.030), streak * 0.65);
  col += grain * 0.045;
  col = mix(col, vec3(1.0, 0.86, 0.64), tex.a);       // the text / image itself
  col = mix(col, vec3(1.35, 0.70, 0.28), vHeat * 0.7);
  col = mix(col, vec3(2.1, 1.8, 1.5), vHeat * vHeat); // incandescent at the rim

  float alpha = max(plate * 0.94, tex.a * 0.95) * vVis;
  if (alpha < 0.02) discard;

  gl_FragColor = vec4(pow(max(col, 0.0), vec3(0.4545)), alpha);
}
`;

export const voidObjectDebugFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vVis;
varying float vHeat;
varying float vUh;
void main() {
  gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
}
`;

// ?visdbg=1: red = vVis, green = vHeat — shows exactly what the ribbon's
// screen-space visibility test computes at every fragment
export const voidObjectVisDebugFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vVis;
varying float vHeat;
varying float vUh;
void main() {
  gl_FragColor = vec4(vVis, vHeat, 0.0, 1.0);
}
`;

// additive pass: hot core line + flare at the head, layered over the body
export const voidObjectGlowFragment = /* glsl */ `
precision highp float;

uniform float uTime;

varying vec2 vUv;
varying float vVis;
varying float vHeat;
varying float vUh;

void main() {
  if (vVis < 0.012) discard;

  float core = pow(max(0.0, 1.0 - abs(vUv.y - 0.5) * 2.0), 2.2);
  float tip = smoothstep(0.55, 1.0, vUv.x);
  float grain = 0.75 + 0.25 * sin(vUv.x * 120.0 - uTime * 14.0);

  float a = core * (0.26 + 0.74 * vHeat) * 0.8 * grain + tip * core * 0.55;
  a *= vVis;
  if (a < 0.01) discard;

  vec3 col = mix(vec3(1.0, 0.52, 0.18), vec3(1.0, 0.96, 0.88), vHeat);
  col = mix(col, vec3(1.0, 0.90, 0.70), tip * 0.6);
  gl_FragColor = vec4(pow(col, vec3(0.4545)), a);
}
`;
