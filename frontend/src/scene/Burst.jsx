import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { secrets } from '../lib/secrets';

// Debris blown out of the singularity: used by both click secrets — a short
// sharp burst when the void is overloaded, a five-second fountain when gravity
// flips and everything is spat back out in white-hole mode.

const N = 850;

const VERT = /* glsl */ `
attribute vec4 aDir;   // xyz = unit direction, w = speed factor
attribute float aSeed;
uniform float uT;      // seconds since the burst, negative = hidden
uniform float uSpan;   // lifetime of this burst
uniform float uGain;
varying float vA;

void main() {
  if (uT < 0.0 || uT > uSpan) {
    vA = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = uT / uSpan;
  // constant outward flight with a hint of drag, all of it from the centre
  float r = (0.5 + aDir.w * 13.0) * uT * (1.0 - 0.3 * k);
  vec3 p = aDir.xyz * r;
  vA = (1.0 - k) * (1.0 - k);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (2.5 + 5.5 * aSeed) * (46.0 / max(1.0, -mv.z)) * (0.7 + 0.5 * uGain);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying float vA;
void main() {
  if (vA <= 0.0) discard;
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float a = smoothstep(0.25, 0.0, d) * vA;
  vec3 col = mix(vec3(0.45, 0.85, 1.0), vec3(1.0, 0.95, 0.85), vA);
  gl_FragColor = vec4(col, a);
}
`;

export default function Burst() {
  const uniforms = useMemo(
    () => ({
      uT: { value: -1 },
      uSpan: { value: 2 },
      uGain: { value: 1 },
    }),
    []
  );

  const geo = useMemo(() => {
    const dir = new Float32Array(N * 4);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // mostly along the disk plane: the wave is flat, the spray reads wide
      const a = Math.random() * Math.PI * 2;
      const y = (Math.random() * 2 - 1) * 0.3;
      const v = new THREE.Vector3(Math.cos(a), y, Math.sin(a)).normalize();
      dir[i * 4] = v.x;
      dir[i * 4 + 1] = v.y;
      dir[i * 4 + 2] = v.z;
      dir[i * 4 + 3] = 0.35 + Math.random() * 0.65;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 4));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
    return g;
  }, []);

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms]
  );

  useFrame(() => {
    const b = secrets.burst;
    const raw = b.t0 < 0 ? -1 : performance.now() / 1000 - b.t0;
    const age = raw < 0 ? -1 : raw * secrets.ts; // ?slow stretches the flight too
    uniforms.uT.value = b.t0 < 0 || age > b.span ? -1 : age;
    uniforms.uSpan.value = b.span;
    uniforms.uGain.value = b.gain;
    if (typeof window !== 'undefined') {
      window.__burst = { t: +uniforms.uT.value.toFixed(2), span: uniforms.uSpan.value };
    }
  });

  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={11} />;
}
