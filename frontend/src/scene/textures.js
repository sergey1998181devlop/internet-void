import * as THREE from 'three';

const cache = new Map();

const FONT = '700 %spx Inter, system-ui, sans-serif';
// the canvas is grown/shrunk around the copy so a short line and a long
// paragraph both fill their flying card instead of floating in dead space
const MAX_W = 1180;
const MAX_H = 620;
const MIN_SIZE = 34;
const MAX_SIZE = 172;

let measureCanvas = null;

function measureCtx() {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas.getContext('2d');
}

// break the copy into lines that fit maxW, splitting over-long words by hand
function wrapLines(ctx, text, maxW) {
  const paragraphs = String(text).split(/\r?\n/);
  const lines = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let cur = '';
    for (const word of words) {
      const cand = cur ? cur + ' ' + word : word;
      if (ctx.measureText(cand).width <= maxW) {
        cur = cand;
        continue;
      }
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      let rest = word;
      while (rest && ctx.measureText(rest).width > maxW && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxW) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      cur = rest;
    }
    if (cur) lines.push(cur);
  }
  return lines.length ? lines : [''];
}

export function makeTextTexture(text, opts = {}) {
  const key = 't:' + text + ':' + (opts.color || '');
  if (cache.has(key)) return cache.get(key);

  const raw = String(text ?? '').replace(/[ \t]{2,}/g, ' ').trim() || '…';
  const mctx = measureCtx();

  // pick the biggest font that still fits the box: short phrases come out
  // huge, long ones shrink until every line fits inside the holder
  let size = MAX_SIZE;
  let lines = [raw];
  let widest = 0;
  let pad = 0;
  let w = 0;
  let h = 0;
  for (let i = 0; i < 48; i++) {
    mctx.font = FONT.replace('%s', size);
    pad = Math.round(size * 0.36);
    lines = wrapLines(mctx, raw, MAX_W - pad * 2);
    widest = 0;
    for (const l of lines) widest = Math.max(widest, mctx.measureText(l).width);
    const lineH = size * 1.16;
    w = Math.ceil(widest + pad * 2);
    h = Math.ceil(lines.length * lineH + pad * 2);
    if (w <= MAX_W && h <= MAX_H) break;
    if (size <= MIN_SIZE) break;
    size = Math.max(MIN_SIZE, size * 0.92);
  }
  w = Math.max(180, Math.min(MAX_W, w));
  h = Math.max(96, Math.min(MAX_H, h));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const font = FONT.replace('%s', size);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lineH = size * 1.16;
  const top = h / 2 - (lines.length * lineH) / 2 + lineH / 2;

  ctx.shadowColor = 'rgba(255,170,80,0.9)';
  ctx.shadowBlur = size * 0.46;
  ctx.fillStyle = opts.color || '#ffd9a8';
  lines.forEach((l, i) => ctx.fillText(l, w / 2, top + i * lineH));

  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(2, size * 0.045);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  lines.forEach((l, i) => ctx.strokeText(l, w / 2, top + i * lineH));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

export function loadImageTexture(url) {
  if (cache.has('u:' + url)) return cache.get('u:' + url);
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.crossOrigin = 'anonymous';
  cache.set('u:' + url, tex);
  return tex;
}
