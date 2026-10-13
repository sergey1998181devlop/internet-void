import { useEffect, useRef } from 'react';
import {
  interstellarActive,
  interstellarPhase,
  interstellarElapsed,
  interstellarDonor,
  ISL_P1,
  ISL_P2,
  ISL_QUOTE_AT,
} from '../lib/interstellar';

// three-phase visual accompaniment for the Cornfield Chase show — see
// lib/interstellar.js for the timeline. Pure canvas2d, no WebGL, no state
// churn: one rAF loop paints and imperatively drives the finale quote.
const QUOTE = '«LOVE IS THE ONE THING THAT TRANSCENDS TIME AND SPACE»';
const TRAIL_MAX = 80;
const TRAIL_LIFE = 7; // seconds a frozen time-line lingers

const STARS = Array.from({ length: 110 }, (_, i) => ({
  a0: Math.random() * Math.PI * 2,
  o: Math.random(),
  spd: 0.1 + Math.random() * 0.22, // radial run per second
  w: 0.6 + Math.random() * 1.6,
  hot: Math.random() < 0.35,
}));

export default function InterstellarOverlay() {
  const cvs = useRef(null);
  const quote = useRef(null);
  const quoteDonor = useRef(null);
  const mouse = useRef({ x: 0, y: 0, has: false });
  const trail = useRef([]);

  useEffect(() => {
    const canvas = cvs.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let running = true;

    const onMove = (e) => {
      mouse.current = { x: e.clientX, y: e.clientY, has: true };
      if (interstellarActive() && interstellarPhase() === 2) {
        const pts = trail.current;
        const last = pts[pts.length - 1];
        const now = performance.now();
        if (!last || Math.hypot(e.clientX - last.x, e.clientY - last.y) > 6) {
          pts.push({ x: e.clientX, y: e.clientY, t: now });
          if (pts.length > TRAIL_MAX) pts.shift();
        }
      }
    };
    window.addEventListener('mousemove', onMove, { passive: true });

    let lastW = 0;
    let lastH = 0;

    const frame = () => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const active = interstellarActive();
      const ph = active ? interstellarPhase() : 0;
      const E = active ? interstellarElapsed() : 0;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (W * dpr !== lastW || H * dpr !== lastH) {
        lastW = W * dpr;
        lastH = H * dpr;
        canvas.width = lastW;
        canvas.height = lastH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      if (quote.current) {
        const showQ = active && ph === 3 && E >= ISL_QUOTE_AT;
        quote.current.style.opacity = showQ ? String(Math.min(1, (E - ISL_QUOTE_AT) / 2.5)) : '0';
        if (showQ && quoteDonor.current && quoteDonor.current.textContent !== interstellarDonor()) {
          quoteDonor.current.textContent = interstellarDonor();
        }
      }
      if (!active) {
        trail.current.length = 0;
        return;
      }

      const cx = W / 2;
      const cy = H / 2;
      const maxR = Math.hypot(W, H) * 0.55;
      // phase weights: p1 full then fades into p2, p2 ramps in and dims to a
      // backdrop for p3, p3 ramps from its opening to the quote
      const p1s = ph === 1 ? 1 : ph === 2 ? Math.max(0.12, 1 - (E - ISL_P1) / 5) : 0.1;
      const p2s = ph === 1 ? 0 : ph === 2 ? Math.min(1, (E - ISL_P1) / 3) : Math.max(0.22, 0.6 - (E - ISL_P2) / 25);
      const p3s = ph === 3 ? Math.min(1, (E - ISL_P2) / 10) : 0;
      const flick = ph === 3 ? 0.86 + 0.14 * Math.sin(E * 7) : 1;

      // vignette — the void closes in around the hole
      const vg = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.18, cx, cy, maxR);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(0,0,0,${0.55 + 0.3 * p1s})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      ctx.globalCompositeOperation = 'lighter';

      // phase 1: starlight bent into arcs spiralling into the horizon
      if (p1s > 0.02) {
        ctx.lineCap = 'round';
        for (const s of STARS) {
          const t = (E * s.spd + s.o) % 1;
          const r = maxR * Math.pow(1 - t, 1.55) + 6;
          const ang = s.a0 + E * 0.35 + (1 - t) * 2.6;
          const pAng = ang - 0.14 - (1 - t) * 0.2;
          const a = p1s * (t < 0.1 ? t / 0.1 : 1) * (1 - t * 0.35);
          ctx.strokeStyle = s.hot
            ? `rgba(255,183,77,${a.toFixed(3)})`
            : `rgba(255,240,214,${(a * 0.8).toFixed(3)})`;
          ctx.lineWidth = s.w;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(pAng) * r * 1.04, cy + Math.sin(pAng) * r * 1.04);
          ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
          ctx.stroke();
        }
      }

      // phase 2: the 5D tesseract — nested frames tumbling through depth
      if (p2s > 0.02) {
        const mx = mouse.current.has ? (mouse.current.x - cx) * 0.07 : 0;
        const my = mouse.current.has ? (mouse.current.y - cy) * 0.07 : 0;
        const ox = cx + mx;
        const oy = cy + my;
        for (let i = 0; i < 9; i++) {
          const d = ((i / 9 + E * 0.055) % 1 + 1) % 1;
          const sc = 0.06 + d * d * 1.7;
          const a = Math.sin(d * Math.PI) * 0.75 * p2s;
          if (a <= 0.01) continue;
          const rot = (1 - d) * 0.55 + E * 0.07 * (i % 2 ? 1 : -1);
          const half = Math.max(W, H) * 0.62 * sc;
          ctx.save();
          ctx.translate(ox, oy);
          ctx.rotate(rot);
          ctx.strokeStyle = i % 3 === 2 ? `rgba(103,232,249,${a.toFixed(3)})` : `rgba(251,191,36,${a.toFixed(3)})`;
          ctx.lineWidth = 1 + (1 - d) * 2;
          ctx.strokeRect(-half, -half * 0.72, half * 2, half * 1.44);
          ctx.restore();
        }
        // threads of time: shimmering lattice around the vanishing point
        ctx.strokeStyle = `rgba(251,191,36,${(0.2 * p2s).toFixed(3)})`;
        ctx.lineWidth = 1;
        for (let i = 1; i < 14; i++) {
          const px = (i / 14) * W;
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin(E * 1.6 + i);
          ctx.beginPath();
          ctx.moveTo(px, 0);
          ctx.lineTo(px, H);
          ctx.stroke();
        }
        for (let i = 1; i < 9; i++) {
          const py = (i / 9) * H;
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin(E * 1.3 + i * 2);
          ctx.beginPath();
          ctx.moveTo(0, py);
          ctx.lineTo(W, py);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // cursor gravity: frozen parallel time-lines left in space
        const now = performance.now();
        const pts = trail.current;
        for (let i = pts.length - 1; i >= 0; i--) {
          if ((now - pts[i].t) / 1000 > TRAIL_LIFE) {
            pts.splice(0, i + 1);
            break;
          }
        }
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i];
          const q = pts[i - 1];
          const age = (now - p.t) / 1000;
          const a = (1 - age / TRAIL_LIFE) * p2s;
          if (a <= 0.02) continue;
          let nx = -(p.y - q.y);
          let ny = p.x - q.x;
          const len = Math.hypot(nx, ny) || 1;
          nx = (nx / len) * 7;
          ny = (ny / len) * 7;
          for (let k = -2; k <= 2; k++) {
            ctx.strokeStyle = `rgba(253,230,138,${(a * (1 - Math.abs(k) / 3) * 0.85).toFixed(3)})`;
            ctx.lineWidth = k === 0 ? 1.6 : 1;
            ctx.beginPath();
            ctx.moveTo(q.x + nx * k, q.y + ny * k);
            ctx.lineTo(p.x + nx * k, p.y + ny * k);
            ctx.stroke();
          }
        }
      }

      // phase 3: time dilates — threads converge on the centre where the
      // quote will burn in (the chroma shift is painted onto the gl canvas
      // by BlackHole via the #isl-chroma filter)
      if (p3s > 0.02) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.22);
        g.addColorStop(0, `rgba(245,158,11,${(0.34 * p3s * flick).toFixed(3)})`);
        g.addColorStop(1, 'rgba(245,158,11,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        for (let k = 0; k < 26; k++) {
          const ang = (k / 26) * Math.PI * 2 + E * 0.06;
          const inner = W * (0.14 + 0.04 * Math.sin(E * 1.7 + k));
          const a = p3s * 0.3 * (0.55 + 0.45 * Math.sin(E * 2.4 + k * 1.3)) * flick;
          ctx.strokeStyle = `rgba(251,191,36,${a.toFixed(3)})`;
          ctx.lineWidth = k % 4 === 0 ? 1.6 : 1;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
          ctx.lineTo(cx + Math.cos(ang) * maxR, cy + Math.sin(ang) * maxR);
          ctx.stroke();
        }
      }

      ctx.globalCompositeOperation = 'source-over';
    };

    raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      if (quote.current) quote.current.style.opacity = '0';
    };
  }, []);

  return (
    <>
      {/* chromatic aberration for phase 3 — applied to the WebGL canvas by
          BlackHole.jsx while the show runs */}
      <svg className="pointer-events-none fixed h-0 w-0" aria-hidden="true">
        <defs>
          <filter id="isl-chroma" x="-3%" y="-3%" width="106%" height="106%" colorInterpolationFilters="sRGB">
            <feOffset in="SourceGraphic" dx="2.6" dy="0.7" result="ro" />
            <feColorMatrix
              in="ro"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="rr"
            />
            <feOffset in="SourceGraphic" dx="-2.6" dy="-0.7" result="bo" />
            <feColorMatrix
              in="bo"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="bb"
            />
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="gg"
            />
            <feBlend in="rr" in2="gg" mode="screen" result="rg" />
            <feBlend in="rg" in2="bb" mode="screen" />
          </filter>
        </defs>
      </svg>
      <canvas ref={cvs} className="pointer-events-none fixed inset-0 z-[65]" />
      <div
        ref={quote}
        className="pointer-events-none fixed inset-x-0 bottom-[18%] z-[66] text-center transition-opacity duration-700"
        style={{ opacity: 0 }}
      >
        <div className="mx-auto max-w-[900px] px-8">
          <div
            className="font-serif uppercase leading-tight tracking-[0.12em]"
            style={{
              fontSize: 'clamp(18px, 3.4vw, 42px)',
              backgroundImage: 'linear-gradient(180deg,#fde68a 0%,#f59e0b 55%,#b45309 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              filter: 'drop-shadow(0 0 26px rgba(245,158,11,0.5))',
            }}
          >
            {QUOTE}
          </div>
          <div
            ref={quoteDonor}
            data-isl-donor
            className="mt-5 font-semibold uppercase tracking-[0.42em] text-amber-300/95"
            style={{
              fontSize: 'clamp(13px, 1.9vw, 22px)',
              textShadow: '0 0 20px rgba(251,191,36,0.6)',
            }}
          />
        </div>
      </div>
    </>
  );
}
