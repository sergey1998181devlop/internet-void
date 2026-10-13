// Card-suck shader injected into a MeshBasicMaterial via onBeforeCompile.
//
// The geometry is one merged mesh of quads: every quad is a shard of the hero
// card. Attributes (all constant for the whole suck):
//   position — the corner of the shard inside its own cell
//   aCenter  — where the cell sits on the card   (p = 0: the intact card)
//   aSphere  — its spot on the fib-sphere cloud  (the "world turns" bloom)
//   aTo      — where it flies when the cloud bursts into fine dust
//   aAnim    — (turn stagger, swallow stagger, burst spin, size jitter)
//   aAxis    — (tumble axis xyz, spin rate w)
//   aDrop    — (offset inside its droplet xyz, droplet id w = 0/1/2)
//
// uP: 0 .. 1 over the whole suck, after the glide to the centre
//   0.00 - 0.30  turns: the card blooms into a sphere cloud while the whole
//                 mesh turns a full 2*PI (the rotation lives in JS)
//   0.30 - 0.46  shatter: the cloud bursts apart into very fine tumbling dust
//   0.46 - 0.64  droplets: the dust packs into three living blobs — they
//                 swirl, breathe and drift like a school of fish
//   0.64 - 0.76  the blobs live on their own, fully formed
//   0.76 - 1.00  swallow: one blob after another swings along the horizon
//                 edge, spaghettifies and slips over it — never the centre
//
// PHASES below must stay in sync with the JS side (VoidObjects.jsx).

export const PHASES = { turn: 0.3, shatter: 0.46, droplets: 0.64, swallow: 0.76 };

const HELPERS = /* glsl */ `
  float easeIO(float t) {
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
  }
  float easeOut(float t) {
    float u = 1.0 - t;
    return 1.0 - u * u * u;
  }
  float easeIn(float t) {
    return t * t * t;
  }
  vec3 rotAxis(vec3 v, vec3 ax, float a) {
    float c = cos(a);
    float s = sin(a);
    return v * c + cross(ax, v) * s + ax * dot(ax, v) * (1.0 - c);
  }
`;

export const shatterParsV = /* glsl */ `
  uniform float uP;
  uniform float uRim; // horizon edge radius in card-plane world units
  uniform vec3 uBase[3]; // centres of the three living droplets
  attribute vec3 aCenter;
  attribute vec3 aSphere;
  attribute vec3 aTo;
  attribute vec4 aAnim;
  attribute vec4 aAxis;
  attribute vec4 aDrop;
  varying float vSuckA;
  varying float vSuckGlow;
  ${HELPERS}
`;

export const shatterParsF = /* glsl */ `
  varying float vSuckA;
  varying float vSuckGlow;
`;

export const shatterVertex = /* glsl */ `
  float d1 = aAnim.x;
  float d2 = aAnim.y;
  float seed = aAnim.z + aAnim.w * 3.7;

  // ---- turns: bloom from the flat card into the sphere cloud ------------
  float sT = clamp((uP - 0.09 * d1) / 0.22, 0.0, 1.0);
  float eT = easeIO(sT);
  vec3 pPos = mix(aCenter, aSphere, eT);

  // ---- shatter: the cloud bursts apart into very fine dust --------------
  float sS = clamp((uP - 0.30 - 0.06 * d1) / 0.10, 0.0, 1.0);
  float eS = easeOut(sS);
  pPos = mix(pPos, aTo, eS);

  // ---- droplets: the dust gathers into one of three living blobs --------
  int id = int(aDrop.w + 0.5);
  float fid = float(id);
  float dir = id == 0 ? 1.0 : (id == 1 ? -1.15 : 0.9);
  float sD = clamp((uP - 0.46 - 0.05 * d1) / 0.13, 0.0, 1.0);
  float eD = easeIO(sD);

  vec3 local = aDrop.xyz;
  vec3 cAx = normalize(vec3(0.25 + fid * 0.25, 0.85, 0.45 - fid * 0.35));
  local = rotAxis(local, cAx, (uP - 0.50) * 9.0 * dir + fid * 2.1);
  local *= 1.0 + 0.07 * sin(uP * 30.0 + fid * 2.0);
  local += 0.05 * vec3(
    sin(uP * 22.0 + seed),
    sin(uP * 19.0 + seed * 1.7),
    sin(uP * 17.0 + seed * 2.3)
  );
  vec3 drift = 0.14 * vec3(
    sin(uP * 9.0 + fid * 2.1),
    cos(uP * 7.0 + fid * 1.3),
    sin(uP * 5.0 + fid)
  );
  vec3 pDrop = uBase[id] + drift + local;
  pPos = mix(pPos, pDrop, eD);

  // ---- swallow: swing along the rim and slip over the edge --------------
  float dsw = fid * 0.06 + d2 * 0.045;
  float sW = clamp((uP - 0.76 - dsw) / max(0.10, 0.99 - 0.76 - dsw), 0.0, 1.0);
  float eW = easeIn(sW);

  float r0 = max(length(uBase[id].xy), 0.3);
  float th0 = atan(uBase[id].y, uBase[id].x);
  float th = th0 + 2.1 * eW;
  float r = mix(r0, uRim * 1.05, eW);
  vec3 sink = vec3(cos(th) * r, sin(th) * r, -2.4 * eW * eW);

  // spaghettify: stretch along the rim, squeeze across it
  vec3 tang = vec3(-sin(th), cos(th), 0.0);
  float along = dot(local, tang);
  vec3 perp = local - tang * along;
  local = tang * along * (1.0 + 3.2 * eW * eW) + perp * (1.0 - 0.62 * eW);
  vec3 pSw = sink + local * (1.0 - 0.5 * eW);

  pPos = mix(pPos, pSw, eW);

  // size: full card shards -> fine dust -> packed grains -> melted away
  float sz = mix(1.0, 0.55, smoothstep(0.30, 0.46, uP));
  sz = mix(sz, 1.0, eD);
  sz *= mix(1.0, aAnim.w, smoothstep(0.0, 0.2, uP));
  sz *= 1.0 - 0.85 * eW;

  float ang = aAnim.z * (eT + 1.3 * eS + 1.4 * eW) + aAxis.w * uP * 2.0;

  vSuckA = 1.0 - smoothstep(0.5, 0.98, eW);
  vSuckGlow = smoothstep(0.55, 1.0, eW) * 0.7;

  vec3 transformed = pPos + rotAxis(position * sz, aAxis.xyz, ang);
`;

export const shatterFrag = /* glsl */ `
  diffuseColor.a *= vSuckA;
  diffuseColor.rgb += vec3(1.3, 0.62, 0.26) * vSuckGlow;
`;
