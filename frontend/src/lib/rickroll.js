// Rickroll easter egg: a 15s local show — hole noise cuts out, the radio
// pauses, the chorus plays full volume over a synthwave black hole, then a
// light flash and everything fades back in.
import { audio } from '../audio/AudioEngine';
import { setState } from './store';
import { scheduleFragment } from './fragments';
import { pause as pauseMusic, isPlaying as musicPlaying, play as resumeMusic } from './music';

const SRC = '/audio/never-gonna-give-you-up.mp3';
const DURATION_MS = 15000;

const KEYWORDS = ['rickroll', 'rick astley', 'never gonna give you up'];

// trigger check: the keyword must be in the text — the amount is irrelevant
// (any sum works, it is what gets charged from the wallet)
export function detectRickroll(text) {
  const s = String(text || '').toLowerCase();
  return KEYWORDS.some((k) => s.includes(k));
}

let el = null;
let analyser = null;
let dataArr = null;
let raf = 0;
let timer = 0;
let wasPlaying = false;
let pulse = 0;
let active = false;
let cooldownUntil = 0;
const listeners = new Set();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeRickroll(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function rickrollActive() {
  return active;
}

export function rickrollPulse() {
  return pulse;
}

function ensureEl() {
  if (el) return el;
  el = new Audio(SRC);
  el.preload = 'auto';
  analyser = audio.attachRickroll(el);
  if (analyser) dataArr = new Uint8Array(analyser.frequencyBinCount);
  return el;
}

function loop() {
  if (!active) return;
  if (analyser && dataArr) {
    analyser.getByteFrequencyData(dataArr);
    let sum = 0;
    for (let i = 2; i < 12; i++) sum += dataArr[i];
    const target = Math.min(1, sum / (10 * 190));
    pulse += (target - pulse) * 0.3;
  } else {
    // no analyser (sound disabled): keep the visuals breathing at ~110 bpm
    pulse = 0.5 + 0.5 * Math.sin(performance.now() / 140);
  }
  raf = requestAnimationFrame(loop);
}

function stop() {
  if (!active) return;
  active = false;
  cancelAnimationFrame(raf);
  clearTimeout(timer);
  if (el) {
    el.pause();
    el.currentTime = 0;
  }
  audio.setRickroll(false);
  pulse = 0;
  setState({ flash: 1.25 }); // light flash as the scene comes back
  if (wasPlaying) resumeMusic();
  wasPlaying = false;
  emit();
}

export function startRickroll() {
  const now = Date.now();
  if (active || now < cooldownUntil) return false;
  cooldownUntil = now + DURATION_MS + 2000;
  active = true;
  wasPlaying = musicPlaying();
  pauseMusic(false); // programmatic pause: keeps the autoplay intent alive
  audio.setRickroll(true);
  const node = ensureEl();
  node.currentTime = 0;
  const p = node.play();
  if (p && p.catch) p.catch(() => {});
  clearTimeout(timer);
  timer = setTimeout(stop, DURATION_MS);
  // ARG puzzle: STATE lands in the fade of the 15s show
  scheduleFragment('rickroll', DURATION_MS);
  loop();
  emit();
  return true;
}

// true while a fresh show can start (not active and not cooling down) —
// checked before the wallet is charged
export function canRickroll() {
  return !active && Date.now() >= cooldownUntil;
}

// QA hook, same pattern as __secrets / __fx
if (typeof window !== 'undefined') {
  window.__rickroll = { active: rickrollActive, can: canRickroll, start: startRickroll };
}
