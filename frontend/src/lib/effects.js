// Central, non-reactive state for every scripted visual effect.
// Values are advanced once per frame from the black hole's useFrame and read
// by the shader, the overlays and the audio engine.

import { audio } from '../audio/AudioEngine';
import { setState } from './store';
import { scheduleFragment, showFragment } from './fragments';

export const RIPPLE_SLOTS = 6;

const now = () => performance.now() / 1000;

// Every timeline below is wall-clock based (performance.now), never accumulated
// frame deltas: the big bang must hit every client at the same instant and low
// fps must not stretch a 2s glitch into half a minute.
export const effects = {
  // Gargantua: disk spins 3x for 5 seconds
  spinStart: -1,
  spinMult: 1,

  // 404 / NULL: 2s of corruption, then the hole swallows it
  glitchStart: -1,
  glitch: 0,
  glitchSuck: 0,

  // Big bang timeline (bangState: idle | run; t = now - bangStartAt)
  bangState: 'idle',
  bangStartAt: 0,
  bangSchedAt: 0,
  bangT: 0,
  compress: 0,
  bang: 0,
  bangFired: false,
  bangLabel: '',

  // click lensing
  ripples: Array.from({ length: RIPPLE_SLOTS }, () => ({ x: 0, y: 0, age: 99, amp: 0, amp0: 0, t0: -99 })),
  rippleIdx: 0,

  // debug slow motion (?slow=0.15): stretches every effect timeline without
  // changing phase ratios — used to screenshot transients under software GL
  ts: 1,

  _last: {},
};

const cooldown = (key, sec) => {
  const t = now();
  if (effects._last[key] && t - effects._last[key] < sec) return false;
  effects._last[key] = t;
  return true;
};

// ---------------------------------------------------------------- easter eggs

export function triggerGargantua() {
  if (!cooldown('gargantua', 8)) return false;
  effects.spinStart = now();
  audio.playOrgan();
  audio.duck(0.5, 5.0);
  return true;
}

export function triggerGlitch() {
  if (!cooldown('glitch', 6)) return false;
  effects.glitchStart = now();
  audio.playGlitch();
  audio.duck(0.45, 2.6);
  showFragment('glitch');
  return true;
}

export function triggerBitcoin() {
  if (!cooldown('bitcoin', 10)) return false;
  setState({ coin: { id: Date.now() } });
  audio.playCoin();
  audio.duck(0.5, 3.6);
  scheduleFragment('bitcoin', 3600);
  return true;
}

// ------------------------------------------------------------ ripple (click)

// x/y are CSS pixel coordinates of the click inside the canvas; the shader
// works in BH-uv units: uv = (frag - 0.5 * res) / res.y
export function spawnRipple(x, y, w, h, amp) {
  const r = effects.ripples[effects.rippleIdx % RIPPLE_SLOTS];
  effects.rippleIdx += 1;
  r.x = (x - 0.5 * w) / h;
  r.y = 0.5 - y / h;
  r.t0 = now();
  r.age = 0;
  r.amp0 = amp > 0 ? amp : 0.9 + Math.random() * 0.4;
  r.amp = r.amp0;
  audio.playVacuumClick();
}

// ------------------------------------------------------------- big bang event
//
// 0.0 - 3.0  compress to a blinding point
// 3.0 - 3.75 absolute silence, point holds
// 3.75       explosion
// 3.75 - 5.0 the hole grows back, music returns

export function startBigBang(delaySec = 0, meta = {}) {
  // a negative delay is legitimate: the packet arrived after the moment it
  // describes, and the timeline must start mid-phase, not shift later
  const n = Number(delaySec);
  const delay = Number.isFinite(n) ? Math.max(-60, n) : 0;
  // ARG priority 1: the bang instantly kills any queued or running
  // tier/secret celebration — the screen belongs to the void alone
  setState({ tierFx: [], bangStamp: Date.now() });
  effects.bangStartAt = now() + delay;
  effects.bangSchedAt = Date.now() + delay * 1000; // absolute wall-clock start (ms)
  effects.bangState = 'run';
  effects.bangT = -delay;
  effects.bangFired = false;
  effects.compress = 0;
  effects.bang = 0;
  effects.bangLabel = meta.milestone ? String(meta.milestone) : '';
  audio.planBigBang(delay, effects.ts > 0 ? effects.ts : 1);
  return true;
}

export function bigBangActive() {
  return effects.bangState !== 'idle';
}

// ------------------------------------------------------------------- per frame

export function updateEffects() {
  const t = now();
  const e = effects;
  const ts = e.ts > 0 ? e.ts : 1;

  // --- gargantua spin multiplier (ramp up, hold, ramp down over 5s)
  if (e.spinStart >= 0) {
    const s = (t - e.spinStart) * ts;
    if (s < 0.5) e.spinMult = 1 + 2 * (s / 0.5);
    else if (s < 4.5) e.spinMult = 3;
    else if (s < 5.0) e.spinMult = 3 - 2 * ((s - 4.5) / 0.5);
    else {
      e.spinMult = 1;
      e.spinStart = -1;
    }
  } else {
    e.spinMult = 1;
  }

  // --- glitch: 2s of noise, then 0.5s of being eaten
  if (e.glitchStart >= 0) {
    const s = (t - e.glitchStart) * ts;
    if (s < 2.0) {
      e.glitch = 0.75 + 0.25 * Math.sin(s * 34.0);
      e.glitchSuck = 0;
    } else if (s < 2.5) {
      const k = (s - 2.0) / 0.5;
      e.glitch = 1 - k;
      e.glitchSuck = k;
    } else {
      e.glitch = 0;
      e.glitchSuck = 0;
      e.glitchStart = -1;
    }
  } else {
    e.glitch = 0;
    e.glitchSuck = 0;
  }

  // --- big bang timeline (absolute schedule, negative t = still waiting)
  if (e.bangState !== 'idle') {
    const bt = (t - e.bangStartAt) * ts;
    e.bangT = bt;
    if (bt < 3.0) {
      const k = Math.max(0, bt) / 3.0;
      e.compress = k * k * k; // slow at first, then violent
      e.bang = 0;
    } else if (bt < 3.75) {
      e.compress = 1;
      e.bang = 0;
    } else if (bt < 5.0) {
      if (!e.bangFired) {
        e.bangFired = true;
        audio.playBigBang();
      }
      const k = (bt - 3.75) / 1.25;
      e.bang = 1 - k;
      e.compress = 1 - k;
    } else {
      e.bang = 0;
      e.compress = 0;
      e.bangState = 'idle';
      audio.restoreMusic();
    }
  }

  // --- ripples age out
  for (let i = 0; i < RIPPLE_SLOTS; i++) {
    const r = e.ripples[i];
    if (r.t0 < 0) continue;
    const age = (t - r.t0) * ts;
    r.age = age;
    r.amp = r.amp0 * (age > 1.2 ? Math.exp(-(age - 1.2) * 3.2) : 1);
    if (age > 2.6 || r.amp < 0.01) {
      r.amp = 0;
      r.amp0 = 0;
      r.age = 99;
      r.t0 = -99;
    }
  }

  return e;
}

// -------------------------------------------------------------- keywords

// Interstellar secret keywords (case-insensitive, any payment amount).
// The server re-checks these rules (backend/src/eggs.js) and stamps ev.egg
// on PAID sacrifices only — the socket fires shows from that stamp. This
// client copy stays for QA hooks; fireEasterEgg() does not handle
// 'interstellar' (it needs the donor event).
const RULES = [
  [
    'interstellar',
    /(gargantua|interstellar|гаргантюа|гаргантюа|интерстеллар|\bmurph\b|мерф|\bstay\b|don'?t let me leave|tesseract|тессеракт|singularity|сингулярность|event horizon|горизонт событий|endurance|эндьюранс|\bmiller\b|миллер)/i,
  ],
  ['bitcoin', /(bitcoin|btc|crypto|blockchain|token|\u20bf|\u0431\u0438\u0442\u043a\u043e\u0438\u043d|\u043a\u0440\u0438\u043f\u0442\u043e)/i],
  ['glitch', /(^|[^0-9])(404|null|nil)([^0-9]|$)/i],
];

// returns 'interstellar' | 'bitcoin' | 'glitch' | null
export function detectEasterEgg(text) {
  const s = String(text || '');
  if (!s) return null;
  for (const [key, re] of RULES) if (re.test(s)) return key;
  return null;
}

export function fireEasterEgg(key) {
  // the interstellar show needs the donor event — the socket fires it directly
  if (key === 'interstellar') return false;
  if (key === 'gargantua') return triggerGargantua();
  if (key === 'bitcoin') return triggerBitcoin();
  if (key === 'glitch') return triggerGlitch();
  return false;
}

// QA hook, same pattern as __secrets in secrets.js
if (typeof window !== 'undefined') {
  window.__fx = { triggerGargantua, triggerGlitch, triggerBitcoin, fireEasterEgg };
}
