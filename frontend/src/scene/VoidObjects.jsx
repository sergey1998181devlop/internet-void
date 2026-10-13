import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { makeTextTexture, loadImageTexture } from './textures';
import { hole } from './hole';
import { orbit } from './orbit';
import { shatterParsV, shatterParsF, shatterVertex, shatterFrag, PHASES } from '../shaders/shatter';

const MAX_ACTIVE = 10;

const qs = (key, dflt) => {
  const raw = new URLSearchParams(window.location.search).get(key);
  if (raw === null) return dflt; // Number(null) === 0 — absent param must keep the default
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
};

// hero-hold: keep the content big in front of the camera long enough to read
const HOLD_QS = qs('hold', -1); // ?hold=2 forces an exact duration (dev)
const HOLD_MIN = 5; // seconds — nothing shows for less than this
const HOLD_MAX = 12;
const HOLD_PER_CHAR = 0.08; // seconds per character of the label
// suck: glide to the centre -> the card blooms into a turning sphere cloud
// (the "world turns" showcase) -> shatters into fine dust -> the dust packs
// into three living droplets -> each droplet swings along the horizon edge
// and is swallowed over the rim, never through the centre
const SUCK = qs('suck', 10.5);
// last beat of the hold: the card stops breathing and previews the pull
const ANTIC = 0.45;
// share of the suck spent gliding to the centre before the showcase begins
const FLY = 0.1;
// droplet anchors around the rim (deg, radial factor, z lift): chosen to sit
// over the glow/shadow ring, clear of the HUD panels that cover the corners
const DROP_ANCHORS = [
  [180, 1.3, 0.3],
  [297, 1.16, -0.3],
  [25, 1.25, 0.1],
];

// readable duration for a hero card: text length decides, minimum 5s.
// window.__voidHold (set by the GIF share flow) compresses the hold so a
// replayed destroy reaches the suction without a 5s wait.
function holdSeconds(ev) {
  if (typeof window !== 'undefined' && window.__voidHold != null) {
    const h = Number(window.__voidHold);
    if (Number.isFinite(h) && h >= 0) return h;
  }
  if (HOLD_QS >= 0) return HOLD_QS;
  if (ev?.imageUrl) return HOLD_MIN;
  const len = String(ev?.text || ev?.name || '').length;
  return Math.min(HOLD_MAX, Math.max(HOLD_MIN, len * HOLD_PER_CHAR));
}

function useEventTexture(event) {
  return useMemo(() => {
    if (event?.imageUrl) return loadImageTexture(event.imageUrl);
    const label = event?.text || event?.name || '...';
    return makeTextTexture(label);
  }, [event?.imageUrl, event?.text, event?.name]);
}

const rnd = (a, b) => a + Math.random() * (b - a);

function randomAxis() {
  const z = rnd(-1, 1);
  const a = rnd(0, Math.PI * 2);
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(a), r * Math.sin(a), z];
}

// Every shard of the card lives in one buffer: `position` is the corner of the
// cell, `aCenter` its place on the card, `aSphere` its spot on the fib-sphere
// cloud the card blooms into, `aTo` where it flies when the cloud bursts, and
// `aDrop` its offset inside one of the three living droplets. Sizes are baked
// in world units at the depth the card is drawn, so the group can stay
// untransformed (the turns rotation is applied on top in useFrame).
function buildShards({ W, H, worldW, worldH, cols, rows }) {
  const n = cols * rows;
  const cellW = W / cols;
  const cellH = H / rows;

  const rimWorld = Math.max(0.4, hole.rim * worldH);
  // sphere cloud: comfortably bigger than the card, still inside the frame
  const RS = Math.min(W, H) * 0.55 + rimWorld * 0.25;
  // burst: the cloud explodes outward into a dust volume
  const spread = 0.5 * Math.max(W, H) + rimWorld * 1.2;
  // droplet: one dense blob per third of the card, thousands of grains inside
  const Rb = Math.max(0.8, rimWorld * 0.5);

  const pos = new Float32Array(n * 4 * 3);
  const uv = new Float32Array(n * 4 * 2);
  const ctr = new Float32Array(n * 4 * 3);
  const sph = new Float32Array(n * 4 * 3);
  const to = new Float32Array(n * 4 * 3);
  const anim = new Float32Array(n * 4 * 4);
  // xyz = tumble axis, w = how hard this shard keeps rolling
  const axis = new Float32Array(n * 4 * 4);
  // xyz = offset inside its droplet, w = droplet id
  const drop = new Float32Array(n * 4 * 4);
  const idx = new Uint16Array(n * 6);

  // cell corners: bottom-left, bottom-right, top-right, top-left
  const cx = [-0.5, 0.5, 0.5, -0.5];
  const cy = [-0.5, -0.5, 0.5, 0.5];

  // golden-angle spiral: the classic fib-sphere of the reference demo
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));

  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++, k++) {
      const u0 = c / cols;
      const v0 = 1 - (r + 1) / rows;
      const nx = (c + 0.5) / cols - 0.5;
      const ny = (r + 0.5) / rows - 0.5;

      // sphere cloud spot (all four corners share it, the cell rides on top)
      const fy = 1 - (k / Math.max(1, n - 1)) * 2;
      const fr = Math.sqrt(Math.max(0, 1 - fy * fy));
      const fth = GOLDEN * k;
      const sR = RS * (0.86 + Math.random() * 0.3);
      const sx = Math.cos(fth) * fr * sR;
      const sy = fy * sR;
      const sz = Math.sin(fth) * fr * sR;

      // burst: the sphere pushed outward plus a random scatter
      const [bx, by, bz] = randomAxis();
      const scatter = (0.2 + Math.random() * 0.8) * spread;
      const tox = sx * 1.7 + bx * scatter;
      const toy = sy * 1.7 + by * scatter;
      const toz = sz * 1.7 + bz * scatter;

      // each third of the card feeds its own droplet
      const did = nx < -0.16 ? 0 : nx > 0.16 ? 1 : 2;
      // dense core with a few stragglers trailing at the fringe
      const u = Math.random();
      const rr = Rb * Math.pow(u, 0.53) * (Math.random() < 0.05 ? 1.35 : 1);
      const [dx, dy, dz] = randomAxis();

      // outer shards leave first; everything is pulled in a beat apart
      const d1 = Math.min(1, Math.abs(nx) * 1.3 + Math.random() * 0.45);
      const d2 = Math.random();
      const angle = rnd(0.5, 2.4) * Math.PI * (Math.random() < 0.5 ? -1 : 1);
      const sj = rnd(0.74, 1.22);
      const spin = rnd(1.6, 5.5) * (Math.random() < 0.5 ? -1 : 1);
      const [axx, axy, axz] = randomAxis();

      for (let v = 0; v < 4; v++) {
        const o = k * 4 + v;
        pos[o * 3] = cx[v] * cellW;
        pos[o * 3 + 1] = cy[v] * cellH;
        pos[o * 3 + 2] = 0;
        uv[o * 2] = u0 + (cx[v] + 0.5) / cols;
        uv[o * 2 + 1] = v0 + (cy[v] + 0.5) / rows;
        ctr[o * 3] = nx * W;
        ctr[o * 3 + 1] = ny * H;
        ctr[o * 3 + 2] = 0;
        sph[o * 3] = sx;
        sph[o * 3 + 1] = sy;
        sph[o * 3 + 2] = sz;
        to[o * 3] = tox;
        to[o * 3 + 1] = toy;
        to[o * 3 + 2] = toz;
        anim[o * 4] = d1;
        anim[o * 4 + 1] = d2;
        anim[o * 4 + 2] = angle;
        anim[o * 4 + 3] = sj;
        axis[o * 4] = axx;
        axis[o * 4 + 1] = axy;
        axis[o * 4 + 2] = axz;
        axis[o * 4 + 3] = spin;
        drop[o * 4] = dx * rr * 1.05;
        drop[o * 4 + 1] = dy * rr * 0.9;
        drop[o * 4 + 2] = dz * rr;
        drop[o * 4 + 3] = did;
      }
      const b = k * 4;
      idx[k * 6] = b;
      idx[k * 6 + 1] = b + 1;
      idx[k * 6 + 2] = b + 2;
      idx[k * 6 + 3] = b;
      idx[k * 6 + 4] = b + 2;
      idx[k * 6 + 5] = b + 3;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aCenter', new THREE.BufferAttribute(ctr, 3));
  g.setAttribute('aSphere', new THREE.BufferAttribute(sph, 3));
  g.setAttribute('aTo', new THREE.BufferAttribute(to, 3));
  g.setAttribute('aAnim', new THREE.BufferAttribute(anim, 4));
  g.setAttribute('aAxis', new THREE.BufferAttribute(axis, 4));
  g.setAttribute('aDrop', new THREE.BufferAttribute(drop, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(),
    (spread + RS + Rb + Math.hypot(W, H)) * 1.4
  );
  return { geo: g, R: rimWorld };
}

function FallingObject({ event, onDone }) {
  const { camera, size } = useThree();
  const heroRef = useRef();
  const heroMatRef = useRef();
  const plateRef = useRef();
  const fragRef = useRef();
  const shardRef = useRef();
  const tex = useEventTexture(event);
  const isImage = !!event?.imageUrl;

  const heroGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  // uP drives the whole cinematic timeline; uRim/uBase follow the live horizon
  const shardU = useMemo(
    () => ({
      uP: { value: 0 },
      uRim: { value: 2.1 },
      uBase: {
        value: DROP_ANCHORS.map(() => new THREE.Vector3()),
      },
    }),
    []
  );

  // the shards ride on the very same colour pipeline as the card
  const shardMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uP = shardU.uP;
      shader.uniforms.uRim = shardU.uRim;
      shader.uniforms.uBase = shardU.uBase;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${shatterParsV}`)
        .replace('#include <begin_vertex>', shatterVertex);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${shatterParsF}`)
        .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>\n${shatterFrag}`);
    };
    return m;
  }, [tex, shardU]);

  const t0 = useRef(-1);
  const done = useRef(false);
  const phase = useRef('hold'); // hold -> suck -> done
  const holdDur = useRef(holdSeconds(event));
  const delay = useRef(Number(event?._delay) || 0);
  const startPose = useRef(new THREE.Vector3());
  const shardGeo = useRef(null);
  const pileR = useRef(0);
  const seed = useRef(Math.random() * Math.PI * 2);

  const scratch = useMemo(
    () => ({
      fwd: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      camPos: new THREE.Vector3(),
      center: new THREE.Vector3(),
      pose: new THREE.Vector3(),
    }),
    []
  );

  useEffect(
    () => () => {
      heroGeo.dispose();
      shardMat.dispose();
      if (shardGeo.current) shardGeo.current.dispose();
    },
    [heroGeo, shardMat]
  );

  const hide = () => {
    if (heroRef.current) heroRef.current.visible = false;
    if (fragRef.current) fragRef.current.visible = false;
  };

  const finish = () => {
    if (done.current) return;
    done.current = true;
    phase.current = 'done';
    hide();
    onDone?.(event);
  };

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (t0.current < 0) {
      t0.current = now + delay.current;
      holdDur.current = holdSeconds(event);
    }

    // a cancelled share recording takes its own card off the stage at once,
    // so the next recording never has to sit through this one
    if (typeof window !== 'undefined' && window.__voidAbort && window.__voidAbort.size) {
      if (window.__voidAbort.has(event.id)) {
        window.__voidAbort.delete(event.id);
        finish();
        return;
      }
    }
    const t = now - t0.current;
    if (t < 0) {
      hide();
      return;
    }

    // ---- world metrics for the hero card -------------------------------
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    const D = 8;
    const worldH = 2 * D * tanHalf;
    const worldW = worldH * (size.width / Math.max(1, size.height));

    // the texture is already cropped tight around its content, so the card
    // always has exactly the proportions of what is written on it
    let texAspect = 4 / 3;
    const img = tex.image;
    if (img && img.width && img.height) texAspect = img.width / img.height;

    const targetW = isImage
      ? Math.min(0.55 * worldW, 0.5 * worldH * texAspect)
      : 0.62 * worldW;
    let W = targetW;
    let H = W / texAspect;
    const maxH = 0.46 * worldH;
    if (H > maxH) {
      H = maxH;
      W = H * texAspect;
    }
    const maxW = 0.88 * worldW;
    if (W > maxW) {
      W = maxW;
      H = W / texAspect;
    }

    const camPos = camera.getWorldPosition(scratch.camPos);
    const m = camera.matrixWorld.elements;
    scratch.right.set(m[0], m[1], m[2]);
    scratch.up.set(m[4], m[5], m[6]);
    scratch.fwd.set(-m[8], -m[9], -m[10]);
    // a framed shot aims over the void's head, so the camera axis no longer
    // points at the hole — fall back to the hole's own direction so the card
    // still lands on it
    if (orbit.pan > 0) scratch.fwd.copy(camPos).negate().normalize();

    const ox = (seed.current % 1.3) - 0.65;
    const oy = 0.3 + Math.sin(seed.current * 3.1) * 0.5;

    // last beat of the hold: the card stops breathing and leans in
    const antic = THREE.MathUtils.smoothstep(t, holdDur.current - ANTIC, holdDur.current);
    const wob = 1 - antic;

    // QA: window.__voidScrub pins the suck at a fixed progress so screenshots
    // land on an exact frame (?test=1)
    let scrub = null;
    if (typeof window !== 'undefined' && window.__voidScrub != null) {
      const s = Number(window.__voidScrub);
      if (Number.isFinite(s)) scrub = Math.min(1, Math.max(0, s));
    }

    const k =
      phase.current === 'suck' && SUCK > 0
        ? scrub !== null
          ? scrub
          : Math.min(1, (t - holdDur.current) / SUCK)
        : phase.current === 'done'
          ? 1
          : 0;
    const fly = phase.current === 'suck' ? THREE.MathUtils.smoothstep(k, 0, FLY) : 0;
    const grow = 1 + 0.15 * antic + 0.22 * fly;
    const p = phase.current === 'suck' ? Math.max(0, (k - FLY) / (1 - FLY)) : 0;

    // QA hook: what the suction is doing this frame (see window.__funnel).
    // A card that already finished never claims the hook, so the next card
    // (and the GIF recorder waiting on this one) sees the live phase.
    if (typeof window !== 'undefined' && phase.current !== 'done') {
      const stage =
        p <= 0
          ? 'glide'
          : p < PHASES.turn
            ? 'turns'
            : p < PHASES.shatter
              ? 'shatter'
              : p < PHASES.swallow
                ? 'droplets'
                : 'swallow';
      window.__funnel = {
        id: event.id,
        phase: phase.current,
        stage,
        t: +t.toFixed(2),
        k: +k.toFixed(3),
        p: +p.toFixed(3),
        grow: +grow.toFixed(3),
        antic: +antic.toFixed(3),
        R: pileR.current ? +pileR.current.toFixed(2) : 0,
        shards: shardGeo.current ? shardGeo.current.index.count / 6 : 0,
        card: [+W.toFixed(2), +H.toFixed(2)],
        tex: tex.image ? [tex.image.width, tex.image.height] : null,
        aspect: +texAspect.toFixed(3),
        frag: !!(fragRef.current && fragRef.current.visible),
        visible: !!(heroRef.current && heroRef.current.visible),
      };
    }

    // where the card lands: dead centre of the view, over the hole
    const center = scratch.center.copy(camPos).addScaledVector(scratch.fwd, D);

    const heroPose = scratch.pose
      .copy(camPos)
      .addScaledVector(
        scratch.fwd,
        D + Math.sin(t * 1.1 + seed.current) * 0.25 * wob + 0.9 * antic
      )
      .addScaledVector(scratch.right, ox)
      .addScaledVector(
        scratch.up,
        oy * worldH * 0.1 * wob + Math.sin(t * 1.5 + seed.current) * 0.22 * wob
      );

    if (phase.current === 'hold') {
      if (heroRef.current) {
        heroRef.current.visible = true;
        heroRef.current.position.copy(heroPose);
        heroRef.current.quaternion.copy(camera.quaternion);
        heroRef.current.rotateX(-0.12 * antic);
        heroRef.current.rotateZ(Math.sin(t * 0.8 + seed.current) * 0.09 * wob);
        heroRef.current.scale.set(W * grow, H * grow, 1);
      }
      if (heroMatRef.current) heroMatRef.current.opacity = 1;
      if (plateRef.current) plateRef.current.opacity = 0.72;
      if (fragRef.current) fragRef.current.visible = false;
      shardU.uP.value = 0;

      if (scrub !== null) {
        startPose.current.copy(heroPose);
        phase.current = 'suck';
      } else if (t >= holdDur.current) {
        if (SUCK <= 0) {
          finish();
          return;
        }
        startPose.current.copy(heroPose);
        phase.current = 'suck';
      }
      return;
    }

    if (phase.current === 'suck') {
      if (k >= 1 && scrub === null) {
        finish();
        return;
      }

      if (fly < 1) {
        // grow and glide to the centre of the screen
        const glide = heroPose.lerpVectors(startPose.current, center, fly);
        if (heroRef.current) {
          heroRef.current.visible = true;
          heroRef.current.position.copy(glide);
          heroRef.current.quaternion.copy(camera.quaternion);
          heroRef.current.rotateX(-0.12 * (1 - fly));
          heroRef.current.scale.set(W * grow, H * grow, 1);
        }
        if (heroMatRef.current) heroMatRef.current.opacity = 1;
        if (plateRef.current)
          plateRef.current.opacity = 0.72 * (1 - THREE.MathUtils.smoothstep(k, FLY * 0.5, FLY));
        if (fragRef.current) fragRef.current.visible = false;
        return;
      }

      // the card is gone: the same pixels, now a cinematic shard cloud
      if (!shardGeo.current) {
        const built = buildShards({
          W: W * grow,
          H: H * grow,
          worldW,
          worldH,
          cols: isImage ? 128 : 120,
          rows: isImage ? 72 : 60,
        });
        shardGeo.current = built.geo;
        pileR.current = built.R;
        if (shardRef.current) {
          shardRef.current.geometry = built.geo;
          shardRef.current.frustumCulled = false;
        }
      }
      if (heroRef.current) heroRef.current.visible = false;
      if (fragRef.current) {
        fragRef.current.visible = true;
        fragRef.current.position.copy(center);
        fragRef.current.quaternion.copy(camera.quaternion);
        // the "world turns" bloom spins the whole mesh a full 2*PI (+ a nod);
        // a full turn lands back on the identity, so later phases stay flat
        if (p < PHASES.turn) {
          const tt = THREE.MathUtils.clamp(p / PHASES.turn, 0, 1);
          const e = tt < 0.5 ? 4 * tt * tt * tt : 1 - Math.pow(-2 * tt + 2, 3) / 2;
          fragRef.current.rotateY(e * Math.PI * 2);
          fragRef.current.rotateX(Math.sin(e * Math.PI) * 0.35);
        }
      }
      // the horizon edge and the droplet anchors ride the live orbit
      const rimW = Math.max(0.4, hole.rim * worldH);
      shardU.uRim.value = rimW;
      for (let i = 0; i < 3; i++) {
        const [deg, kr, z] = DROP_ANCHORS[i];
        const a = (deg * Math.PI) / 180;
        shardU.uBase.value[i].set(Math.cos(a) * rimW * kr, Math.sin(a) * rimW * kr, z);
      }
      shardU.uP.value = p;
      return;
    }

    if (phase.current === 'done') hide();
  });

  return (
    <>
      <group ref={heroRef} visible={false} renderOrder={12}>
        <mesh renderOrder={12} frustumCulled={false} scale={[1.05, 1.22, 1]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={plateRef}
            color="#0d0713"
            transparent
            opacity={0.72}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
        <mesh geometry={heroGeo} renderOrder={13} frustumCulled={false} position={[0, 0, 0.02]}>
          <meshBasicMaterial
            ref={heroMatRef}
            map={tex}
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </group>
      <group ref={fragRef} visible={false} renderOrder={14}>
        <mesh ref={shardRef} renderOrder={14} frustumCulled={false}>
          <primitive object={shardMat} attach="material" />
        </mesh>
      </group>
    </>
  );
}

export default function VoidObjects({ queue, onConsumed }) {
  const [active, setActive] = useState([]);
  // ids already put on screen — the queue is read again on every commit, so a
  // single event must never be scheduled twice
  const taken = useRef(new Set());
  const trace = useRef([]);

  useEffect(() => {
    if (queue.length === 0) return;
    const slots = MAX_ACTIVE - active.length;
    if (slots <= 0) return;

    const head = queue.slice(0, slots);
    // cards line up: the next batch starts when the last live card is done
    let acc = active.length
      ? Math.max(...active.map((a) => a._delay + holdSeconds(a) + SUCK))
      : 0;
    const next = [];
    for (const e of head) {
      if (taken.current.has(e.id)) continue;
      taken.current.add(e.id);
      next.push({ ...e, _k: e.id, _delay: acc });
      acc += holdSeconds(e) + SUCK;
    }
    trace.current.push({
      q: queue.length,
      a: active.length,
      added: next.map((x) => x._k),
      t: Math.round(performance.now()),
    });
    if (trace.current.length > 40) trace.current.shift();
    if (typeof window !== 'undefined') window.__voidTrace = trace.current;

    if (next.length) setActive((a) => [...a, ...next]);
    // drain the head either way: an id we already hold is a duplicate read
    onConsumed(head.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.length, active.length]);

  useEffect(() => {
    window.__voidActive = active.length;
    window.__voidIds = active.map((a) => a._k);
  }, [active]);

  useEffect(
    () => () => {
      taken.current.clear();
    },
    []
  );

  const handleDone = (ev) => {
    setActive((a) => a.filter((x) => x._k !== ev._k));
  };

  return (
    <>
      {active.map((ev) => (
        <FallingObject key={ev._k} event={ev} onDone={handleDone} />
      ))}
    </>
  );
}
