// ARG phase 2 — the object that replaces the black hole.
//
// After the burn the void is stabilized and a single metal relic hangs where
// the horizon used to be, in front of the new level's panorama. Everything
// here mirrors the Codrops emissive-dissolve demo line by line so the colors
// and the motion are the same:
//
//   https://github.com/JatinChopra/emissive-dissolve-effect  (src/main.ts)
//
//   * MeshPhysicalMaterial  color #636363, metalness 2, roughness 0, DoubleSide
//   * dissolve front        snoise(pos * 0.25) * 16.0 vs uProgress,
//                           edge band 0.8 painted with uEdgeColor #4d9bff
//   * auto animate          uProgress walks -17 -> +14 -> -17 on a loop
//                           (0.08 per 60fps frame), the object is swapped for
//                           the next geometry once it has fully dissolved:
//                           TorusKnot -> Teapot -> Sphere -> Torus
//   * particles             one Point per unique vertex, released by the same
//                           noise front, drifting on the demo's velocity/wave
//                           field, drawn with public/gfx/particle.png
//   * float                 y = sin(t * 2) * 0.5
//   * sky + environment     the sliced panorama (see lib/sky.js)

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TeapotGeometry } from 'three/examples/jsm/geometries/TeapotGeometry.js';
import { dissolve, renderStable, renderReveal } from '../lib/stabilize';
import { loadSky, sky } from '../lib/sky';

// snoise: Ashima / Stefan Gustavson simplex 3D (the three helpers mod289,
// permute and taylorInvSqrt come from <common> where they are NOT defined)
const SNOISE = /* glsl */ `
vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute4(vec4 x) { return mod289v4(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt4(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289v3(i);
  vec4 p = permute4(permute4(permute4(
    i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
    i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
    i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt4(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

const PARTICLE_VERT = /* glsl */ `
uniform float uProgress;
uniform float uEdge;
uniform float uFreq;
uniform float uAmp;
uniform float uBaseSize;
uniform float uPixelDensity;
uniform float uFade;
attribute vec3 aCurrentPos;
attribute float aDist;
attribute float aAngle;
varying float vNoise;
varying float vAngle;
${SNOISE}
void main() {
  vec3 pos = position;
  float noise = snoise(pos * uFreq) * uAmp;
  vNoise = noise;
  vAngle = aAngle;

  // sparks exist only on the burning front (the demo's ±2 noise window)
  if (noise > uProgress - 2.0 && noise < uProgress + uEdge + 2.0) {
    pos = aCurrentPos;
  }

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float size = uBaseSize * uPixelDensity / (aDist + 1.0);
  gl_PointSize = (size / max(0.001, -mv.z)) * uFade;
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAG = /* glsl */ `
precision highp float;
uniform float uProgress;
uniform float uEdge;
uniform float uFade;
uniform vec3 uColor;
uniform sampler2D uTexture;
varying float vNoise;
varying float vAngle;
void main() {
  if (vNoise < uProgress) discard;
  if (vNoise > uProgress + uEdge) discard;
  vec2 coord = gl_PointCoord - 0.5;
  coord = coord * mat2(cos(vAngle), sin(vAngle), -sin(vAngle), cos(vAngle)) + 0.5;
  vec4 tex = texture2D(uTexture, coord + 0.5);
  gl_FragColor = vec4(uColor * tex.rgb * 1.15 * uFade, uFade);
}
`;

// demo constants (src/main.ts)
const EDGE_COLOR = new THREE.Color(0x4d9bff);
const FREQ = 0.25;
const AMP = 16.0;
const EDGE = 0.8;
const PROG_MAX = 14;
const PROG_MIN = -17;

const isMobile = () =>
  typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function geometries() {
  const s1 = isMobile() ? 90 : 140;
  const s2 = isMobile() ? 18 : 32;
  return [
    () => new THREE.TorusKnotGeometry(2.5, 0.8, s1, s1),
    () => new TeapotGeometry(3, s2),
    () => new THREE.SphereGeometry(4.5, s1, s1),
    () => new THREE.TorusGeometry(3, 1.5, s1, s1),
  ];
}

// Points walk the unique vertices: an indexed geometry would emit every
// triangle index instead of the vertex itself
function pointsGeometryOf(g) {
  const p = new THREE.BufferGeometry();
  p.setAttribute('position', g.attributes.position);
  p.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 40);
  return p;
}

// the demo's particle state: where every grain wants to be, where it is now,
// how far it may fly before it snaps back, its velocity, drift and spin
function makeSim(g) {
  const src = g.attributes.position.array;
  const n = g.attributes.position.count;
  const sim = {
    n,
    init: new Float32Array(src),
    curr: new Float32Array(src),
    max: new Float32Array(n),
    vel: new Float32Array(n * 3),
    dist: new Float32Array(n),
    angle: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    sim.max[i] = Math.random() * 5.5 + 1.5;
    sim.vel[i * 3] = Math.random() * 0.5 + 0.5;
    sim.vel[i * 3 + 1] = Math.random() * 0.5 + 0.5;
    sim.vel[i * 3 + 2] = Math.random() * 0.1;
    sim.dist[i] = 0.001;
    sim.angle[i] = Math.random() * Math.PI * 2;
  }
  return sim;
}

function stepSim(sim, dt) {
  const { init, curr, max, vel, dist, angle, n } = sim;
  for (let i = 0; i < n; i++) {
    const ix = i * 3;
    const x = curr[ix];
    const y = curr[ix + 1];

    let vx = vel[ix] * 2.5;
    let vy = vel[ix + 1] * 2.0;
    const vz = vel[ix + 2];

    // four sine lanes per axis (waveAmplitude 0 — the demo's default)
    vx += Math.sin(y * 2) * 0.8 + Math.sin(y * 5) * 0.2 + Math.sin(y * 8) * 0.8 + Math.sin(y * 3) * 0.8;
    vy += Math.sin(x * 2) * 0.6 + Math.sin(x * 1) * 0.9 + Math.sin(x * 5) * 0.6 + Math.sin(x * 7) * 0.6;

    curr[ix] = x + vx * 0.02 * dt;
    curr[ix + 1] = y + vy * 0.02 * dt;
    curr[ix + 2] = curr[ix + 2] + vz * 0.02 * dt;

    const dx = curr[ix] - init[ix];
    const dy = curr[ix + 1] - init[ix + 1];
    const dz = curr[ix + 2] - init[ix + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dist[i] = d;
    angle[i] += 0.01 * dt;
    if (d > max[i]) {
      curr[ix] = init[ix];
      curr[ix + 1] = init[ix + 1];
      curr[ix + 2] = init[ix + 2];
      dist[i] = 0.001;
    }
  }
}

export default function StabilizedRelic() {
  const { gl, scene } = useThree();
  const group = useRef(null);
  const meshRef = useRef(null);
  const pointsRef = useRef(null);

  const clock = useRef(0);
  const progress = useRef(PROG_MIN);
  const dissolving = useRef(true);
  const geoIdx = useRef(0);

  const mobile = isMobile();
  // 0.08 per 60fps frame in the demo -> 4.8 per second (7.2 on mobile)
  const speed = mobile ? 7.2 : 4.8;

  const u = useMemo(
    () => ({
      uProgress: { value: PROG_MIN },
      uEdge: { value: EDGE },
      uFreq: { value: FREQ },
      uAmp: { value: AMP },
      uFade: { value: 0 },
      uColor: { value: EDGE_COLOR.clone() },
      uBaseSize: { value: mobile ? 55 : 90 },
      uPixelDensity: { value: 1 },
      uTexture: { value: null },
    }),
    [mobile]
  );

  const parts = useMemo(() => {
    const makers = geometries();
    const list = makers.map((make) => {
      const geo = make();
      const pgeo = pointsGeometryOf(geo);
      const sim = makeSim(geo);
      pgeo.setAttribute('aCurrentPos', new THREE.BufferAttribute(sim.curr, 3));
      pgeo.setAttribute('aDist', new THREE.BufferAttribute(sim.dist, 1));
      pgeo.setAttribute('aAngle', new THREE.BufferAttribute(sim.angle, 1));
      return { geo, pgeo, sim };
    });
    return list;
  }, []);

  const mat = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x636363),
      metalness: 2.0,
      roughness: 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: 2.2,
      transparent: true,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uProgress = u.uProgress;
      shader.uniforms.uEdge = u.uEdge;
      shader.uniforms.uFreq = u.uFreq;
      shader.uniforms.uAmp = u.uAmp;
      shader.uniforms.uFade = u.uFade;
      shader.uniforms.uEdgeColor = { value: EDGE_COLOR };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vPos;
uniform float uProgress;
uniform float uEdge;
uniform float uFreq;
uniform float uAmp;
uniform float uFade;
uniform vec3 uEdgeColor;
${SNOISE}`
        )
        .replace(
          '#include <dithering_fragment>',
          `  float noise = snoise(vPos * uFreq) * uAmp;
  if (noise < uProgress) discard;
  float dd = noise - uProgress;
  if (dd < uEdge) {
    // the demo paints the whole band with uEdgeColor; we keep a hot core so
    // the rim still reads as glowing without the bloom pass
    float hot = 1.0 - dd / uEdge;
    gl_FragColor.rgb = uEdgeColor * (2.2 + 5.5 * hot * hot);
  }
  gl_FragColor.a *= uFade;
  #include <dithering_fragment>`
        );
    };
    return m;
  }, [u]);

  const pmat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        uniforms: u,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [u]
  );

  // the demo's sprite sheet
  useEffect(() => {
    let tex = null;
    try {
      tex = new THREE.TextureLoader().load('/gfx/particle.png', (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      u.uTexture.value = tex;
      u.uPixelDensity.value = gl.getPixelRatio();
    } catch {
      /* additive points still draw without it */
    }
    return () => {
      if (tex) tex.dispose();
      u.uTexture.value = null;
    };
  }, [gl, u]);

  // the same panorama is the sky in the shader AND what the chrome reflects
  useEffect(() => {
    let alive = true;
    loadSky().then((tex) => {
      if (!alive || !tex) return;
      scene.environment = tex;
    });
    return () => {
      alive = false;
      if (scene.environment && scene.environment.name === 'phase2-sky') {
        scene.environment = null;
      }
    };
  }, [scene]);

  useEffect(
    () => () => {
      parts.forEach(({ geo, pgeo }) => {
        geo.dispose();
        pgeo.dispose();
      });
      mat.dispose();
      pmat.dispose();
    },
    [parts, mat, pmat]
  );

  useFrame((_, delta) => {
    const dt = Math.min(0.1, Math.max(0, delta)); // never leap at 1 fps
    clock.current += dt;
    const t = clock.current;

    // auto animate: the demo walks the front linearly and swaps the mesh for
    // the next geometry the moment it has fully dissolved
    const step = speed * dt;
    if (dissolving.current) {
      progress.current += step;
      if (progress.current > PROG_MAX) {
        dissolving.current = false;
        geoIdx.current += 1;
        const i = geoIdx.current % parts.length;
        if (meshRef.current) meshRef.current.geometry = parts[i].geo;
        if (pointsRef.current) pointsRef.current.geometry = parts[i].pgeo;
      }
    } else {
      progress.current -= step;
      if (progress.current < PROG_MIN) dissolving.current = true;
    }

    u.uProgress.value = progress.current;
    u.uFade.value = renderReveal();
    u.uPixelDensity.value = gl.getPixelRatio();

    // per-frame particle drift (the demo runs it at 60fps)
    const sim = parts[geoIdx.current % parts.length].sim;
    stepSim(sim, Math.min(3, Math.max(0, delta * 60)));
    const pgeo = parts[geoIdx.current % parts.length].pgeo;
    pgeo.attributes.aCurrentPos.needsUpdate = true;
    pgeo.attributes.aDist.needsUpdate = true;
    pgeo.attributes.aAngle.needsUpdate = true;

    if (group.current) {
      group.current.visible = renderStable() > 0.5 && renderReveal() > 0.02;
      group.current.position.y = Math.sin(t * 2.0) * 0.5; // demo float
      group.current.rotation.y = t * 0.17;
      group.current.rotation.x = 0.38 + 0.08 * Math.sin(t * 0.23);
      group.current.rotation.z = 0.07 * Math.cos(t * 0.17);
    }

    if (typeof window !== 'undefined') {
      window.__phase2 = {
        ready: true,
        progress: +progress.current.toFixed(2),
        geo: geoIdx.current % parts.length,
        dissolving: dissolving.current,
        fade: +u.uFade.value.toFixed(3),
        particles: sim.n,
        sky: !!sky.ready,
      };
    }
  });

  const part = parts[0];
  return (
    <group ref={group} scale={1.12}>
      <mesh ref={meshRef} geometry={part.geo} material={mat} />
      <points ref={pointsRef} geometry={part.pgeo} material={pmat} />
    </group>
  );
}
