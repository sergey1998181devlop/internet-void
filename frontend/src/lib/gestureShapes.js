// Held-button stroke gestures for the void.
//
// Pure math, no DOM / three / imports: a stroke is an array of
// `{ x, y, t }` viewport points recorded while the left button is down.
// Three shapes are recognised on pointer-up:
//
//   shake     rapid horizontal back-and-forth (direction reversals)
//   circle    >= ~2.5 full turns around the stroke's own centroid,
//             circular enough to beat the lemniscate template
//   infinity  a lemniscate whose crossing sits near the hole
//
// Circles and infinity are classified by template matching: the stroke and a
// set of pre-rendered templates are arc-length resampled to the same number
// of points, squashed into a unit box (bbox centre + size, so any aspect
// ratio matches), then compared over every cyclic start offset and both
// traversal directions. Thresholds live in `cfg` and are tunable at runtime
// through `window.__gestures.cfg`.

const N = 64; // samples per closed curve
const TAU = Math.PI * 2;

export const GESTURE_DEFAULTS = {
  // shake
  shakeFlips: 5, // direction reversals (each with >= shakeLeg px of travel)
  shakeLeg: 30, // px a leg must cover to count as a real reversal
  shakeHoriz: 360, // px of total horizontal travel
  shakeRatio: 2, // horizontal travel >= shakeRatio * vertical travel
  shakeMs: 10000, // the whole stroke must be this fast
  // shared shape gate
  minPath: 500, // px of arc length before any shape is considered
  // circle
  circleTurns: 2.55, // turns of |angle| around the centroid (spec: 3 laps)
  dCirc: 0.19, // max template distance for a circle
  // infinity
  dInf: 0.22, // max template distance for a lemniscate
  infMargin: 0.03, // the lemniscate must beat the circle by this much
  // both shapes must be drawn around the hole
  nearCenter: 0.3, // centroid within nearCenter * minDim of the view centre
  infCross: 0.22, // the infinity crossing within infCross * minDim of centre
  infTilts: [-30, -15, 0, 15, 30], // template tilts (deg)
};

const resample = (pts, n) => {
  const m = pts.length;
  if (m < 2) return null;
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  const total = cum[m - 1];
  if (!(total > 0)) return null;
  const out = new Array(n);
  let j = 1;
  for (let k = 0; k < n; k++) {
    // uniform arc positions; closed curves skip the duplicated end point
    const target = (total * k) / n;
    while (j < m - 1 && cum[j] < target) j++;
    const seg = cum[j] - cum[j - 1];
    const f = seg > 1e-9 ? (target - cum[j - 1]) / seg : 0;
    out[k] = {
      x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * f,
      y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * f,
    };
  }
  return out;
};

// bbox centre + size -> unit box, identical for stroke and templates, so a
// wide flat infinity and a tall narrow one both land on the same shape
const normBox = (samples) => {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of samples) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  const w = Math.max(x1 - x0, 1e-6);
  const h = Math.max(y1 - y0, 1e-6);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return samples.map((p) => ({ x: (p.x - cx) / w, y: (p.y - cy) / h }));
};

// a circle stroke of L laps is matched against an L-lap circle: both are
// resampled over the whole path, so the angular speed of the samples matches.
// L may be fractional (the stroke usually stops mid-lap) — the cache is
// quantised to 0.05 so arbitrary turn counts stay bounded.
const circleCache = new Map();
const templateCircle = (laps) => {
  const L = Math.max(0.5, Math.round(laps * 20) / 20);
  if (circleCache.has(L)) return circleCache.get(L);
  const pts = [];
  for (let i = 0; i < 512; i++) {
    const a = (TAU * L * i) / 512;
    pts.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  const t = normBox(resample(pts, N));
  circleCache.set(L, t);
  return t;
};

// Bernoulli lemniscate: x = cos t / (1 + sin^2 t), y = sin t cos t / (1 + sin^2 t)
const templateInfinity = (tiltDeg) => {
  const raw = [];
  const a = (tiltDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  for (let i = 0; i < 1024; i++) {
    const t = (TAU * i) / 1024;
    const d = 1 + Math.sin(t) * Math.sin(t);
    const x = Math.cos(t) / d;
    const y = (Math.sin(t) * Math.cos(t)) / d;
    raw.push({ x: x * ca - y * sa, y: x * sa + y * ca });
  }
  return normBox(resample(raw, N));
};

const T_CIRCLE = templateCircle(1);

let infCache = null;
let infCacheKey = '';
const infinityTemplates = (tilts) => {
  const key = tilts.join(',');
  if (!infCache || infCacheKey !== key) {
    infCache = tilts.map((d) => templateInfinity(d));
    infCacheKey = key;
  }
  return infCache;
};

// best RMS distance over cyclic offsets and both traversal directions
const match = (s, t) => {
  let best = Infinity;
  for (let dir = 1; dir >= -1; dir -= 2) {
    for (let off = 0; off < s.length; off++) {
      let acc = 0;
      for (let i = 0; i < s.length; i++) {
        const j =
          dir > 0
            ? (i + off) % s.length
            : (((off - i) % s.length) + s.length) % s.length;
        const dx = s[i].x - t[j].x;
        const dy = s[i].y - t[j].y;
        acc += dx * dx + dy * dy;
      }
      const d = Math.sqrt(acc / s.length);
      if (d < best) best = d;
    }
  }
  return best;
};

const pathLen = (pts) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return s;
};

// horizontal direction reversals with a minimum leg length
const countFlips = (pts, legMin) => {
  let flips = 0;
  let dir = 0;
  let leg = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    if (dx === 0) continue;
    const s = dx > 0 ? 1 : -1;
    if (dir === 0) {
      dir = s;
      leg = Math.abs(dx);
    } else if (s === dir) {
      leg += Math.abs(dx);
    } else if (leg >= legMin) {
      flips++;
      dir = s;
      leg = Math.abs(dx);
    } else {
      dir = s;
      leg = Math.abs(dx);
    }
  }
  return flips;
};

// total |angle| swept around the centroid (near-centre samples ignored)
export const turnsAround = (pts, cx, cy) => {
  let rMax = 0;
  for (const p of pts) {
    const r = Math.hypot(p.x - cx, p.y - cy);
    if (r > rMax) rMax = r;
  }
  const skip = rMax * 0.15;
  let sum = 0;
  let last = null;
  for (const p of pts) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    if (Math.hypot(dx, dy) < skip) continue;
    const a = Math.atan2(dy, dx);
    if (last !== null) {
      let d = a - last;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      sum += Math.abs(d);
    }
    last = a;
  }
  return sum / TAU;
};

const vecField = (pts, arr) => {
  let horiz = 0;
  let vert = 0;
  for (let i = 1; i < pts.length; i++) {
    horiz += Math.abs(pts[i].x - pts[i - 1].x);
    vert += Math.abs(pts[i].y - pts[i - 1].y);
  }
  if (arr) {
    arr[0] = horiz;
    arr[1] = vert;
  }
  return horiz + vert;
};

/**
 * Classify one stroke.
 * @param pts   [{x, y, t}] viewport points, first = pointer-down
 * @param cfg   overrides on top of GESTURE_DEFAULTS
 * @param view  { cx, cy, minDim } centre and min(w, h) of the viewport
 * @returns     { kind: 'shake'|'circle'|'infinity'|null, ...debug numbers }
 */
export function classifyStroke(pts, cfg = {}, view = {}) {
  const C = { ...GESTURE_DEFAULTS, ...cfg };
  const out = { kind: null, flips: 0, turns: 0, dC: 1, dI: 1, len: 0, dur: 0 };
  if (!Array.isArray(pts) || pts.length < 6) return out;

  out.len = pathLen(pts);
  out.dur = (pts[pts.length - 1].t || 0) - (pts[0].t || 0);

  const travel = [0, 0];
  vecField(pts, travel);
  out.flips = countFlips(pts, C.shakeLeg);

  // 1) horizontal shake — checked first, it cannot look like a closed loop
  if (
    out.flips >= C.shakeFlips &&
    travel[0] >= C.shakeHoriz &&
    travel[0] >= C.shakeRatio * travel[1]
  ) {
    if (out.dur <= C.shakeMs) {
      out.kind = 'shake';
      return out;
    }
  }

  if (out.len < C.minPath) return out;

  const cx0 = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy0 = pts.reduce((s, p) => s + p.y, 0) / pts.length;

  // both drawn shapes must live around the hole, not off in a corner
  const viewCx = Number.isFinite(view.cx) ? view.cx : cx0;
  const viewCy = Number.isFinite(view.cy) ? view.cy : cy0;
  const minDim = view.minDim > 0 ? view.minDim : Infinity;
  const near = Math.hypot(cx0 - viewCx, cy0 - viewCy) <= C.nearCenter * minDim;

  const samples = resample(pts, N);
  if (!samples) return out;
  // squash guard: a stroke thinner than a few px has no reliable shape
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of samples) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  if (x1 - x0 < 8 || y1 - y0 < 8) return out;
  const norm = normBox(samples);

  // how many laps the stroke actually made: the circle template must spin
  // at the same angular speed or a 2.7-lap stroke cannot match any template
  out.turns = turnsAround(pts, cx0, cy0);
  out.dC = match(norm, T_CIRCLE);
  const Ls = new Set([
    out.turns,
    Math.round(out.turns),
    Math.ceil(out.turns),
    Math.floor(out.turns),
    Math.round(out.turns) + 1,
    Math.round(out.turns) - 1,
  ]);
  for (const L of Ls) {
    if (!(L >= 1.5 && L <= 8)) continue;
    const d = match(norm, templateCircle(L));
    if (d < out.dC) out.dC = d;
  }
  out.dI = Infinity;
  for (const t of infinityTemplates(C.infTilts)) {
    const d = match(norm, t);
    if (d < out.dI) out.dI = d;
  }

  // 3) infinity: a lemniscate crossing right at the hole, clearly better
  //    than the circle template
  if (near && out.dI < C.dInf && out.dI + C.infMargin < out.dC) {
    let cross = Infinity;
    for (const p of pts) cross = Math.min(cross, Math.hypot(p.x - viewCx, p.y - viewCy));
    if (cross <= C.infCross * minDim) {
      out.kind = 'infinity';
      return out;
    }
  }

  // 2) circles: enough turns and round enough to beat the lemniscate
  if (near && out.turns >= C.circleTurns && out.dC <= C.dCirc && out.dC + 0.03 < out.dI) {
    out.kind = 'circle';
    return out;
  }

  return out;
}
