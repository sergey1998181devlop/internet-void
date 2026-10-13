import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { rickrollActive, rickrollPulse } from '../lib/rickroll';

const N = 130;

// chunky pixel-style music note, drawn white so vertex colours can tint it
function makeNoteTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 52px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('♪', 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const COLORS = [
  [1.0, 0.2, 0.95], // neon magenta
  [1.0, 0.78, 0.2], // gold
  [0.4, 0.9, 1.0], // cyan
  [1.0, 1.0, 1.0], // white
];

function respawn(p, rand = Math.random) {
  p.angle = rand() * Math.PI * 2;
  p.radius = 1.0 + rand() * 1.6;
  p.y = -0.4 + rand() * 1.4;
  p.speed = 2.2 + rand() * 2.6;
  p.rise = 0.7 + rand() * 1.4;
  p.wobble = (rand() - 0.5) * 1.6;
}

export default function RickrollNotes() {
  const ref = useRef();
  const tex = useMemo(() => makeNoteTexture(), []);

  const parts = useMemo(() => {
    const arr = [];
    for (let i = 0; i < N; i++) {
      const p = {
        angle: 0,
        radius: 0,
        y: 0,
        speed: 0,
        rise: 0,
        wobble: 0,
        color: COLORS[i % COLORS.length],
      };
      // start spread through the whole flight path so the first frame is alive
      p.radius = 1.0 + Math.random() * 10.5;
      p.y = Math.random() * 5;
      respawn(p);
      p.radius = 1.0 + Math.random() * 10.5;
      p.y = Math.random() * 5;
      arr.push(p);
    }
    return arr;
  }, []);

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const col = g.getAttribute('color');
    parts.forEach((p, i) => col.setXYZ(i, p.color[0], p.color[1], p.color[2]));
    return g;
  }, [parts]);

  const mat = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: tex,
        size: 0.6,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
      }),
    [tex]
  );

  useFrame((_, delta) => {
    const holder = ref.current;
    if (!holder) return;
    const on = rickrollActive();
    holder.visible = on;
    if (!on) return;

    const pulse = rickrollPulse();
    const dt = Math.min(delta, 0.05);
    const pos = geo.getAttribute('position');

    for (let i = 0; i < N; i++) {
      const p = parts[i];
      p.radius += p.speed * dt * (1 + 1.3 * pulse);
      p.y += p.rise * dt * (1 + 0.8 * pulse);
      p.angle += p.wobble * dt;
      if (p.radius > 13 || p.y > 7) respawn(p);
      pos.setXYZ(i, Math.cos(p.angle) * p.radius, p.y, Math.sin(p.angle) * p.radius);
    }
    pos.needsUpdate = true;
    mat.size = 0.55 + 0.4 * pulse;
  });

  return <points ref={ref} geometry={geo} material={mat} renderOrder={20} frustumCulled={false} visible={false} />;
}
