// ARG meta-puzzle fragments: the tail of every secret animation prints one
// word of the hidden phrase while the effect fades out (last 3–4 seconds):
//
//   [FRAGMENT 03/11: STARS]
//
// Full phrase: WHEN ALL STARS DISSOLVE THE VOID REACHES ABSOLUTE STATE OF...
// The answer the backend waits for is ENTROPY.
//
// Strictly local UI — nothing is broadcast. A new fragment replaces the
// previous one; the line holds for four seconds and vanishes.

import { setState, getState } from './store';

export const FRAGMENTS = {
  pi: [1, 'WHEN'],
  demon: [2, 'ALL'],
  jackpot: [3, 'STARS'],
  leet: [4, 'DISSOLVE'],
  chill: [5, 'THE'],
  interstellar: [6, 'VOID'],
  bitcoin: [7, 'REACHES'],
  glitch: [8, 'ABSOLUTE'],
  rickroll: [9, 'STATE'],
  overload: [10, 'OF'],
  white: [11, '...'],
};

const HOLD_MS = 4000; // how long the line stays up once shown
const TAIL_MS = 3500; // show during the last 3–4 s of a longer effect

let showTimer = 0;
let hideTimer = 0;
let seq = 0;

// QA: chronological trace of schedule/show/hide (window.__fragLog)
const log = (kind, delay) => {
  if (typeof window === 'undefined') return;
  (window.__fragLog = window.__fragLog || []).push({
    kind,
    delay,
    at: Math.round(performance.now()),
  });
};

function show(key) {
  const f = FRAGMENTS[key];
  if (!f) return;
  seq += 1;
  log('show:' + key, 0);
  setState({ fragment: { n: f[0], word: f[1], id: seq } });
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    log('hide:' + key, 0);
    if (getState().fragment && getState().fragment.id === seq) {
      setState({ fragment: null });
    }
  }, HOLD_MS);
}

// schedule the line into the fade-out window of an effect of `durationMs`
export function scheduleFragment(key, durationMs) {
  const f = FRAGMENTS[key];
  if (!f) return;
  const delay = Math.max(0, Number(durationMs || 0) - TAIL_MS);
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  log('schedule:' + key, delay);
  showTimer = setTimeout(() => show(key), delay);
}

// short effects (2–3 s) show the fragment right away
export function showFragment(key) {
  const f = FRAGMENTS[key];
  if (!f) return;
  clearTimeout(showTimer);
  show(key);
}

export function fragmentText(fragment) {
  if (!fragment) return '';
  const n = String(fragment.n).padStart(2, '0');
  return `[FRAGMENT ${n}/11: ${fragment.word}]`;
}

// QA
if (typeof window !== 'undefined') {
  window.__frag = { show: show, schedule: scheduleFragment, list: FRAGMENTS };
}
