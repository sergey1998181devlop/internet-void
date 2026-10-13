// Interstellar secret — "5D Tesseract & Gravitational Lensing".
// Cornfield Chase (Hans Zimmer) plays while the void runs a three-phase show
// synced to the track:
//   0:00-0:20  gravitational collapse: the hole goes supermassive, the golden
//              accretion disk flares, starlight bends into arcs
//   0:20-0:50  the 5D tesseract opens: an infinite grid of glowing time
//              threads, the cursor drags a frozen trail of parallel lines
//   0:50-end   time dilation: every scripted timeline slows 10x, chromatic
//              aberration, and the finale quote burns in with the donor name
// Triggered by keywords in a PAID sacrifice (any amount) — see RULES in
// effects.js — or directly from the TestPanel QA harness.

import { audio } from '../audio/AudioEngine';
import { effects } from './effects';
import { scheduleFragment } from './fragments';
import { secrets } from './secrets';
import { pause as pauseMusic, isPlaying as musicPlaying, play as resumeMusic } from './music';

const SRC = '/audio/cornfield-chase.mp3';
const FALLBACK_DUR = 127; // ffprobe reports 127.007s
export const ISL_P1 = 20; // phase 2 opens
export const ISL_P2 = 50; // phase 3 opens
export const ISL_QUOTE_AT = 55; // finale quote burns in

let el = null;
let active = false;
let startAt = 0;
let dur = FALLBACK_DUR;
let donor = '';
let wasPlaying = false;
let endTimer = 0;
let raf = 0;
let cooldownUntil = 0;
let prevTs = 1;
let prevSecTs = 1;

function ensureEl() {
  if (el) return el;
  el = new Audio(SRC);
  el.preload = 'auto';
  audio.attachInterstellar(el);
  el.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(el.duration) && el.duration > 1) {
      dur = el.duration;
      if (active) armEnd();
    }
  });
  el.addEventListener('ended', stop);
  return el;
}

function armEnd() {
  clearTimeout(endTimer);
  endTimer = setTimeout(stop, dur * 1000 + 400);
}

// phase 3 engages the relativistic slow-down: every scripted timeline,
// burst and coin stretches 10x (restored on stop)
function tick() {
  if (!active) return;
  if (interstellarPhase() === 3) {
    effects.ts = 0.1;
    secrets.ts = 0.1;
  }
  raf = requestAnimationFrame(tick);
}

export function startInterstellar(ev) {
  const now = Date.now();
  if (active || now < cooldownUntil) return false;
  active = true;
  startAt = performance.now() / 1000;
  dur = FALLBACK_DUR;
  donor = (ev && String(ev.name)) || 'Anonymous';
  prevTs = effects.ts > 0 ? effects.ts : 1;
  prevSecTs = secrets.ts > 0 ? secrets.ts : 1;
  wasPlaying = musicPlaying();
  pauseMusic(false); // programmatic pause: keeps the autoplay intent alive
  audio.setInterstellar(true);
  const node = ensureEl();
  try {
    node.currentTime = 0;
  } catch {
    /* metadata not ready yet */
  }
  const p = node.play();
  if (p && p.catch) p.catch(() => {});
  armEnd();
  // ARG puzzle: the phrase fragment shows over the finale's fade
  scheduleFragment('interstellar', FALLBACK_DUR * 1000 + 400);
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
  if (typeof window !== 'undefined' && window.__islHooks) {
    window.__islHooks.forEach((fn) => fn());
  }
  return true;
}

export function stop() {
  if (!active) return;
  active = false;
  clearTimeout(endTimer);
  cancelAnimationFrame(raf);
  effects.ts = prevTs;
  secrets.ts = prevSecTs;
  if (el) {
    el.pause();
    try {
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
  }
  audio.setInterstellar(false);
  if (wasPlaying) resumeMusic();
  wasPlaying = false;
  cooldownUntil = Date.now() + 15000;
  if (typeof window !== 'undefined' && window.__islHooks) {
    window.__islHooks.forEach((fn) => fn());
  }
}

export const interstellarActive = () => active;
export const interstellarDonor = () => donor;
export const interstellarDur = () => dur;
export const interstellarElapsed = () => (active ? performance.now() / 1000 - startAt : 0);

export function interstellarPhase() {
  if (!active) return 0;
  const e = interstellarElapsed();
  return e < ISL_P1 ? 1 : e < ISL_P2 ? 2 : 3;
}

// QA hook, same pattern as __rickroll / __fx
if (typeof window !== 'undefined') {
  window.__isl = {
    start: (name) => startInterstellar({ name: name || 'Tester' }),
    stop,
    active: interstellarActive,
    phase: interstellarPhase,
    elapsed: interstellarElapsed,
    donor: interstellarDonor,
    src: SRC,
    // test jump: shift the show's start into the past
    seek: (sec) => {
      if (active) startAt = performance.now() / 1000 - Math.max(0, Number(sec) || 0);
    },
    hooks: (window.__islHooks = window.__islHooks || new Set()),
  };
}
