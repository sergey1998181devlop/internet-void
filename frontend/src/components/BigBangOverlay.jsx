import { useEffect, useRef } from 'react';
import { effects } from '../lib/effects';

// Golden shrapnel of the big bang: 2D particles flying out of the centre,
// plus the blinding flash and the milestone caption.
export default function BigBangOverlay() {
  const root = useRef(null);
  const canvas = useRef(null);
  const flash = useRef(null);
  const label = useRef(null);
  const state = useRef({ active: false, fired: 0, parts: [], rings: [] });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const c = canvas.current;
      if (!c) return;
      const w = (c.width = window.innerWidth);
      const h = (c.height = window.innerHeight);
      return { w, h };
    };

    const spawn = (w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      const parts = [];
      const n = 460;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 260 + Math.pow(Math.random(), 2.2) * 1500;
        parts.push({
          x: cx,
          y: cy,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp * 0.78,
          life: 1,
          decay: 0.42 + Math.random() * 0.75,
          r: 1 + Math.random() * 3.4,
          hot: Math.random(),
        });
      }
      const rings = [
        { r: 0, sp: Math.max(w, h) * 1.35, w: 3 },
        { r: 0, sp: Math.max(w, h) * 0.72, w: 9 },
      ];
      return { parts, rings };
    };

    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const ts = effects.ts > 0 ? effects.ts : 1;
      const dt = Math.min(0.05, (now - last) / 1000) * ts;
      last = now;

      const el = root.current;
      const c = canvas.current;
      if (!el || !c) return;

      const active = effects.bangState !== 'idle';
      const s = state.current;

      if (!active) {
        if (el.style.display !== 'none') {
          el.style.display = 'none';
          const g = c.getContext('2d');
          g && g.clearRect(0, 0, c.width, c.height);
        }
        s.active = false;
        s.parts = [];
        s.rings = [];
        s.fired = 0;
        return;
      }

      if (el.style.display !== 'block') {
        el.style.display = 'block';
        resize();
      }

      const g = c.getContext('2d');

      // milestone caption during the 3s crush
      if (label.current) {
        const k = Math.min(1, Math.max(0, effects.bangT / 0.8));
        const out = effects.bangT > 3.0 ? Math.max(0, 1 - (effects.bangT - 3.0) / 0.35) : 1;
        label.current.style.opacity = String(k * out * (effects.bangFired ? 0 : 1));
        label.current.textContent = effects.bangLabel
          ? `$${Number(effects.bangLabel).toLocaleString('en-US')} \u00b7 SINGULARITY`
          : 'SINGULARITY';
      }

      // flash: only in the first half second after the rupture
      if (flash.current) {
        if (effects.bangFired && !s.fired) {
          s.fired = now;
          const dim = resize() || { w: c.width, h: c.height };
          const sys = spawn(dim.w, dim.h);
          s.parts = sys.parts;
          s.rings = sys.rings;
        }
        if (s.fired) {
          const k = Math.max(0, 1 - (now - s.fired) / (520 * ts));
          flash.current.style.opacity = String(k * k * 0.92);
        } else {
          flash.current.style.opacity = '0';
        }
      }

      if (!s.fired) return;

      g.clearRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'lighter';

      // expanding shockwave rings
      s.rings = s.rings.filter((r) => r.r < Math.max(c.width, c.height));
      s.rings.forEach((r) => {
        r.r += r.sp * dt;
        g.strokeStyle = `rgba(255,205,110,${Math.max(0, 0.5 - r.r / (Math.max(c.width, c.height) * 1.6))})`;
        g.lineWidth = r.w;
        g.beginPath();
        g.arc(c.width / 2, c.height / 2, r.r, 0, Math.PI * 2);
        g.stroke();
      });

      // sparks
      let alive = 0;
      s.parts.forEach((p) => {
        if (p.life <= 0) return;
        alive++;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - 0.62 * dt;
        p.vy *= 1 - 0.62 * dt;
        p.life -= p.decay * dt;
        const a = Math.max(0, p.life);
        const col =
          p.hot > 0.72
            ? `rgba(255,255,240,${a})`
            : p.hot > 0.35
              ? `rgba(255,214,120,${a})`
              : `rgba(255,150,40,${a})`;
        g.fillStyle = col;
        g.beginPath();
        g.arc(p.x, p.y, p.r * (0.35 + a), 0, Math.PI * 2);
        g.fill();
        // trail
        g.strokeStyle = `rgba(255,190,90,${a * 0.35})`;
        g.lineWidth = p.r * 0.7;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        g.stroke();
      });
      g.globalCompositeOperation = 'source-over';

      if (alive === 0 && now - s.fired > 400 && !effects.bangFired) {
        s.fired = 0;
      }
    };

    raf = requestAnimationFrame(loop);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div ref={root} className="pointer-events-none fixed inset-0 z-40" style={{ display: 'none' }}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      <div
        ref={flash}
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 48%, #ffffff 0%, #fff3d0 28%, rgba(255,170,60,0.55) 55%, rgba(0,0,0,0) 78%)',
          opacity: 0,
        }}
      />
      <div
        ref={label}
        className="absolute left-1/2 top-[18%] -translate-x-1/2 whitespace-nowrap text-center font-black uppercase tracking-[0.5em] text-amber-100 opacity-0"
        style={{
          fontSize: 'clamp(14px, 2.4vw, 30px)',
          textShadow: '0 0 26px rgba(255,170,60,0.9), 0 0 60px rgba(255,120,20,0.6)',
        }}
      />
    </div>
  );
}
