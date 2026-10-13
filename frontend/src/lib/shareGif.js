// Share media for a destroyed sacrifice.
//
// The flow replays one sacrifice in the live scene (short hero hold), waits
// for its suction to start and captures the WebGL canvas while the element is
// being torn apart:
//
//   video (default)  MediaRecorder on a full-frame canvas — the whole screen,
//                    30 fps, mp4 where the browser can write it, webm otherwise
//   gif (fallback)   centred square clip encoded with gifenc, for engines
//                    without MediaRecorder
//
//   waiting  -> the void finishes whatever is already on screen
//   suck     -> our card flies to the centre and starts the destruction
//   recording-> frames are captured for the length of the suction
//   encoding -> gif only: one global palette, then a shrink pass

import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { setState, getState } from './store';
import { orbit } from '../scene/orbit';
import { setRecordPhase } from './stabilize';

const FPS = 10; // gif capture rate (the encoder may keep every 2nd frame)
const GIF_SIZE = 384; // square gif output
const CROP = 0.82; // share of the smaller canvas side for the gif
const COLORS = 112;
const MAX_EDGE = 1280; // video: cap the long edge so the clip stays small
const VIDEO_FPS = 30;
const VIDEO_BITRATE = 4_000_000;
const MAX_MS = 13000;
const HOLD_S = 1.1; // compressed hero hold for a replayed destroy
const GIF_BUDGET = 3.2 * 1024 * 1024;
const VIDEO_BUDGET = 8 * 1024 * 1024;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, timeout, step = 70) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await fn();
    } catch {
      /* keep polling */
    }
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await wait(step);
  }
}

function setStage(s) {
  if (typeof window === 'undefined') return;
  window.__gifStage = s;
  window.__gifRec = { stage: s, frames: 0 };
}

// ---------------------------------------------------------------- runs
//
// One recording at a time. Every run takes the newest token; a bump of the
// token (a new share, a retry, closing the modal) cancels the run that is
// still in flight — it stops capturing AND the card it put on stage is torn
// down, so the next recording never has to wait for the previous one.

let runSeq = 0;
const armedIds = new Set(); // cards this module put on the void

const beginRun = () => ++runSeq;
const cancelled = (my) => my !== runSeq;

export function cancelShareRecording() {
  runSeq += 1;
  if (armedIds.size) {
    const drop = armedIds;
    setState({ queue: getState().queue.filter((e) => !drop.has(e.id)) });
    const ab = (window.__voidAbort = window.__voidAbort || new Set());
    for (const id of drop) ab.add(id);
    drop.clear();
  }
  stopHold();
  unlockShotCamera();
  setRecordPhase(0);
}

// ---------------------------------------------------------------- camera
//
// The clip is framed like a logo: the camera sits a hair under the disk so we
// look up at the void, and the shot is offset a hair so the void sits just
// below frame centre. The lock also freezes the idle drift for the shot.

const SHOT_PAN = 0.0165; // fraction of the frame the void sits below centre
const SHOT_PHI = -0.02; // rad — tilt the locked shot to look from just below

let camSave = null;

function lockShotCamera() {
  if (camSave) return;
  camSave = {
    thetaUser: orbit.thetaUser,
    phiUser: orbit.phiUser,
    lock: orbit.lock,
    pan: orbit.pan,
  };
  orbit.lock = true;
  orbit.thetaUser = 0;
  orbit.phiUser = SHOT_PHI;
  orbit.pan = SHOT_PAN;
}

function unlockShotCamera() {
  if (!camSave) return;
  orbit.lock = camSave.lock;
  orbit.thetaUser = camSave.thetaUser;
  orbit.phiUser = camSave.phiUser;
  orbit.pan = camSave.pan;
  camSave = null;
}

// the level of the void this sacrifice was burned on (1 = old palette)
function shotPhase(event) {
  const p = Number(event && event.phase);
  if (p === 1 || p === 2) return p;
  return getState().stabilized ? 2 : 1;
}

// one paint: brand on top, the sacrificed line under it
function paintOverlay(ctx, label, W, H) {
  const k = W / 640; // type scale follows the frame width
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.18);
  top.addColorStop(0, 'rgba(0,0,0,0.55)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.18);

  const bot = ctx.createLinearGradient(0, H * 0.7, 0, H);
  bot.addColorStop(0, 'rgba(0,0,0,0)');
  bot.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = bot;
  ctx.fillRect(0, H * 0.7, W, H * 0.3);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = `800 ${Math.round(15 * k)}px Inter, system-ui, sans-serif`;
  try {
    ctx.letterSpacing = `${Math.max(1, Math.round(3 * k))}px`;
  } catch {
    /* older engines */
  }
  ctx.fillText('THE INTERNET VOID', W / 2, Math.round(30 * k));
  try {
    ctx.letterSpacing = '0px';
  } catch {
    /* ignore */
  }

  ctx.font = `800 ${Math.round(19 * k)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = '#ffffff';
  const maxW = W - 44 * k;
  const words = String(label || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
      if (lines.length === 2) break;
    } else {
      line = test;
    }
  }
  if (lines.length < 2 && line) lines.push(line);
  const baseY = H - 62 * k;
  lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, W / 2, baseY + i * 22 * k));

  ctx.font = `700 ${Math.round(11 * k)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(251,191,36,0.9)';
  ctx.fillText(
    'DESTROYED · ' + (typeof location !== 'undefined' ? location.host : ''),
    W / 2,
    H - 18 * k
  );
}

// ---------------------------------------------------------------- replay

// waits for a quiet void, queues the sacrifice with a compressed hero hold
// and resolves once THIS card is the one being destroyed
async function armReplay(glCanvas, event, stage, my) {
  const gl = glCanvas && glCanvas.current ? glCanvas.current : glCanvas;
  if (!gl || !gl.getContext) throw new Error('no_canvas');
  const id = (event.id || 'ev') + '-g' + Date.now().toString(36);
  const label = event.text || event.name || 'destroyed';

  stage('waiting');
  await until(
    () => cancelled(my) || ((window.__voidActive || 0) === 0 && getState().queue.length === 0),
    30000
  );
  if (cancelled(my)) throw new Error('cancelled');

  // pin the level the sacrifice was burned on + the logo framing for the shot
  setRecordPhase(shotPhase(event));
  lockShotCamera();

  window.__voidHold = HOLD_S;
  const replay = {
    ...event,
    id,
    ts: Date.now(),
    amount: Number(event.amount) || 1,
    name: event.name || 'You',
  };
  armedIds.add(id);
  setState({ queue: [...getState().queue, replay] });

  stage('suck');
  const started = await until(
    () => {
      if (cancelled(my)) return true;
      const f = window.__funnel;
      return f && f.id === id && f.phase === 'suck';
    },
    70000
  );
  if (cancelled(my)) throw new Error('cancelled');
  if (!started) throw new Error('no_suck');
  delete window.__voidHold;

  return { gl, id, label };
}

// keep capturing while OUR card is being torn apart; another card taking the
// suction over means ours is finished
function keepRecording(id) {
  const f = window.__funnel;
  if (!f) return false;
  if (f.id === id) return f.phase === 'suck';
  return f.phase !== 'suck';
}

function stopHold() {
  if (typeof window !== 'undefined') delete window.__voidHold;
}

// ---------------------------------------------------------------- video

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const list = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const m of list) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return '';
}

export function canRecordVideo() {
  return (
    typeof MediaRecorder !== 'undefined' &&
    !!pickMime() &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

export async function recordDestroyVideo({ glCanvas, event, onStage = () => {} }) {
  const mime = pickMime();
  if (!mime) throw new Error('no_recorder');
  const my = beginRun();
  const stage = (s) => {
    setStage(s);
    onStage(s);
  };

  let ctx = null;
  let W = 0;
  let H = 0;
  let rec = null;
  let stream = null;
  let poster = null;
  let id = null;
  try {
    const armed = await armReplay(glCanvas, event, stage, my);
    const { gl, label } = armed;
    id = armed.id;

    // full frame — the whole screen, no crop
    const gw = gl.width || 1280;
    const gh = gl.height || 720;
    const scale = Math.min(1, MAX_EDGE / Math.max(gw, gh));
    W = Math.max(320, Math.round(gw * scale));
    H = Math.max(240, Math.round(gh * scale));
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    ctx = out.getContext('2d', { alpha: false });

    // one still for the social preview — mid-destruction looks best
    const grabPoster = () =>
      new Promise((res) => {
        try {
          out.toBlob((b) => res(b), 'image/jpeg', 0.75);
        } catch {
          res(null);
        }
      });

    stream = out.captureStream(VIDEO_FPS);
    rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: VIDEO_BITRATE,
    });
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise((res) => {
      rec.onstop = res;
    });
    rec.start(250);

    stage('recording');
    const t0 = performance.now();
    let frames = 0;
    let next = t0;
    for (;;) {
      const now = performance.now();
      if (now >= next) {
        ctx.drawImage(gl, 0, 0, W, H);
        paintOverlay(ctx, label, W, H);
        frames += 1;
        next = now + 1000 / VIDEO_FPS;
      }
      if (cancelled(my)) throw new Error('cancelled');
      const done = !keepRecording(id);
      const st = window.__funnel && window.__funnel.id === id ? window.__funnel.stage : '';
      if (!poster && frames > 1 && (now - t0 > 4500 || st === 'shatter' || st === 'droplets')) {
        poster = await grabPoster();
      }
      window.__gifRec = { id, kind: 'video', frames, ms: Math.round(now - t0), done };
      if (done) {
        armedIds.delete(id);
        break;
      }
      if (now - t0 > MAX_MS || frames > 400) break;
      await wait(24);
    }
    rec.stop();
    await stopped;
    if (cancelled(my)) throw new Error('cancelled');
    if (!poster) poster = await grabPoster();

    const type = mime.split(';')[0];
    const blob = new Blob(chunks, { type });
    const ms = Math.round(performance.now() - t0);
    if (!blob.size || ms < 400 || frames < 4) throw new Error('too_short');
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    return {
      kind: 'video',
      blob,
      poster,
      url: URL.createObjectURL(blob),
      mime: type,
      ext,
      width: W,
      height: H,
      bytes: blob.size,
      fps: VIDEO_FPS,
      frames,
      duration: Math.round(ms / 100) / 10,
    };
  } catch (e) {
    try {
      if (rec && rec.state !== 'inactive') rec.stop();
    } catch {
      /* ignore */
    }
    stopHold();
    throw e;
  } finally {
    stopHold();
    if (id) armedIds.delete(id);
    unlockShotCamera();
    setRecordPhase(0);
    try {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------- gif

let scratch = null;
function scratchCanvas() {
  if (!scratch) {
    scratch = document.createElement('canvas');
    scratch.width = GIF_SIZE;
    scratch.height = GIF_SIZE;
  }
  return scratch;
}

function grab(gl, label) {
  const w = gl.width;
  const h = gl.height;
  const side = Math.min(w, h) * CROP;
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;

  const c = scratchCanvas();
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(gl, sx, sy, side, side, 0, 0, GIF_SIZE, GIF_SIZE);
  paintOverlay(ctx, label, GIF_SIZE, GIF_SIZE);
  return ctx.getImageData(0, 0, GIF_SIZE, GIF_SIZE);
}

function encode(frames, opts) {
  const { scale, step, colors } = opts;
  const outW = Math.max(64, Math.round(GIF_SIZE * scale));
  const outH = outW;

  const src = document.createElement('canvas');
  src.width = GIF_SIZE;
  src.height = GIF_SIZE;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d', { willReadFrequently: true });

  const kept = [];
  for (let i = 0; i < frames.length; i += step) kept.push(frames[i]);
  if (kept.length < 2) return null;

  const pixels = kept.map((f) => {
    sctx.putImageData(f.img, 0, 0);
    octx.drawImage(src, 0, 0, outW, outH);
    return octx.getImageData(0, 0, outW, outH);
  });

  // one palette for the whole clip, sampled from the first, middle and last
  // kept frames so the colours survive the whole destruction
  const picks = [pixels[0], pixels[Math.floor(pixels.length / 2)], pixels[pixels.length - 1]];
  const data = new Uint8Array(picks.length * pixels[0].data.length);
  picks.forEach((p, i) => data.set(p.data, i * p.data.length));
  const palette = quantize(data, colors);

  const gif = GIFEncoder();
  const delayOf = (i) => {
    const a = kept[Math.min(i, kept.length - 1)].t;
    const b = kept[Math.min(i + 1, kept.length - 1)].t;
    const d = i + 1 < kept.length ? b - a : 120;
    return Math.max(50, Math.min(400, Math.round(d)));
  };
  for (let i = 0; i < pixels.length; i++) {
    const index = applyPalette(pixels[i].data, palette);
    gif.writeFrame(index, outW, outH, {
      palette: i === 0 ? palette : undefined,
      delay: delayOf(i),
      repeat: 0,
    });
  }
  gif.finish();
  return { bytes: gif.bytesView(), width: outW, height: outH, frames: pixels.length, kept };
}

export async function recordDestroyGif({ glCanvas, event, onStage = () => {} }) {
  const my = beginRun();
  const stage = (s) => {
    setStage(s);
    onStage(s);
  };
  let frames = [];
  let t0 = 0;
  let id = null;
  try {
    const armed = await armReplay(glCanvas, event, stage, my);
    id = armed.id;
    const { gl, label } = armed;

    stage('recording');
    t0 = performance.now();
    let next = t0;
    for (;;) {
      const now = performance.now();
      if (now >= next) {
        frames.push({ img: grab(gl, label), t: Math.round(now - t0) });
        next = now + 1000 / FPS;
      }
      if (cancelled(my)) throw new Error('cancelled');
      const done = !keepRecording(id);
      window.__gifRec = { id, kind: 'gif', frames: frames.length, ms: Math.round(now - t0), done };
      if (done) {
        armedIds.delete(id);
        break;
      }
      if (now - t0 > MAX_MS || frames.length > 200) break;
      await wait(24);
    }
  } catch (e) {
    stopHold();
    throw e;
  } finally {
    stopHold();
    if (id) armedIds.delete(id);
    unlockShotCamera();
    setRecordPhase(0);
  }

  if (frames.length < 4) throw new Error('too_few_frames');

  stage('encoding');
  await wait(30);
  const attempts = [
    { scale: 1, step: 1, colors: COLORS },
    { scale: 0.8, step: 2, colors: 96 },
    { scale: 0.66, step: 3, colors: 72 },
  ];
  let best = null;
  for (const a of attempts) {
    const r = encode(frames, a);
    if (!r) continue;
    if (!best || r.bytes.length < best.bytes.length) best = { ...r, ...a };
    if (r.bytes.length <= GIF_BUDGET) break;
    await wait(20);
  }
  if (!best) throw new Error('encode_failed');

  const blob = new Blob([best.bytes], { type: 'image/gif' });
  // gif: the clip itself is a valid preview image for the social card
  let poster = null;
  const kept = (best && best.kept) || [];
  if (kept.length) {
    const pc = document.createElement('canvas');
    pc.width = GIF_SIZE;
    pc.height = GIF_SIZE;
    pc.getContext('2d').putImageData(kept[0].img, 0, 0);
    poster = await new Promise((res) => {
      try {
        pc.toBlob((b) => res(b), 'image/jpeg', 0.75);
      } catch {
        res(null);
      }
    });
  }
  return {
    kind: 'gif',
    blob,
    poster,
    url: URL.createObjectURL(blob),
    mime: 'image/gif',
    ext: 'gif',
    width: best.width,
    height: best.height,
    frames: best.frames,
    bytes: blob.size,
    fps: Math.max(1, Math.round(FPS / best.step)),
    duration: Math.round((performance.now() - t0) / 100) / 10,
  };
}

// video first (whole screen, smooth, small); gif when the engine cannot
// record — same replay, same modal
export async function recordDestroyMedia(opts) {
  if (canRecordVideo()) {
    try {
      return await recordDestroyVideo(opts);
    } catch (e) {
      if (e && (e.message === 'no_suck' || e.message === 'no_canvas' || e.message === 'cancelled')) {
        throw e;
      }
      // recorder hiccup — fall back to the gif path on a fresh replay
      return await recordDestroyGif(opts);
    }
  }
  return await recordDestroyGif(opts);
}
