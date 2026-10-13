// Cosmic radio: Jamendo track queue + a single shared HTMLAudioElement that
// is routed through AudioEngine's music bus (ducking, mute, big-bang cover)
import { audio } from '../audio/AudioEngine';

const listeners = new Set();
let el = null;
let srcFor = '';

// two queues: 1 = cosmic ambient, 2 = dark industrial drone (phase 2)
const lists = { 1: [], 2: [] };
const inflight = { 1: null, 2: null };

let state = {
  tracks: [],
  index: -1,
  playing: false,
  volume: 0.8,
  loading: false,
  error: false,
  phase: 1,
};

// --- autoplay on entry ----------------------------------------------------
// The radio starts itself as soon as the track list arrives and fades in from
// silence. Browsers may hold playback back until the first gesture, so the
// attempt is retried on pointerdown/keydown; the volume ramp itself only runs
// once the AudioContext is actually running (otherwise the fade would be over
// before the first audible sample).
const FADE_MS = 5000;
let autoplayArmed = false;
let userPaused = false;
let gestureBound = false;
let ticker = 0;
let fadeT0 = 0;

function soundOn() {
  try {
    return localStorage.getItem('void_sound') !== '0';
  } catch {
    return true;
  }
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker);
    ticker = 0;
  }
}

function tick() {
  const node = el;
  if (!node || !autoplayArmed || userPaused || !soundOn()) {
    stopTicker();
    return;
  }
  // wait for the first gesture: no ramp while the graph is suspended
  if (audio.ctx && audio.ctx.state !== 'running') return;
  if (!fadeT0) fadeT0 = performance.now();
  const t = Math.min(1, (performance.now() - fadeT0) / FADE_MS);
  const s = t * t * (3 - 2 * t);
  node.volume = Math.max(0, Math.min(1, state.volume * s));
  if (t >= 1) stopTicker(); // fade finished, hand the level to the slider
}

function startTicker() {
  if (ticker) return;
  ticker = setInterval(tick, 100);
  tick();
}

function fadeDone() {
  fadeT0 = performance.now() - FADE_MS;
  stopTicker();
}

function bindGestures() {
  if (gestureBound || typeof window === 'undefined') return;
  gestureBound = true;
  const onGesture = () => {
    if (autoplayArmed && !userPaused && (!state.playing || (el && el.paused))) attemptAutoplay();
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, onGesture, { passive: true })
  );
}

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeMusic(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// stable object reference between changes (useSyncExternalStore / Object.is)
export function getMusic() {
  return state;
}

function set(patch) {
  state = { ...state, ...patch };
  emit();
}

function ensureEl() {
  if (el) return el;
  el = new Audio();
  el.crossOrigin = 'anonymous';
  el.preload = 'auto';
  el.volume = state.volume;
  el.addEventListener('ended', () => next());
  el.addEventListener('error', () => {
    if (state.playing) next(); // dead stream: skip ahead
  });
  return el;
}

function applyList(p) {
  const tracks = lists[p];
  set({
    phase: p,
    tracks,
    index: tracks.length ? 0 : -1,
    error: tracks.length === 0,
    loading: false,
  });
}

export async function loadTracks(phase = state.phase) {
  const p = Number(phase) === 2 ? 2 : 1;
  if (lists[p].length) {
    if (state.phase !== p) applyList(p);
    return lists[p];
  }
  if (inflight[p]) return inflight[p];
  inflight[p] = (async () => {
    set({ loading: true, error: false });
    try {
      const res = await fetch('/api/music/tracks?phase=' + p);
      const data = await res.json().catch(() => ({}));
      const tracks = Array.isArray(data.tracks) ? data.tracks : [];
      lists[p] = tracks;
      if (state.phase === p) applyList(p);
      else set({ loading: false });
      return tracks;
    } catch {
      set({ loading: false, error: state.tracks.length === 0 });
      return [];
    } finally {
      inflight[p] = null;
    }
  })();
  return inflight[p];
}

// ARG phase 2: the stabilized void swaps the cosmic radio for the dark
// industrial queue. A running stream keeps playing (new track from the top),
// a paused one just gets the new list.
export function setMusicPhase(phase) {
  const p = Number(phase) === 2 ? 2 : 1;
  if (p === state.phase) return;
  const resume = !!(state.playing && el && !el.paused);
  set({ phase: p });
  const swap = (tracks) => {
    if (!tracks.length || state.phase !== p) return;
    if (state.tracks !== tracks) set({ tracks, index: 0, error: false });
    if (resume) play(0);
    else if (!userPaused && autoplayArmed) attemptAutoplay();
  };
  if (lists[p].length) swap(lists[p]);
  else loadTracks(p).then(swap);
}

export function play(i = state.index) {
  const idx = i >= 0 ? i : 0;
  const track = state.tracks[idx];
  if (!track) return;
  const node = ensureEl();
  audio.ensureMusic();
  audio.attachMusic(node); // no-op after the first call
  if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  if (srcFor !== track.audio) {
    srcFor = track.audio;
    node.src = track.audio;
  }
  node.volume = state.volume; // explicit start: no fade
  fadeDone();
  userPaused = false;
  autoplayArmed = soundOn();
  node.play().catch(() => {});
  set({ index: idx, playing: true });
}

// user-facing stop: forgets the autoplay intent
export function pause(user = true) {
  if (el) el.pause();
  if (user) {
    userPaused = true;
    autoplayArmed = false;
    stopTicker();
  }
  if (state.playing) set({ playing: false });
}

// mute the radio without touching the autoplay intent (global sound toggle)
export function pauseRadio() {
  if (el) el.pause();
  if (state.playing) set({ playing: false });
}

export function toggle() {
  if (state.playing) pause(true);
  else play();
}

export function next() {
  if (!state.tracks.length) return;
  const cur = state.index >= 0 ? state.index : 0;
  play((cur + 1) % state.tracks.length);
}

export function setVolume(v) {
  const vol = Math.max(0, Math.min(1, Number(v) || 0));
  if (el) el.volume = vol;
  fadeDone(); // the slider owns the level from here
  if (vol !== state.volume) set({ volume: vol });
}

export function isPlaying() {
  return state.playing;
}

function attemptAutoplay() {
  if (!autoplayArmed || userPaused || !soundOn()) return false;
  if (!state.tracks.length) return false;
  if (state.playing && el && !el.paused) {
    startTicker();
    return true;
  }
  const idx = state.index >= 0 ? state.index : 0;
  const track = state.tracks[idx];
  if (!track) return false;
  const node = ensureEl();
  audio.ensureMusic();
  audio.attachMusic(node);
  if (audio.ctx && audio.ctx.state === 'suspended') {
    const r = audio.ctx.resume();
    if (r && r.catch) r.catch(() => {});
  }
  if (srcFor !== track.audio) {
    srcFor = track.audio;
    node.src = track.audio;
  }
  node.volume = 0; // silent start, the ticker fades it up
  fadeT0 = 0;
  set({ index: idx });
  const started = () => {
    if (userPaused || !autoplayArmed || node.paused) return;
    set({ playing: true });
    startTicker();
  };
  const p = node.play();
  if (p && p.then) p.then(started, () => {}); // blocked -> retried on gesture
  else started();
  return true;
}

// call once the playlist is known: start the radio on entry
export function armAutoplay() {
  if (!soundOn() || userPaused) {
    autoplayArmed = false;
    return false;
  }
  autoplayArmed = true;
  bindGestures();
  return attemptAutoplay();
}

// debug/inspection hook (window.__musicDebug)
export function getMusicDebug() {
  return {
    ...state,
    elVolume: el ? el.volume : null,
    paused: el ? el.paused : null,
    ctxState: audio.ctx ? audio.ctx.state : 'none',
    armed: autoplayArmed,
    userPaused,
    fading: !!ticker,
    fadeT0,
    fadeMs: FADE_MS,
    now: typeof performance !== 'undefined' ? performance.now() : 0,
  };
}
