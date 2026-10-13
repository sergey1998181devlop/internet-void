// The rickroll gif that takes over the black interior of the shadow.
// Source: icegif-162.gif (640x480, 147 frames, 4.9s loop) -> public/gfx/hole-rickroll.gif.
//
// Chrome never hands an animated <img> over frame 0 to canvas/WebGL (drawImage
// and texImage2D both always return the first frame), so the file is parsed
// and LZW-decoded here and played frame by frame into one canvas.
import * as THREE from 'three';

const SRC = '/gfx/hole-rickroll.gif';

let raw = null; // bytes of the whole gif
let canvas = null;
let ctx = null;
let texture = null;
let started = false;
let ready = false;

let frames = []; // {left, top, w, h, delay, disposal, transparent, minCode, data}
let palette = null;
let screenW = 640;
let screenH = 480;
let aspect = 640 / 480;

let screenBuf = null; // composited RGBA of the whole screen
let pixBuf = null; // scratch for one decoded frame
let frameIdx = 0;
let acc = 0;
let last = 0;
let playing = false;
let lastErr = null;

// ---------------------------------------------------------------- parsing --
function parseGif(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
  if (magic !== 'GIF') throw new Error('not a gif');
  screenW = dv.getUint16(6, true);
  screenH = dv.getUint16(8, true);
  aspect = screenW / screenH;

  let p = 13;
  const packed = bytes[10];
  let gct = null;
  if (packed & 0x80) {
    gct = bytes.subarray(p, p + 3 * (1 << ((packed & 7) + 1)));
    p += gct.length;
  }

  const out = [];
  let gce = null;

  while (p < bytes.length) {
    const b = bytes[p];
    if (b === 0x3b) break; // trailer
    if (b === 0x21) {
      const label = bytes[p + 1];
      let q = p + 2;
      if (label === 0xf9) {
        const size = bytes[q];
        const flags = bytes[q + 1];
        gce = {
          delay: (bytes[q + 2] | (bytes[q + 3] << 8)) * 10, // centiseconds -> ms
          disposal: (flags >> 2) & 7,
          transparent: flags & 1 ? bytes[q + 4] : -1,
        };
        q += 1 + size;
        while (bytes[q] !== 0) q += 1 + bytes[q];
      } else {
        // comment / plain text / application (netscape loop) blocks
        if (bytes[q] !== 0) q += 1 + bytes[q];
        while (bytes[q] !== 0) q += 1 + bytes[q];
      }
      p = q + 1;
      continue;
    }
    if (b === 0x2c) {
      const left = dv.getUint16(p + 1, true);
      const top = dv.getUint16(p + 3, true);
      const w = dv.getUint16(p + 5, true);
      const h = dv.getUint16(p + 7, true);
      const flags = bytes[p + 9];
      let q = p + 10;
      let lct = null;
      if (flags & 0x80) {
        lct = bytes.subarray(q, q + 3 * (1 << ((flags & 7) + 1)));
        q += lct.length;
      }
      const minCode = bytes[q++];
      // lzw data comes in sub-blocks: [len][len bytes][len][len bytes]...[0]
      const parts = [];
      while (bytes[q] !== 0) {
        const n = bytes[q];
        parts.push(bytes.subarray(q + 1, q + 1 + n));
        q += 1 + n;
      }
      q += 1;
      let total = 0;
      for (const part of parts) total += part.length;
      const data = new Uint8Array(total);
      let o = 0;
      for (const part of parts) {
        data.set(part, o);
        o += part.length;
      }
      out.push({
        left,
        top,
        w,
        h,
        delay: (gce && gce.delay) || 40,
        disposal: gce ? gce.disposal : 0,
        transparent: gce ? gce.transparent : -1,
        palette: lct || gct,
        minCode,
        data,
      });
      gce = null;
      p = q;
      continue;
    }
    throw new Error('unknown gif block 0x' + b.toString(16) + ' @' + p);
  }
  if (!out.length) throw new Error('gif has no frames');
  palette = gct;
  frames = out;
}

// ------------------------------------------------------------------- lzw ---
function lzwDecode(minCode, src, dst) {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let codeSize = minCode + 1;
  let next = eoi + 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) suffix[i] = i;

  let bitBuf = 0;
  let bitCnt = 0;
  let bytePos = 0;
  const byteEnd = src.length;
  let old = -1;
  let oldFirst = 0;
  let outPos = 0;

  const readCode = () => {
    while (bitCnt < codeSize) {
      if (bytePos >= byteEnd) return eoi;
      bitBuf |= src[bytePos++] << bitCnt;
      bitCnt += 8;
    }
    const code = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>>= codeSize;
    bitCnt -= codeSize;
    return code;
  };

  for (;;) {
    const code = readCode();
    if (code === eoi) break;
    if (code === clear) {
      codeSize = minCode + 1;
      next = eoi + 1;
      old = -1;
      continue;
    }
    if (code > next) break; // corrupt stream

    let cur = code;
    let top = 0;
    if (code >= next) {
      // KwKwK: the code being defined right now
      if (old < 0) break;
      stack[top++] = oldFirst;
      cur = old;
    }
    while (cur > eoi) {
      stack[top++] = suffix[cur];
      cur = prefix[cur];
    }
    stack[top++] = suffix[cur]; // root character
    const first = stack[top - 1];

    for (let i = top - 1; i >= 0; i--) dst[outPos++] = stack[i];

    if (old >= 0 && next < 4096) {
      prefix[next] = old;
      suffix[next] = first;
      next++;
      if (next >= 1 << codeSize && codeSize < 12) codeSize++;
    }
    old = code;
    oldFirst = first;
  }
  return outPos;
}

// ------------------------------------------------------------- compositing --
function drawFrame(i) {
  const f = frames[i];
  const pal = f.palette || palette;
  const w = f.w;
  const h = f.h;
  if (!pixBuf || pixBuf.length < w * h) pixBuf = new Uint8Array(w * h);
  const idx = pixBuf.subarray(0, w * h);
  lzwDecode(f.minCode, f.data, idx);

  const screen = screenBuf;
  const tr = f.transparent;
  const x0 = f.left;
  const y0 = f.top;

  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= screenH) continue;
    let so = y * w;
    let dofs = (sy * screenW + x0) * 4;
    for (let x = 0; x < w; x++, so++, dofs += 4) {
      const px = x0 + x;
      if (px < 0 || px >= screenW) continue;
      const ci = idx[so];
      if (ci === tr) continue; // transparent keeps what is underneath
      const po = ci * 3;
      screen[dofs] = pal[po];
      screen[dofs + 1] = pal[po + 1];
      screen[dofs + 2] = pal[po + 2];
      screen[dofs + 3] = 255;
    }
  }

  // dispose 2 = the sub-rect goes back to background before the next frame
  if (f.disposal === 2) {
    for (let y = 0; y < h; y++) {
      const sy = y0 + y;
      if (sy < 0 || sy >= screenH) continue;
      let dofs = (sy * screenW + x0) * 4;
      for (let x = 0; x < w; x++, dofs += 4) {
        const px = x0 + x;
        if (px < 0 || px >= screenW) continue;
        screen[dofs] = screen[dofs + 1] = screen[dofs + 2] = screen[dofs + 3] = 0;
      }
    }
  }
}

function paint() {
  if (!ctx || !screenBuf) return;
  ctx.putImageData(new ImageData(screenBuf, screenW, screenH), 0, 0);
  texture.needsUpdate = true;
}

// ------------------------------------------------------------------ setup --
export function loadHoleGif() {
  if (started || typeof Image === 'undefined') return;
  started = true;
  fetch(SRC)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((buf) => {
      raw = new Uint8Array(buf);
      parseGif(raw);
      screenBuf = new Uint8ClampedArray(screenW * screenH * 4);
      canvas = document.createElement('canvas');
      canvas.width = screenW;
      canvas.height = screenH;
      ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('no 2d context');
      if (typeof window !== 'undefined') window.__gifCanvas = canvas;
      drawFrame(0);
      frameIdx = 0;
      const tex = new THREE.CanvasTexture(canvas);
      // raw sRGB bytes: the shader composites after its own gamma pass
      tex.colorSpace = THREE.NoColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      texture = tex;
      paint();
      ready = true;
      playing = false;
      acc = 0;
      last = 0;
    })
    .catch((e) => {
      console.warn('[gif]', e && e.message);
      lastErr = String((e && e.message) || e);
      if (typeof window !== 'undefined') window.__gifErr = lastErr;
      started = false; // allow a retry
    });
}

// play the clip (paced by the gif's own frame delays) — call only while it is
// on screen, so it pauses together with the rickroll
export function updateHoleGif(now) {
  if (!ready || !frames.length) return;
  if (!playing) {
    playing = true;
    last = now;
    acc = 0;
    return;
  }
  let dt = now - last;
  if (dt < 0 || dt > 1000) dt = 0; // first call after a pause: no time jump
  last = now;
  acc += dt;
  let guard = 0;
  let changed = false;
  while (acc >= frames[frameIdx].delay && guard++ < 64) {
    acc -= frames[frameIdx].delay;
    let nx = frameIdx + 1;
    if (nx >= frames.length) {
      screenBuf.fill(0); // no stale pixels through transparent areas
      nx = 0;
    }
    frameIdx = nx;
    drawFrame(frameIdx);
    changed = true;
  }
  if (changed) paint();
}

export function holeGif() {
  return {
    texture,
    ready,
    aspect,
    frames: frames.length,
    w: screenW,
    h: screenH,
    idx: frameIdx,
    playing,
    err: lastErr,
  };
}
