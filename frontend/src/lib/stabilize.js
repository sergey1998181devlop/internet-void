// ARG phase 1 — the emissive dissolve transition.
//
//   burn   3.5s  uDissolve 0->1: the shader eats the old void behind a
//                 glowing orange-violet rim, ash particles ride the front
//   hold   0.4s  full evaporation: black canvas, last sparks spiral in
//   reveal 1.4s  the stabilized ultramarine void fades in (uStable=1)
//
// Then the payment form is replaced by the SINGULARITY STABILIZED panel.
// Persistence: localStorage `void_stabilized` for this browser + the server
// record (`/api/arg/state`) — accounts keep the state across browsers.
// ?slow= stretches the whole timeline the way effects.ts does, so a
// software-GL screenshot run can land mid-burn.

import { setState, getState, getClientId } from './store';
import { effects } from './effects';
import { setMusicPhase } from './music';
import { loadSky } from './sky';

const LS_KEY = 'void_stabilized';
const LS_OBS = 'void_observer';

const BURN_MS = 3500;
const HOLD_MS = 400;
const REVEAL_MS = 1400;

// p: burn front 0..1 · stable: 0 = old palette, 1 = stabilized · reveal 0..1
export const dissolve = {
  p: 0,
  stable: 0,
  reveal: 1,
  running: false,
  phase: 'idle', // idle | burn | hold | reveal
};

let phaseStart = 0; // performance.now() when the current phase began

// Share recording overrides: the clip must show the level the sacrifice was
// actually burned on, even when the visitor has already moved on. The
// override only drives what the canvas paints — the visitor's own state,
// localStorage and the server record stay untouched.
export const recordPhase = { value: 0 }; // 0 = follow the real state · 1 · 2

export function setRecordPhase(p) {
  const v = p === 1 || p === 2 ? p : 0;
  if (recordPhase.value === v) return v;
  recordPhase.value = v;
  if (v === 2) loadSky(); // the panorama needs the whole recording to decode
  if (typeof setState === 'function') setState({ recordPhase: v });
  return v;
}

// what the renderer must paint right now (0 old palette · 1 stabilized)
export function renderStable() {
  if (recordPhase.value) return recordPhase.value === 2 ? 1 : 0;
  return dissolve.stable;
}

export function renderReveal() {
  if (recordPhase.value) return 1;
  return dissolve.reveal;
}

export function renderDissolve() {
  if (recordPhase.value) return 0;
  return dissolve.p;
}

function virtualElapsed() {
  const ts = effects.ts > 0 ? effects.ts : 1;
  return (performance.now() - phaseStart) * ts;
}

// called once per frame from the black hole's useFrame — wall-clock driven
// (like every other timeline here), so a 1 fps software renderer still
// finishes the burn in exactly 3.5 virtual seconds
export function tickDissolve() {
  if (!dissolve.running) return;
  const vt = virtualElapsed();

  if (dissolve.phase === 'burn') {
    dissolve.p = Math.min(1, vt / BURN_MS);
    if (vt >= BURN_MS) {
      dissolve.p = 1;
      dissolve.phase = 'hold';
      phaseStart = performance.now();
    }
  } else if (dissolve.phase === 'hold') {
    if (vt >= HOLD_MS) {
      // swap: the old scene is gone for good, the stabilized one fades in
      dissolve.stable = 1;
      dissolve.p = 0;
      dissolve.reveal = 0;
      dissolve.phase = 'reveal';
      phaseStart = performance.now();
      setState({ stabilized: true });
      // phase 2 also changes the soundtrack: dark industrial drone radio
      setMusicPhase(2);
    }
  } else if (dissolve.phase === 'reveal') {
    dissolve.reveal = Math.min(1, vt / REVEAL_MS);
    if (vt >= REVEAL_MS) {
      dissolve.reveal = 1;
      dissolve.running = false;
      dissolve.phase = 'idle';
    }
  }
}

export function startDissolve() {
  if (dissolve.running || dissolve.stable) return false;
  dissolve.running = true;
  dissolve.phase = 'burn';
  dissolve.p = 0;
  dissolve.reveal = 1;
  phaseStart = performance.now();
  setState({ stabilized: false });
  // the new level's sky (~2 MB) has the whole burn to decode
  loadSky();
  return true;
}

// instant stabilized state (boot path — no animation)
export function applyStable(observer) {
  dissolve.running = false;
  dissolve.phase = 'idle';
  dissolve.p = 0;
  dissolve.stable = 1;
  dissolve.reveal = 1;
  setState({ stabilized: true, observer: Number(observer) || getState().observer });
  setMusicPhase(2); // the account lives in phase 2 from the first frame
  loadSky();
}

// QA: back to the original void (clears both persistence layers)
export function resetStable() {
  dissolve.running = false;
  dissolve.phase = 'idle';
  dissolve.p = 0;
  dissolve.stable = 0;
  dissolve.reveal = 1;
  try {
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_OBS);
  } catch {
    /* private mode */
  }
  setState({ stabilized: false, observer: 0 });
  setMusicPhase(1); // back to the cosmic radio
}

function persist(observer) {
  try {
    localStorage.setItem(LS_KEY, '1');
    if (Number(observer)) localStorage.setItem(LS_OBS, String(observer));
  } catch {
    /* private mode */
  }
}

// sendDestroy answers with { arg_solved: true, observer: N }
export function onArgSolved(data) {
  const n = Number(data && data.observer) || 0;
  persist(n);
  setState({ observer: n });
  if (getState().stabilized || dissolve.running) return;
  startDissolve();
}

// on load: localStorage first (instant), then the server record — an
// account keeps the stabilized void on every new device forever
export async function bootStabilized() {
  try {
    if (localStorage.getItem(LS_KEY) === '1') {
      applyStable(Number(localStorage.getItem(LS_OBS)) || 0);
    }
  } catch {
    /* private mode */
  }
  try {
    const cid = getClientId();
    const res = await fetch('/api/arg/state?clientId=' + encodeURIComponent(cid || ''), {
      credentials: 'same-origin',
    });
    if (!res.ok) return;
    const d = await res.json();
    if (d && d.cleared) {
      persist(d.observer);
      applyStable(d.observer);
    }
  } catch {
    /* offline / dev */
  }
}

if (typeof window !== 'undefined') {
  window.__stab = {
    dissolve,
    start: startDissolve,
    reset: resetStable,
    apply: applyStable,
    solve: onArgSolved,
    boot: bootStabilized,
    setRecordPhase,
    recordPhase,
  };
}
