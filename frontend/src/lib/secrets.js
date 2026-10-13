// Two click-spam secrets of the void.
//
//   left button  -> «Перегрузка Сингулярности»: camera shake, a jammed neon
//                   RGB disk, a flat gravitational shockwave, a boiling hum
//                   and a bass burp — plus a glitchy two-second line of text.
//   right button -> «Белая Дыра»: the whole frame inverts (white space, a
//                   glowing white core), gravity flips and shoots debris out
//                   for five seconds, the audio rewinds, then a vacuum pop
//                   snaps everything back to the dark.
//
// Everything is wall-clock (performance.now) and non-reactive: the envelopes
// advance once per frame from the black hole's useFrame, the overlay reads
// them through its own rAF loop. `?slow=0.25` stretches every timeline the
// same way `effects.ts` does, so a software-GL screenshot run can actually
// land on a transient.

import { audio } from '../audio/AudioEngine';
import { scheduleFragment } from './fragments';

const now = () => performance.now() / 1000;

const OVERLOAD_LEN = 3.4; // s — shake / neon / shockwave window
const WHITE_LEN = 5.0; // s — inverted white-hole window
const MSG_LEN = 2.0; // s — how long the easter-egg line stays up
const COOLDOWN = 14; // s between two firings of the same secret

const SLOW = (() => {
  const n = Number(new URLSearchParams(window.location.search).get('slow'));
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 1;
})();

export const secrets = {
  ts: SLOW, // debug time stretch (?slow=0.25)
  overloadStart: -1,
  whiteStart: -1,
  overload: 0, // 0..1 envelope of the overload visuals
  white: 0, // 0..1 envelope of the white hole
  shake: 0, // 0..1 camera-shake amount
  msg: null, // { text, t0 } — the glitchy line, alive for MSG_LEN
  burst: { t0: -1, span: 2, gain: 1 }, // debris flying out of the centre
  shock: [], // ring moments as offsets from overloadStart (virtual seconds)
  shockNow: 0, // rings to spawn this frame (consumed by BlackHole)
  _last: {},
};

const MSGS = [
  'STOP TICKLING THE VOID',
  'ERROR 418: SINGULARITY OVERHEAT',
];

// age of a timeline in (stretched) virtual seconds; -1 = never started
const age = (t, start) => (start < 0 ? -1 : (t - start) * secrets.ts);

const cool = (key) => {
  const t = now();
  if (secrets._last[key] && t - secrets._last[key] < COOLDOWN) return false;
  secrets._last[key] = t;
  return true;
};

// the two secrets never overlap: reality has only one mood at a time
const busy = (t) => {
  const ao = age(t, secrets.overloadStart);
  const aw = age(t, secrets.whiteStart);
  return (ao >= 0 && ao < OVERLOAD_LEN) || (aw >= 0 && aw < WHITE_LEN);
};

export function fireOverload() {
  const t = now();
  if (busy(t) || !cool('overload')) return false;
  secrets.overloadStart = t;
  secrets.msg = { text: MSGS[(Math.random() * MSGS.length) | 0], t0: t };
  secrets.burst = { t0: t, span: 1.7, gain: 1 };
  secrets.shock = [0.2, 0.75];
  audio.playOverload(2.0);
  // ARG puzzle: OF rides the 3.4s overload (immediate — too short for a tail)
  scheduleFragment('overload', OVERLOAD_LEN * 1000);
  return true;
}

export function fireWhite() {
  const t = now();
  if (busy(t) || !cool('white')) return false;
  secrets.whiteStart = t;
  secrets.burst = { t0: t, span: WHITE_LEN, gain: 1.15 };
  audio.playReverse(WHITE_LEN);
  // ARG puzzle: the ellipsis shows in the last seconds of the white hole
  scheduleFragment('white', WHITE_LEN * 1000);
  return true;
}

// trapezoid envelope: quick fade in, hold, fade out — zero outside the window
const env = (a, len, fadeIn, fadeOut) => {
  if (a < 0 || a > len) return 0;
  const inK = fadeIn > 0 ? Math.min(1, a / fadeIn) : 1;
  const outK = fadeOut > 0 ? Math.min(1, (len - a) / fadeOut) : 1;
  return Math.min(inK, outK);
};

export function updateSecrets() {
  const t = now();
  const e = secrets;

  const ao = age(t, e.overloadStart);
  const aw = age(t, e.whiteStart);

  if (ao > OVERLOAD_LEN + 1) e.overloadStart = -1;
  if (aw > WHITE_LEN + 1) e.whiteStart = -1;
  if (e.msg && (t - e.msg.t0) * e.ts > MSG_LEN + 0.4) e.msg = null;

  e.overload = env(ao, OVERLOAD_LEN, 0.25, 0.7);
  e.shake = e.overload;
  e.white = env(aw, WHITE_LEN, 0.1, 0.4);

  // shockwave rings whose moment has come (spawned by BlackHole this frame)
  e.shockNow = 0;
  for (let i = e.shock.length - 1; i >= 0; i--) {
    if (ao >= e.shock[i]) {
      e.shockNow += 1;
      e.shock.splice(i, 1);
    }
  }

  return e;
}

if (typeof window !== 'undefined') {
  window.__secrets = { fireOverload, fireWhite, secrets, update: updateSecrets };
}
