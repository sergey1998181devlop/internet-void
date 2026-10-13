import { useEffect, useRef } from 'react';
import { effects } from '../lib/effects';

const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>{}[]/\\|=+*#@$%';

// Full-screen 404 corruption: inverted flashes, torn bands, scanlines and a
// thin layer of falling glyphs. After two seconds the hole swallows it whole.
export default function GlitchOverlay() {
  const root = useRef(null);
  const canvas = useRef(null);
  const strips = useRef([]);
  const lastRain = useRef(0);
  const cells = useRef([]);

  useEffect(() => {
    let raf = 0;
    let cols = 0;
    let rows = 0;

    const sizeCanvas = () => {
      const c = canvas.current;
      if (!c) return;
      const w = Math.min(1600, Math.floor(window.innerWidth / 2));
      const h = Math.min(900, Math.floor(window.innerHeight / 2));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
        cols = Math.max(10, Math.floor(w / 11));
        rows = Math.max(6, Math.floor(h / 14));
        cells.current = new Array(cols * rows).fill(0).map(() => ({
          y: Math.random() * rows,
          s: 0.4 + Math.random() * 1.4,
        }));
      }
    };

    const drawRain = () => {
      const c = canvas.current;
      if (!c) return;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,0.32)';
      g.fillRect(0, 0, c.width, c.height);
      g.font = '13px monospace';
      g.textBaseline = 'top';
      for (let x = 0; x < cols; x++) {
        const cell = cells.current[x] || cells.current[0];
        if (!cell) continue;
        cell.y += cell.s;
        if (cell.y > rows + 6) {
          cell.y = -Math.random() * 6;
          cell.s = 0.4 + Math.random() * 1.6;
        }
        const head = Math.floor(cell.y);
        for (let k = 0; k < 14; k++) {
          const yy = head - k;
          if (yy < 0 || yy >= rows) continue;
          const ch = GLYPHS[(x * 31 + yy * 17 + k * 7) % GLYPHS.length];
          const a = k === 0 ? 0.95 : Math.max(0, 0.5 - k * 0.04);
          g.fillStyle = k === 0 ? `rgba(210,255,220,${a})` : `rgba(40,255,110,${a})`;
          g.fillText(ch, x * 11, yy * 14);
        }
      }
    };

    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const el = root.current;
      if (!el) return;
      const g = effects.glitch;
      const suck = effects.glitchSuck;
      const active = g > 0.001 || suck > 0.001;

      if (!active) {
        if (el.style.display !== 'none') el.style.display = 'none';
        return;
      }
      if (el.style.display !== 'block') {
        el.style.display = 'block';
        sizeCanvas();
      }

      // flickering inversion + slight jitter
      const flick = Math.floor(now / 70) % 3;
      el.style.opacity = String(0.55 + 0.45 * g * (flick === 0 ? 1 : 0.6));
      el.style.transform =
        `translate(${(Math.random() - 0.5) * 9 * g}px, ${(Math.random() - 0.5) * 5 * g}px)`;

      const inv = el.querySelector('[data-invert]');
      if (inv) inv.style.opacity = String(flick === 1 ? 0.5 * g : 0.14 * g);

      // torn horizontal bands
      strips.current.forEach((s, i) => {
        if (!s) return;
        const seed = Math.floor(now / (60 + i * 23));
        const h = 6 + ((seed * (i + 3)) % 40);
        const y = ((seed * (i + 7) * 137) % 100);
        s.style.top = y + '%';
        s.style.height = h + 'px';
        s.style.opacity = String((0.25 + 0.5 * ((seed + i) % 3) / 2) * g);
        s.style.transform = `translateX(${((seed % 5) - 2) * 26 * g}px)`;
      });

      if (now - lastRain.current > 64) {
        lastRain.current = now;
        drawRain();
      }

      // the hole eats it: shrink into the centre and vanish
      if (suck > 0.001) {
        const k = Math.min(1, suck);
        el.style.transform = `scale(${1 - 0.94 * k}) rotate(${k * 8}deg)`;
        el.style.opacity = String(Math.max(0, 1 - k));
        el.style.clipPath = `circle(${Math.max(0, (1 - k) * 78)}% at 50% 50%)`;
      } else {
        el.style.clipPath = 'none';
      }
    };

    raf = requestAnimationFrame(loop);
    window.addEventListener('resize', sizeCanvas);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', sizeCanvas);
    };
  }, []);

  return (
    <div
      ref={root}
      className="pointer-events-none fixed inset-0 z-50"
      style={{ display: 'none', willChange: 'transform, opacity' }}
    >
      <div
        data-invert
        className="absolute inset-0"
        style={{ backdropFilter: 'invert(1) contrast(1.7)', opacity: 0 }}
      />
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          ref={(el) => (strips.current[i] = el)}
          className="absolute left-0 w-full"
          style={{
            backdropFilter: 'hue-rotate(180deg) saturate(2.4) brightness(1.5)',
            opacity: 0,
          }}
        />
      ))}
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" style={{ mixBlendMode: 'screen', opacity: 0.5 }} />
      <div
        className="absolute inset-0"
        style={{
          background:
            'repeating-linear-gradient(to bottom, rgba(0,0,0,0.42) 0px, rgba(0,0,0,0.42) 1px, transparent 1px, transparent 3px)',
          opacity: 0.75,
        }}
      />
    </div>
  );
}
