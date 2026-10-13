import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useStore, setState } from '../lib/store';

// $60 (tier 6): a rocket doing a smooth flyby — enters off-screen, crosses
// the view along a random axis with a gentle arc, exits the far side.
// Model: cartoon rocket GLTF (stivs.dev CodePen rNMwpaG, CC), served locally,
// normalized so the nose (+Y in the file) points forward (+Z).

useGLTF.preload('/rocket/rocket.gltf');

const FLIGHT = 9.5; // seconds
const PLANE = 16; // distance ahead of the camera we keep the show on
const TRAIL = 110;
const EMIT_MS = 0.03;
const MODEL_H = 3.6; // nose-to-tail length in world units
const ENTRY_PAD = 1.3; // how far beyond the view edge the flight starts/ends
const BOW = 0.16; // max lateral arc as a fraction of the view extent
const SPEED_RAMP = 0.35; // speed grows linearly from (1-k) to (1+k) of average
const ROLL_SPEED = 0.9; // rad/s — slow spin around the nose axis during flight

const rnd = (a, b) => a + Math.random() * (b - a);

function screenMetrics(camera, aspect) {
  const pos = camera.position.clone();
  const m = camera.matrixWorld.elements;
  const fwd = new THREE.Vector3(-m[8], -m[9], -m[10]);
  const right = new THREE.Vector3(m[0], m[1], m[2]);
  const up = new THREE.Vector3(m[4], m[5], m[6]);
  const center = pos.clone().addScaledVector(fwd, PLANE);
  const halfH = Math.tan((camera.fov * Math.PI) / 360) * PLANE;
  const halfW = halfH * aspect;
  return { center, right, up, halfW, halfH };
}

function buildRocket(gltfScene) {
  const group = new THREE.Group();

  // cartoon model: normalize scale/center, nose (+Y) -> forward (+Z)
  const model = gltfScene.clone(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const s = MODEL_H / Math.max(size.y, 0.001);
  model.scale.setScalar(s);
  model.position.set(-center.x * s, -center.y * s, -center.z * s);
  const holder = new THREE.Group();
  holder.rotation.x = Math.PI / 2;
  holder.add(model);
  group.add(holder);

  const flameOuter = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 1.3, 14, 1, true),
    new THREE.MeshBasicMaterial({
      color: '#ff8a2b',
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  );
  flameOuter.geometry.rotateX(-Math.PI / 2); // apex toward -Z
  flameOuter.position.z = -2.3;

  const flameInner = new THREE.Mesh(
    new THREE.ConeGeometry(0.17, 0.9, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: '#fff3c4',
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  );
  flameInner.geometry.rotateX(-Math.PI / 2);
  flameInner.position.z = -2.1;

  const flameGroup = new THREE.Group();
  flameGroup.add(flameOuter, flameInner);
  group.add(flameGroup);

  const light = new THREE.PointLight('#ff9a4d', 55, 30, 2);
  light.position.z = -2.0;
  group.add(light);

  // key + fill so the flat cartoon materials read from every angle
  const key = new THREE.PointLight('#ffffff', 40, 60, 2);
  key.position.set(2, 2.5, 5);
  const fill = new THREE.PointLight('#9fc0ff', 16, 60, 2);
  fill.position.set(-4, -2, 2);
  group.add(key, fill);

  return { group, flameGroup, flameOuter, flameInner, light, own: [flameOuter, flameInner] };
}

export default function Rocket() {
  const store = useStore();
  const { camera, size } = useThree();
  const { scene } = useGLTF('/rocket/rocket.gltf');

  const rig = useMemo(() => {
    const built = buildRocket(scene);
    built.group.visible = false;
    return built;
  }, [scene]);

  const trail = useMemo(() => {
    const positions = new Float32Array(TRAIL * 3);
    const colors = new Float32Array(TRAIL * 3);
    const vel = new Float32Array(TRAIL * 3);
    const age = new Float32Array(TRAIL).fill(99);
    const life = new Float32Array(TRAIL).fill(1);
    for (let i = 0; i < TRAIL; i++) positions[i * 3 + 1] = 9999;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.55,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.visible = false;
    return { geometry, material, points, positions, colors, vel, age, life, head: 0 };
  }, []);

  useEffect(
    () => () => {
      // only dispose what we own — the gltf assets stay cached
      rig.own.forEach((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      trail.geometry.dispose();
      trail.material.dispose();
    },
    [rig, trail]
  );

  // flight state — parametric flyby: p(s) = entry + dir*(s*span) + perp*bow*sin(pi*s)
  const st = useRef({
    active: false,
    queued: false,
    t: 0,
    t0: 0,
    watchdog: 0,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    entry: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    perp: new THREE.Vector3(),
    span: 1,
    extent: 1,
    bow: 0,
    roll: 0,
    rollDir: 1,
    emitAcc: 0,
  });
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const lastId = useRef('');

  const stop = () => {
    const s = st.current;
    s.active = false;
    s.queued = false;
    clearTimeout(s.watchdog);
    rig.group.visible = false;
    trail.points.visible = false;
    setState({ rocket: null });
  };

  // metrics are taken on a real frame, with an up-to-date camera matrix and a
  // laid-out canvas, so the flight can never be built around a stale view
  const beginFlight = () => {
    const s = st.current;
    const w = size.width;
    const h = size.height;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) return; // retry next frame

    const aspect = w / Math.max(1, h);
    // the fx can land on the very first frames, before anything has rendered:
    // the camera matrix may still be stale, which would build the path around
    // the wrong view centre and park the rocket in the middle of the screen
    camera.updateMatrixWorld();
    const sm = screenMetrics(camera, aspect);
    if (!Number.isFinite(sm.halfW) || !Number.isFinite(sm.halfH) || sm.halfW < 1e-3 || sm.halfH < 1e-3)
      return; // retry next frame with a real view rect
    s.active = true;
    s.queued = false;
    s.emitAcc = 0;
    s.roll = 0;
    s.rollDir = Math.random() < 0.5 ? -1 : 1;
    // wall clock: a stalled frame must cost flight time, not freeze the show
    s.t0 = performance.now();
    s.t = 0;

    // random flight axis across the screen plane
    const ang = rnd(0, Math.PI * 2);
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    s.dir.copy(sm.right).multiplyScalar(c).addScaledVector(sm.up, sn).normalize();
    s.perp.copy(sm.right).multiplyScalar(-sn).addScaledVector(sm.up, c);
    // half-size of the view rect measured along the flight axis
    s.extent =
      Math.abs(sm.right.dot(s.dir)) * sm.halfW + Math.abs(sm.up.dot(s.dir)) * sm.halfH;
    // degenerate view rect -> the whole path would collapse into the centre
    const floor = Math.max(sm.halfW, sm.halfH, 1);
    if (!Number.isFinite(s.extent) || s.extent < floor * 0.2) s.extent = floor;
    s.span = s.extent * (2 * ENTRY_PAD + 0.4);
    s.bow = rnd(-BOW, BOW) * s.extent;
    s.entry.copy(sm.center).addScaledVector(s.dir, -s.extent * ENTRY_PAD);
    s.pos.copy(s.entry);

    // initial speed along the (slightly curved) path
    const tangent = s.dir
      .clone()
      .multiplyScalar(s.span)
      .addScaledVector(s.perp, s.bow * Math.PI)
      .normalize();
    const speed0 = (s.span / FLIGHT) * (1 - SPEED_RAMP);
    s.vel.copy(tangent).multiplyScalar(speed0);

    // aim along initial tangent
    dummy.position.copy(s.pos);
    dummy.lookAt(s.pos.clone().add(tangent));
    s.quat.copy(dummy.quaternion);

    // fresh trail
    trail.age.fill(99);
    for (let i = 0; i < TRAIL; i++) {
      trail.positions[i * 3] = 0;
      trail.positions[i * 3 + 1] = 9999;
      trail.positions[i * 3 + 2] = 0;
      trail.colors[i * 3] = 0;
      trail.colors[i * 3 + 1] = 0;
      trail.colors[i * 3 + 2] = 0;
    }
    trail.geometry.attributes.position.needsUpdate = true;
    trail.geometry.attributes.color.needsUpdate = true;

    // place it before it becomes visible: never at the world origin
    rig.group.position.copy(s.pos);
    rig.group.quaternion.copy(s.quat);
    rig.group.visible = true;
    trail.points.visible = true;

    // hard stop even if the render loop never comes back
    clearTimeout(s.watchdog);
    s.watchdog = setTimeout(stop, (FLIGHT + 3) * 1000);
  };

  useEffect(() => {
    const id = store.rocket && store.rocket.id;
    if (id && id !== lastId.current) {
      lastId.current = id;
      // a fx that arrives long after it was fired (hidden tab, stalled frame)
      // must not launch a rocket out of nowhere
      const age = Date.now() - (Number(store.rocket.ts) || Date.now());
      st.current.queued = age < 30000;
    } else if (!id) {
      st.current.queued = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.rocket && store.rocket.id]);

  useEffect(
    () => () => {
      clearTimeout(st.current.watchdog);
    },
    []
  );

  useEffect(() => {
    // debug: screen-space projection of the rocket for trajectory checks
    window.__rocketPos = () => {
      const s = st.current;
      const v = s.pos.clone().project(camera);
      return {
        x: +v.x.toFixed(3),
        y: +v.y.toFixed(3),
        t: +s.t.toFixed(2),
        roll: +s.roll.toFixed(2),
        active: s.active,
        queued: s.queued,
        visible: rig.group.visible,
        origin: +rig.group.position.length().toFixed(2),
      };
    };
    return () => {
      delete window.__rocketPos;
    };
  }, [camera, rig]);

  const emit = (s, fwd) => {
    const i = trail.head;
    trail.head = (trail.head + 1) % TRAIL;
    const px = s.pos.x - fwd.x * 1.5 + rnd(-0.14, 0.14);
    const py = s.pos.y - fwd.y * 1.5 + rnd(-0.14, 0.14);
    const pz = s.pos.z - fwd.z * 1.5 + rnd(-0.14, 0.14);
    trail.positions[i * 3] = px;
    trail.positions[i * 3 + 1] = py;
    trail.positions[i * 3 + 2] = pz;
    trail.vel[i * 3] = -s.vel.x * 0.22 + rnd(-1.6, 1.6);
    trail.vel[i * 3 + 1] = -s.vel.y * 0.22 + rnd(-1.6, 1.6);
    trail.vel[i * 3 + 2] = -s.vel.z * 0.22 + rnd(-1.6, 1.6);
    trail.age[i] = 0;
    trail.life[i] = rnd(0.9, 1.6);
  };

  useFrame((state, delta) => {
    const s = st.current;
    if (s.queued) beginFlight();
    if (!s.active) {
      // hard guard: between flights the rocket is never on screen
      if (rig.group.visible) {
        rig.group.visible = false;
        trail.points.visible = false;
      }
      return;
    }
    const dt = Math.min(0.05, delta);
    // wall clock: the show lasts FLIGHT seconds of real time, whatever the FPS
    s.t = (performance.now() - s.t0) / 1000;

    // parametric progress along the flyby, slightly accelerating
    const prog = Math.min(1, s.t / FLIGHT);
    const vavg = s.span / FLIGHT;
    const speed = vavg * (1 + SPEED_RAMP * (2 * prog - 1));

    // smooth arc: straight axis + gentle sine bow (zero at both ends)
    s.pos
      .copy(s.entry)
      .addScaledVector(s.dir, prog * s.span)
      .addScaledVector(s.perp, s.bow * Math.sin(Math.PI * prog));
    const tangent = s.dir
      .clone()
      .multiplyScalar(s.span)
      .addScaledVector(s.perp, s.bow * Math.PI * Math.cos(Math.PI * prog))
      .normalize();
    s.vel.copy(tangent).multiplyScalar(speed);

    // orientation: nose along the path, roll into the arc + slow spin
    const bank =
      THREE.MathUtils.clamp((s.bow / s.extent) * 3.2, -0.9, 0.9) *
      Math.sin(Math.PI * prog);
    s.roll = s.rollDir * ROLL_SPEED * s.t;
    dummy.position.copy(s.pos);
    dummy.lookAt(s.pos.clone().add(tangent));
    dummy.rotateZ(bank + s.roll);
    // a long stall jumps the path forward: snap the nose instead of easing
    s.quat.slerp(dummy.quaternion, delta > 0.5 ? 1 : 1 - Math.exp(-dt * 6));
    rig.group.position.copy(s.pos);
    rig.group.quaternion.copy(s.quat);
    const fwd = tangent;

    // flame flicker, a bit longer while speeding up
    const flick = 0.8 + Math.random() * 0.5;
    const stretch = (0.75 + 0.45 * prog) * flick;
    rig.flameGroup.scale.set(flick, flick, stretch);
    rig.light.intensity = 40 + 30 * flick;

    // trail emission + ageing
    s.emitAcc += dt;
    while (s.emitAcc >= EMIT_MS) {
      s.emitAcc -= EMIT_MS;
      emit(s, fwd);
    }
    for (let i = 0; i < TRAIL; i++) {
      if (trail.age[i] >= trail.life[i]) continue;
      trail.age[i] += dt;
      const k = trail.age[i] / trail.life[i];
      trail.positions[i * 3] += trail.vel[i * 3] * dt;
      trail.positions[i * 3 + 1] += trail.vel[i * 3 + 1] * dt + 0.7 * dt;
      trail.positions[i * 3 + 2] += trail.vel[i * 3 + 2] * dt;
      trail.vel[i * 3] *= 1 - dt * 1.4;
      trail.vel[i * 3 + 1] *= 1 - dt * 1.4;
      trail.vel[i * 3 + 2] *= 1 - dt * 1.4;
      const heat = Math.max(0, 1 - k);
      const glow = heat * heat;
      trail.colors[i * 3] = glow;
      trail.colors[i * 3 + 1] = 0.42 * glow + 0.45 * heat * heat * heat;
      trail.colors[i * 3 + 2] = 0.12 * glow * heat;
      if (k >= 1) trail.colors[i * 3] = trail.colors[i * 3 + 1] = trail.colors[i * 3 + 2] = 0;
    }
    trail.geometry.attributes.position.needsUpdate = true;
    trail.geometry.attributes.color.needsUpdate = true;

    if (s.t >= FLIGHT) stop();
  });

  return (
    <>
      <primitive object={rig.group} />
      <primitive object={trail.points} />
    </>
  );
}
