import * as THREE from 'three';

// idle drift: while nobody is dragging, the view traces a slow figure-eight
// around the hole (a lemniscate: wide side-to-side sweep, the vertical swing
// running at double rate) and the whole pattern creeps around the azimuth so
// every side of the singularity passes in front of the camera over time
const AUTO_DELAY = 1.2; // s of stillness before the drift may start
const AUTO_RAMP = 2.8; // s to fade from still to full drift speed
const SWING_T = 1.05; // rad of horizontal half-sweep (~60° either side)
const SWING_P = 0.32; // rad of vertical half-sweep (~18° up / down)
const SWING_W = 0.048; // rad/s of the figure-eight clock (~130 s per loop)
const PRECESS = 0.018; // rad/s of the slow travel around the hole (~1°/s)

export const orbit = {
  theta: Math.PI * 0.15,
  phi: 0.28,
  // what the visitor set by dragging — the auto motion is layered on top
  thetaUser: Math.PI * 0.15,
  phiUser: 0.28,
  targetTheta: Math.PI * 0.15,
  targetPhi: 0.28,
  // seconds of auto motion actually played: frozen while the visitor drags
  autoPhase: 0,
  // the swing offsets currently layered over the visitor's angle
  swingT: 0,
  swingP: 0,
  dist: 21.5,
  dragging: false,
  lastX: 0,
  lastY: 0,
  // pointer travel since pointerdown — tiny travel means a tap, not a drag
  moved: 0,
  // smoothed camera angular speed (rad/s) — drives the ambient sound
  vel: 0,
  // wall-clock ms of the last camera gesture; the drift is measured against
  // it so it never depends on frame rate
  lastInput: 0,
  // seconds since the visitor last touched the camera (derived, for QA)
  idle: 0,
  // share recording: hold the view dead level and straight on (no drift, no
  // swing) so the clip is framed like a logo
  lock: false,
  // framing tilt: a fraction of the frame height. The aim tips up by that
  // much, so the void sits that far below centre — the shot looks like it was
  // taken from just under the disk instead of dead on its plane
  pan: 0,
  // where the camera actually looks (the void centre, tipped up by `pan`);
  // the horizon shader reads this so both views agree
  aim: new THREE.Vector3(0, 0, 0),
};

if (typeof window !== 'undefined') window.__orbit = orbit;

export function attachOrbitControls(el) {
  const onDown = (e) => {
    orbit.dragging = true;
    orbit.moved = 0;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    orbit.lastInput = performance.now();
    el.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!orbit.dragging) return;
    orbit.lastInput = performance.now();
    const dx = e.clientX - orbit.lastX;
    const dy = e.clientY - orbit.lastY;
    orbit.moved += Math.abs(dx) + Math.abs(dy);
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    orbit.thetaUser -= dx * 0.005;
    orbit.phiUser = Math.max(-0.7, Math.min(0.9, orbit.phiUser + dy * 0.004));
    // the visitor grabs the view exactly as it stands — the frozen swing
    // stays layered, so nothing ever snaps mid-gesture
    orbit.targetTheta = orbit.thetaUser + orbit.swingT;
    orbit.targetPhi = Math.max(-0.9, Math.min(1.1, orbit.phiUser + orbit.swingP));
  };
  const onUp = () => {
    if (orbit.dragging) orbit.lastInput = performance.now();
    orbit.dragging = false;
  };

  el.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
}

let prevWall = 0;

// scratch for the framing tilt below
const tmpDir = new THREE.Vector3();
const tmpRight = new THREE.Vector3();

const smoothstep = (x) => {
  const k = x < 0 ? 0 : x > 1 ? 1 : x;
  return k * k * (3 - 2 * k);
};

export function updateOrbit(camera) {
  const nowMs = performance.now();
  // real time since the previous frame (capped so a backgrounded tab never
  // makes the drift jump on return) — everything below is frame-rate free
  const dt = prevWall ? Math.min(1, (nowMs - prevWall) / 1000) : 0.016;
  prevWall = nowMs;

  const t0 = orbit.theta;
  const p0 = orbit.phi;

  // no input lately -> the figure-eight clock starts running, easing in from
  // a standstill (also the state the page loads in) so nothing ever snaps
  orbit.idle = orbit.dragging ? 0 : Math.max(0, (nowMs - orbit.lastInput) / 1000);

  if (orbit.lock) {
    // recording: the shot is locked — no drift, no swing, just the raw angles
    orbit.swingT = 0;
    orbit.swingP = 0;
    orbit.targetTheta = orbit.thetaUser;
    orbit.targetPhi = orbit.phiUser;
  } else {
    const drift = smoothstep((orbit.idle - AUTO_DELAY) / AUTO_RAMP);
    if (drift > 0) {
      // the loop clock and the slow creep around the azimuth only advance while
      // the visitor is idle — during a drag the whole pattern freezes in place
      orbit.autoPhase += drift * dt;
      orbit.thetaUser += PRECESS * drift * dt;
    }
    // lemniscate: horizontal sweep of sin(t), vertical of sin(2t) — the trace
    // draws an infinity symbol across the sky around the hole
    const ph = orbit.autoPhase * SWING_W;
    orbit.swingT = SWING_T * Math.sin(ph);
    orbit.swingP = SWING_P * Math.sin(2 * ph);
    orbit.targetTheta = orbit.thetaUser + orbit.swingT;
    orbit.targetPhi = Math.max(-0.9, Math.min(1.1, orbit.phiUser + orbit.swingP));
  }

  // follow the target with the same feel the old 0.08-per-frame had at 60fps
  const k = 1 - Math.exp(-dt / 0.2);
  orbit.theta += (orbit.targetTheta - orbit.theta) * k;
  orbit.phi += (orbit.targetPhi - orbit.phi) * k;

  const t = orbit.theta;
  const p = orbit.phi;
  // narrow viewports (phones, portrait tablets): the vertical fov stays the
  // same but the horizontal one collapses, which crops the disk off-screen —
  // pull the camera back so the void keeps about its desktop share of the
  // frame WIDTH. The share recording locks the view and always uses the
  // calibrated desktop distance, so clips are identical on every device.
  const aspect = camera.aspect || 1.6;
  const d = orbit.lock ? orbit.dist : orbit.dist * Math.min(2.6, Math.max(1, 1.6 / aspect));
  camera.position.set(
    d * Math.cos(p) * Math.sin(t),
    d * Math.sin(p),
    d * Math.cos(p) * Math.cos(t)
  );

  // framing tilt: aim over the void's head instead of dead on it, which drops
  // the whole frame by `pan` (a fraction of its height) — the shot reads as if
  // we were hovering just under the disk looking up
  const aim = orbit.aim.set(0, 0, 0);
  if (orbit.pan > 0) {
    const dir = tmpDir.copy(aim).sub(camera.position);
    const len = dir.length();
    dir.divideScalar(len);
    const right = tmpRight.copy(dir).cross(camera.up);
    if (len > 0 && right.lengthSq() > 1e-8) {
      // the horizon shader maps a ray offset uv to tan = uv * tan(fov/2), so
      // this tilt moves the whole frame down by exactly `pan`
      const beta = Math.atan(orbit.pan * Math.tan((camera.fov * Math.PI) / 360));
      dir.applyAxisAngle(right.normalize(), beta);
      aim.copy(camera.position).addScaledVector(dir, len);
    }
  }
  camera.lookAt(aim);
  camera.updateMatrixWorld();

  // angular speed of the camera, smoothed: quick to rise, slow to settle
  const raw = Math.hypot(orbit.theta - t0, orbit.phi - p0) / Math.max(0.001, dt);
  const rising = raw > orbit.vel;
  orbit.vel += (raw - orbit.vel) * (1 - Math.exp(-dt / (rising ? 0.05 : 0.3)));
}
