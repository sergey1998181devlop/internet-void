import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore, setState } from '../lib/store';
import { audio } from '../audio/AudioEngine';
import { effects } from '../lib/effects';

// spiral fall into the disk, then the coin bursts into golden photons
const FALL = 2.3;
const BURST = 2.0;
const PARTICLES = 720;

let coinTex = null;
let sparkTex = null;
const _v = new THREE.Vector3();

// debug: where the coin / sparks sit on screen (CSS px), so tests can look
function projectToScreen(cam, x, y, z) {
  _v.set(x, y, z).project(cam);
  return {
    x: Math.round((_v.x * 0.5 + 0.5) * window.innerWidth),
    y: Math.round((0.5 - _v.y * 0.5) * window.innerHeight),
  };
}

function coinTexture() {
  if (coinTex) return coinTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(104, 92, 8, 128, 128, 136);
  grad.addColorStop(0, '#fff6d0');
  grad.addColorStop(0.45, '#ffcf5e');
  grad.addColorStop(1, '#a7630c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(120,68,8,0.9)';
  g.lineWidth = 9;
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#7a4708';
  g.font = 'bold 156px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('\u20bf', 128, 134);
  coinTex = new THREE.CanvasTexture(c);
  coinTex.colorSpace = THREE.SRGBColorSpace;
  return coinTex;
}

function sparkTexture() {
  if (sparkTex) return sparkTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,235,1)');
  grad.addColorStop(0.35, 'rgba(255,205,90,0.75)');
  grad.addColorStop(1, 'rgba(255,140,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sparkTex = new THREE.CanvasTexture(c);
  return sparkTex;
}

export default function Coin() {
  const { coin } = useStore();
  const group = useRef();
  const faceA = useRef();
  const faceB = useRef();
  const points = useRef();
  const spin = useRef(0);
  const t = useRef(0);
  const started = useRef(0);
  const id = useRef(null);
  const ang0 = useRef(0);
  const burst = useRef(false);
  const vel = useRef(new Float32Array(PARTICLES * 3));

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
    return g;
  }, []);

  const mat = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.34,
        map: sparkTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        opacity: 1,
      }),
    []
  );

  useFrame((state, delta) => {
    if (!coin) return;
    if (id.current !== coin.id) {
      id.current = coin.id;
      started.current = performance.now() / 1000;
      t.current = 0;
      burst.current = false;
      ang0.current = Math.random() * Math.PI * 2;
      spin.current = 0;
      if (points.current) points.current.visible = false;
      if (group.current) group.current.visible = true;
      mat.opacity = 1;
    }

    // phase timing follows the wall clock so a slow frame rate never stalls
    // the fall; dt stays clamped because it integrates the particle physics
    const ts = effects.ts > 0 ? effects.ts : 1;
    const dt = Math.min(0.05, delta) * ts;
    t.current = (performance.now() / 1000 - started.current) * ts;
    window.__coinT = t.current;
    window.__coinBurst = burst.current;

    if (t.current < FALL) {
      // accelerating spiral from above the hole down to the disk
      const k = t.current / FALL;
      const e = Math.pow(k, 1.7);
      const y = 4.6 * (1 - e) + 0.22;
      const r = 2.5 - 1.35 * e;
      const a = ang0.current + e * 4.4;
      if (group.current) {
        group.current.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
        window.__coinScreen = projectToScreen(state.camera, group.current.position.x, y, group.current.position.z);
        const s = 1 - 0.4 * e;
        group.current.scale.setScalar(s);
        spin.current += dt * (4.5 + 8 * e);
        group.current.rotation.y = spin.current;
        group.current.rotation.x = Math.PI / 2 + Math.sin(spin.current * 0.5) * 0.5;
        group.current.rotation.z = Math.cos(spin.current * 0.37) * 0.4;
      }
      return;
    }

    // --- burst ------------------------------------------------------------
    if (!burst.current) {
      burst.current = true;
      audio.playCoinBreak();
      if (group.current) group.current.visible = false;
      if (points.current) points.current.visible = true;

      const src = group.current
        ? group.current.position.clone()
        : new THREE.Vector3(1.5, 0.4, 0);
      const pos = geo.attributes.position.array;
      const col = geo.attributes.color.array;
      const v = vel.current;
      for (let i = 0; i < PARTICLES; i++) {
        const i3 = i * 3;
        pos[i3] = src.x;
        pos[i3 + 1] = src.y;
        pos[i3 + 2] = src.z;
        // gold -> white sparks
        const w = Math.random();
        col[i3] = 1.0;
        col[i3 + 1] = 0.72 + 0.28 * w;
        col[i3 + 2] = 0.18 + 0.55 * w * w;
        // outward + tangential kick, biased along the disk
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        const sp = 1.6 + Math.random() * 3.4;
        v[i3] = Math.sin(ph) * Math.cos(th) * sp;
        v[i3 + 1] = Math.cos(ph) * sp * 0.7 + 0.6;
        v[i3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      return;
    }

    // --- particles are pulled back into the hole --------------------------
    const pos = geo.attributes.position.array;
    const v = vel.current;
    for (let i = 0; i < PARTICLES; i++) {
      const i3 = i * 3;
      let x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2];
      const d = Math.max(0.25, Math.hypot(x, y, z));
      // gravity of the hole + drag
      const g = 5.5 / (d * d);
      v[i3] += (-x / d) * g * dt;
      v[i3 + 1] += (-y / d) * g * dt;
      v[i3 + 2] += (-z / d) * g * dt;
      const drag = 1 - 0.9 * dt;
      v[i3] *= drag;
      v[i3 + 1] *= drag;
      v[i3 + 2] *= drag;
      pos[i3] = x + v[i3] * dt;
      pos[i3 + 1] = y + v[i3 + 1] * dt;
      pos[i3 + 2] = z + v[i3 + 2] * dt;
    }
    geo.attributes.position.needsUpdate = true;

    // debug: screen-space bbox of the spark cloud
    if ((window.__coinFrame = (window.__coinFrame || 0) + 1) % 4 === 0) {
      const cam = state.camera;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let i = 0; i < PARTICLES; i++) {
        const i3 = i * 3;
        const s = projectToScreen(cam, pos[i3], pos[i3 + 1], pos[i3 + 2]);
        if (s.x < x0) x0 = s.x;
        if (s.x > x1) x1 = s.x;
        if (s.y < y0) y0 = s.y;
        if (s.y > y1) y1 = s.y;
      }
      window.__coinParts = { x0, x1, y0, y1 };
    }

    const bk = (t.current - FALL) / BURST;
    mat.opacity = Math.max(0, 1 - Math.max(0, bk - 0.45) / 0.55);
    mat.size = 0.34 * (1 - 0.4 * Math.max(0, bk));

    if (bk >= 1) setState({ coin: null });
  });

  if (!coin) return null;

  return (
    <>
      <group ref={group}>
        <mesh>
          <cylinderGeometry args={[0.62, 0.62, 0.1, 48, 1, true]} />
          <meshBasicMaterial color="#e3a12a" side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
        <mesh ref={faceA} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.051, 0]}>
          <circleGeometry args={[0.62, 48]} />
          <meshBasicMaterial map={coinTexture()} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh ref={faceB} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.051, 0]}>
          <circleGeometry args={[0.62, 48]} />
          <meshBasicMaterial map={coinTexture()} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <points ref={points} geometry={geo} material={mat} frustumCulled={false} visible={false} renderOrder={12} />
    </>
  );
}
