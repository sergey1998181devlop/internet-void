// ARG phase 1: ash for the burn front. While the shader eats the old void,
// sparks spawn exactly where the front sits right now (its radius sweeps the
// disk outward) and spiral down into the centre of the abyss, dying out
// before the stabilized scene has fully faded in.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { dissolve } from '../lib/stabilize';

const N = 720;
const SPAWN_RATE = 300; // particles per real second while burning
const DISK_IN = 2.6;
const DISK_OUT = 9.5;

const VERT = /* glsl */ `
attribute float aLife;
attribute float aSeed;
varying float vLife;
varying float vSeed;
void main() {
  vLife = aLife;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float grow = smoothstep(0.0, 0.15, aLife);
  gl_PointSize = (1.6 + 4.4 * aSeed) * (180.0 / max(0.001, -mv.z)) * grow;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying float vLife;
varying float vSeed;
void main() {
  if (vLife <= 0.0) discard;
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.06, length(c));
  // orange at birth -> violet ash while it falls into the void
  vec3 col = mix(vec3(1.75, 0.62, 0.07), vec3(0.68, 0.24, 1.55), 1.0 - vSeed);
  float fade = sin(3.14159 * clamp(vLife, 0.0, 1.0));
  gl_FragColor = vec4(col * fade * 2.4, a * fade);
}
`;

export default function DissolveParticles() {
  const points = useRef(null);

  const sim = useMemo(() => {
    const positions = new Float32Array(N * 3);
    const life = new Float32Array(N); // 0 = dead, 1 = fresh
    const seed = new Float32Array(N);
    const r = new Float32Array(N);
    const ang = new Float32Array(N);
    const y = new Float32Array(N);
    const vr = new Float32Array(N);
    const vy = new Float32Array(N);
    const spin = new Float32Array(N);
    const maxLife = new Float32Array(N);
    const age = new Float32Array(N);
    for (let i = 0; i < N; i++) seed[i] = Math.random();
    return { positions, life, seed, r, ang, y, vr, vy, spin, maxLife, age, cursor: 0 };
  }, []);

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(sim.positions, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(sim.life, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(sim.seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 40);
    return g;
  }, [sim]);

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  );

  useFrame((_, delta) => {
    const s = sim;
    const dt = Math.min(0.05, delta);
    const active = dissolve.running && dissolve.phase === 'burn';

    // spawn along the current radius of the burn front
    if (active) {
      let count = Math.min(8, Math.ceil(SPAWN_RATE * dt));
      while (count-- > 0) {
        const i = s.cursor;
        s.cursor = (s.cursor + 1) % N;
        const front = DISK_IN * 0.35 + dissolve.p * (DISK_OUT - DISK_IN * 0.35);
        s.r[i] = Math.max(0.6, front * (0.82 + Math.random() * 0.4));
        s.ang[i] = Math.random() * Math.PI * 2;
        s.y[i] = (Math.random() - 0.5) * 0.7;
        s.vr[i] = -(0.7 + Math.random() * 1.7);
        s.vy[i] = (Math.random() - 0.5) * 0.5;
        s.spin[i] = 0.8 + Math.random() * 1.6;
        s.maxLife[i] = 1.4 + Math.random() * 1.6;
        s.age[i] = 0;
        s.life[i] = 1;
      }
    }

    let any = false;
    for (let i = 0; i < N; i++) {
      if (s.life[i] <= 0) continue;
      any = true;
      s.age[i] += dt;
      const t = s.age[i] / s.maxLife[i];
      if (t >= 1) {
        s.life[i] = 0;
        s.positions[i * 3 + 1] = -999;
        continue;
      }
      s.life[i] = 1 - t;
      // spiral: pull inward (faster as it nears the centre) + orbit + drift
      s.vr[i] *= 1 + 1.4 * dt;
      s.r[i] = Math.max(0.25, s.r[i] + s.vr[i] * dt);
      s.ang[i] += s.spin[i] * dt;
      s.y[i] += s.vy[i] * dt;
      s.vy[i] *= 1 - 0.6 * dt;
      s.positions[i * 3] = Math.cos(s.ang[i]) * s.r[i];
      s.positions[i * 3 + 1] = s.y[i];
      s.positions[i * 3 + 2] = Math.sin(s.ang[i]) * s.r[i];
    }

    if (any || active) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aLife.needsUpdate = true;
    }
    if (points.current) points.current.visible = any;
  });

  return <points ref={points} geometry={geo} material={mat} frustumCulled={false} />;
}
