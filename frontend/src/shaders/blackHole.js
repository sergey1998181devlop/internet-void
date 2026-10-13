export const blackHoleVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const blackHoleFragment = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec2  uResolution;
uniform float uTime;
uniform vec3  uCamPos;
uniform vec3  uCamTarget;
uniform float uFov;
uniform float uHorizon;    // event horizon radius (grows with mass)
uniform float uDiskIn;
uniform float uDiskOut;
uniform float uFlash;      // 0..1 gamma burst
uniform float uSpin;       // disk rotation phase
uniform vec4  uRipple[6];  // xy = centre (BH-uv), z = age (s), w = amplitude
uniform float uGlitch;     // 0..1 digital corruption
uniform float uGlitchSuck; // 0..1 the hole swallows the corruption back
uniform float uHiccup;     // 0..1 click-spam overload: jammed neon disk
uniform float uCompress;   // 0..1 big bang squeeze
uniform float uBang;       // 0..1 shockwave flash
uniform float uRetro;      // 0..1 synthwave rickroll palette
uniform float uRetroPulse; // 0..1 bass throb of the chorus
uniform sampler2D uGif;    // rickroll clip filling the shadow
uniform float uGifMix;     // 0..1 how much of it shows through
uniform float uGifAspect;  // width / height of that clip
uniform float uDissolve;   // 0..1 ARG phase 1: the burn front (discard below)
uniform float uStable;     // 0..1 stabilized ultramarine palette of the new void
uniform float uReveal;     // 0..1 reveal of the stabilized scene after the burn
uniform samplerCube uSky;  // phase 2 panorama (6 sliced cube faces)
uniform float uHasSky;     // 0..1 the panorama has decoded

#define STEPS 160
#define PI 3.14159265359

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise2(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return v;
}

// procedural deep-space background with stars
vec3 starfield(vec3 dir) {
  vec3 col = vec3(0.0);

  vec2 sph = vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0)));

  // nebula haze (stabilized: deep ultramarine tones)
  float neb = fbm(sph * 3.0 + 5.0);
  neb = pow(neb, 3.0);
  col += mix(vec3(0.10, 0.06, 0.22), vec3(0.03, 0.10, 0.38), uStable) * neb * 0.55;
  col += mix(vec3(0.03, 0.08, 0.16), vec3(0.02, 0.13, 0.36), uStable) * pow(fbm(sph * 5.0 - 2.0), 4.0) * 0.5;

  // layered star field
  for (int layer = 0; layer < 3; layer++) {
    float scale = 90.0 * pow(2.1, float(layer));
    vec2 uv = sph * scale;
    vec2 id = floor(uv);
    float h = hash21(id + float(layer) * 17.0);
    if (h > 0.972) {
      vec2 f = fract(uv) - 0.5;
      float star = smoothstep(0.24, 0.0, length(f));
      float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h * 4.0) + h * 30.0);
      vec3 tint = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), hash21(id + 3.1));
      col += tint * star * tw * (0.9 - float(layer) * 0.22);
    }
  }
  return col;
}

// accretion disk emission sampled at plane crossing
vec3 diskColor(vec3 hit, vec3 rayVel) {
  float r = length(hit.xz);
  if (r < uDiskIn || r > uDiskOut) return vec3(0.0);

  float t = (r - uDiskIn) / (uDiskOut - uDiskIn);

  // Keplerian orbital direction (counter-clockwise)
  vec3 orbital = normalize(vec3(-hit.z, 0.0, hit.x));

  // Doppler beaming: bright on the approaching side
  float doppler = dot(orbital, -normalize(rayVel));
  float beam = pow(clamp(1.0 + 0.62 * doppler, 0.10, 1.95), 2.1);

  float ang = atan(hit.z, hit.x);
  float rot = uSpin / pow(r, 1.5) * 6.0;

  // turbulent filaments
  float fil = fbm(vec2(ang * 3.0 + rot, r * 1.4));
  float fil2 = fbm(vec2(ang * 9.0 - rot * 1.7, r * 4.0));
  float density = mix(fil, fil2, 0.45);

  // radial profile: hot inner edge, falloff outward
  float inner = smoothstep(0.0, 0.10, t);
  float outer = smoothstep(1.0, 0.55, t);
  float profile = inner * outer;

  float heat = pow(1.0 - t, 2.0);

  vec3 hot  = mix(mix(vec3(1.55, 1.15, 0.82), vec3(1.75, 1.40, 0.30), uRetro), vec3(0.85, 1.30, 1.95), uStable);
  vec3 mid  = mix(mix(vec3(1.35, 0.52, 0.13), vec3(1.55, 0.12, 0.95), uRetro), vec3(0.16, 0.45, 1.70), uStable);
  vec3 cold = mix(mix(vec3(0.45, 0.10, 0.035), vec3(0.30, 0.03, 0.55), uRetro), vec3(0.02, 0.09, 0.46), uStable);
  vec3 base = mix(cold, mix(mid, hot, heat), heat);
  base *= 1.0 + 0.8 * uRetroPulse * uRetro;

  // overload: the disk's palette jams and races through neon RGB
  if (uHiccup > 0.001) {
    float ph = uTime * 14.0 + t * 7.0;
    vec3 neon = 0.55 + 0.45 * cos(vec3(ph, ph + 2.094, ph + 4.188));
    base = mix(base, neon * (1.5 + 0.8 * heat), uHiccup);
  }

  float emission = profile * (0.22 + 1.05 * density) * beam;
  return base * emission * 1.25;
}

// ACES filmic tonemap — keeps the disk from washing out to white
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// camera ray for a screen-space uv (shared by the march and the stable sky)
vec3 rayDir(vec2 uv) {
  vec3 fwd = normalize(uCamTarget - uCamPos);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  float focal = 1.0 / tan(uFov * 0.5);
  return normalize(uv.x * right + uv.y * up + focal * fwd);
}

// One geodesic march. The s argument scales the whole scene outward so the
// hole can be crushed into a point without touching the physics (s = 1 idle).
vec3 renderScene(vec2 uv, float maxSteps, float s, out float captured) {
  vec3 rd = rayDir(uv);

  // conserved angular momentum of the photon -> geodesic bending term
  vec3 hv = cross(uCamPos, rd);
  float h2 = dot(hv, hv);

  vec3 pos = uCamPos * s;
  vec3 vel = rd;

  vec3 color = vec3(0.0);
  float transmit = 1.0;
  captured = 0.0;

  float prevY = pos.y;

  for (int i = 0; i < STEPS; i++) {
    if (float(i) >= maxSteps) break;

    vec3 p = pos / s;                 // back to world units
    float r2 = dot(p, p);
    float r = sqrt(r2);

    if (r < uHorizon) { captured = 1.0; break; }
    if (r > 60.0 && dot(p, vel) > 0.0) { break; }

    // adaptive step: fine near the hole, coarse far away
    float dt = clamp(r * 0.055, 0.02, 0.6);

    // Schwarzschild-like light bending: a = -1.5 * h^2 * r / |r|^5
    vec3 acc = -1.5 * h2 * p / pow(r2, 2.5);
    vel += acc * dt;
    pos += s * vel * dt;

    // accretion disk plane crossing (y = 0)
    float nowY = pos.y;
    if (prevY * nowY < 0.0) {
      float f = prevY / (prevY - nowY);
      vec3 hit = mix(pos - vel * s * dt, pos, f) / s;
      vec3 e = diskColor(hit, vel);
      if (dot(e, e) > 0.0) {
        color += transmit * e;
        transmit *= 0.72; // disk is semi-opaque
        if (transmit < 0.02) break;
      }
    }
    prevY = pos.y;
  }

  if (captured < 0.5) {
    color += transmit * starfield(normalize(vel));
  }
  return color;
}

void main() {
  vec2 frag = vUv * uResolution;
  vec2 uv = (frag - 0.5 * uResolution) / uResolution.y;

  // --- gravitational ripple: every click sends a lensing wave outward --------
  for (int i = 0; i < 6; i++) {
    vec4 rp = uRipple[i];
    if (rp.w > 0.001) {
      vec2 d = uv - rp.xy;
      float dist = length(d);
      if (dist > 1e-5) {
        float env = exp(-rp.z * 2.2) * exp(-dist * 2.4) * rp.w;
        float wave = sin(dist * 26.0 - rp.z * 14.0);
        uv += (d / dist) * wave * env * 0.085;
      }
    }
  }

  // --- 404 / NULL: digital corruption, then the hole eats it back ----------
  // the overload shakes the frame half as hard as the 404 egg does
  float hg = max(uGlitch, uHiccup * 0.55);
  if (hg > 0.001 || uGlitchSuck > 0.001) {
    float g = hg;

    // horizontal tearing per scan band
    float band = floor(frag.y / 14.0);
    float rnd = hash11(band + floor(uTime * 26.0));
    float on = step(0.55, hash11(band * 1.7 + floor(uTime * 21.0)));
    uv.x += (rnd - 0.5) * 0.30 * g * on;

    // blocky artefacts
    vec2 cell = floor(frag / 24.0);
    float nh = hash21(cell + floor(uTime * 16.0));
    float nh2 = hash21(cell.yx - floor(uTime * 12.0));
    uv += vec2(nh - 0.5, nh2 - 0.5) * 0.09 * g * step(0.88, nh);

    // the last half second: everything is pulled toward the horizon
    uv = mix(uv, uv * 0.62, uGlitchSuck * 0.9);
  }

  vec3 color;
  float cap = 0.0;
  float split = max(uGlitch, uHiccup * 0.9);
  if (uStable > 0.5) {
    // ARG phase 2: the horizon is gone for good. No geodesic march here —
    // the new level's panorama (sliced from one equirect image into the six
    // cube faces, exactly like the Codrops demo's cubeMap2) hangs straight
    // where the black hole used to, with the settled singularity core and
    // its thin photon ring drawn on top.
    vec3 rd = rayDir(uv);
    vec3 sky = starfield(rd) * 1.30;
    if (uHasSky > 0.5) sky = textureCube(uSky, rd).rgb;
    color = sky;
    float rr = length(uv);
    float pulse = 0.88 + 0.12 * sin(uTime * 1.7);
    color += vec3(0.34, 0.58, 1.50) * exp(-rr * 6.5) * 0.95 * pulse;
    color += vec3(0.50, 0.90, 1.85) * smoothstep(0.22, 0.0, rr) * 0.60 * pulse;
    color += vec3(1.10, 1.25, 1.55) * smoothstep(0.055, 0.0, rr) * 2.40 * pulse;
    float ring = smoothstep(0.045, 0.0, abs(rr - 0.115));
    color += vec3(0.55, 0.95, 1.90) * ring * 0.85 * pulse;
  } else if (split > 0.01) {
    // RGB channel split (cheap: side passes use fewer steps)
    float sh = 0.005 + 0.010 * split;
    float sideA, sideB;
    vec3 cr = renderScene(uv + vec2(sh, 0.0), 56.0, 1.0, sideA);
    vec3 cg = renderScene(uv, 160.0, 1.0, cap);
    vec3 cb = renderScene(uv - vec2(sh, 0.0), 56.0, 1.0, sideB);
    color = vec3(cr.r, cg.g, cb.b);

    // inverted scanlines + global flicker
    float sl = step(0.5, fract(frag.y * 0.14 - uTime * 4.0));
    color = mix(color, vec3(1.0) - color, uGlitch * 0.25 * sl);
    color *= 1.0 + 0.18 * split * (hash11(floor(uTime * 30.0)) - 0.5);
  } else {
    // big bang squeeze: the whole scene is pushed away from the hole
    float s = 1.0 / max(0.06, 1.0 - 0.94 * uCompress);
    color = renderScene(uv, 160.0, s, cap);
  }

  // tonemap + gamma
  color *= 1.0 + uCompress * uCompress * 2.5;
  color = aces(color * 0.85);
  color = pow(color, vec3(0.4545));

  // --- rickroll: the clip takes over the black interior of the shadow -------
  if (uGifMix > 0.002 && cap > 0.5) {
    float rim = (2.9 * uHorizon) / max(length(uCamPos) * tan(uFov * 0.5), 1e-4);
    vec2 p = uv / max(rim, 1e-4);
    // cover-fit: the circle keeps the full height, the sides are cropped
    vec2 g = vec2(0.5 + p.x / (2.0 * uGifAspect), 0.5 + p.y * 0.5);
    if (g.x > 0.0 && g.x < 1.0 && g.y > 0.0 && g.y < 1.0) {
      vec3 clip = texture2D(uGif, g).rgb;
      // only the void: the disk crossing in front of the shadow stays
      float lum = dot(color, vec3(0.299, 0.587, 0.114));
      float dark = 1.0 - smoothstep(0.02, 0.16, lum);
      color = mix(color, clip, clamp(uGifMix, 0.0, 1.0) * dark);
    }
  }

  // the crushed singularity: a blinding point where the hole used to be
  if (uCompress > 0.001) {
    float rr = length(uv);
    float coreR = mix(0.10, 0.006, uCompress);
    float core = smoothstep(coreR, coreR * 0.2, rr);
    color += vec3(1.5, 1.3, 0.95) * core * (0.35 + 2.6 * uCompress);
  }

  // gamma burst wash
  color = mix(color, vec3(1.0), clamp(uFlash, 0.0, 1.0));

  // big bang: white-hot flash + an expanding golden shockwave
  if (uBang > 0.001) {
    float b = clamp(uBang, 0.0, 1.0);
    color = mix(color, vec3(1.0, 0.97, 0.9), clamp(b * 1.5, 0.0, 1.0));
    float rr = length(uv);
    float ringR = (1.0 - b) * 1.9;
    float ring = smoothstep(0.16, 0.0, abs(rr - ringR));
    color += vec3(1.0, 0.80, 0.46) * ring * b * 1.4;
    color += vec3(1.0, 0.72, 0.34) * smoothstep(0.5, 0.0, rr) * b * 0.5;
  }

  // vignette
  float vig = smoothstep(1.35, 0.35, length(uv * 1.15));
  color *= mix(0.55, 1.0, vig);

  // subtle film grain
  float grain = hash21(frag + fract(uTime) * 1000.0) - 0.5;
  color += grain * 0.025;

  // --- ARG phase 1: emissive dissolve (Codrops-style burn front) -----------
  // noisy radial threshold: the front eats the scene from the core outward,
  // the rim is an orange->violet emissive ramp at ~x10 brightness (0.05 UV)
  if (uDissolve > 0.0001) {
    float rr = clamp(length(uv) * 1.15, 0.0, 1.0);
    float n = clamp(mix(rr, fbm(uv * 3.1 + 17.3), 0.45), 0.0, 1.0);
    float p = uDissolve * 1.20 - 0.10;
    if (n < p) discard;
    float d = n - p;
    float t = clamp(d / 0.05, 0.0, 1.0);
    vec3 emis = mix(vec3(1.75, 0.55, 0.06), vec3(0.72, 0.24, 1.55), t);
    float glow = 1.0 - smoothstep(0.0, 0.24, d);
    float band = 1.0 - smoothstep(0.0, 0.05, d);
    float hot = 1.0 - smoothstep(0.0, 0.015, d);
    color += emis * (glow * 0.85 + band * 2.6 + hot * 6.8);
  }

  // after the burn the old void is gone: fade the stabilized scene in
  color *= uReveal;

  gl_FragColor = vec4(color, 1.0);
}
`;
