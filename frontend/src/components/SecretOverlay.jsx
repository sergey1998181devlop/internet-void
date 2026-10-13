import { useEffect, useRef } from 'react';
import { secrets } from '../lib/secrets';

// The two-second glitchy line of the overload secret, thrown over the centre
// of the void: glyphs scramble into place, the RGB split never stops jittering.

const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?#%&*/<>';

export default function SecretOverlay() {
  const box = useRef(null);
  const line = useRef(null);
  const flare = useRef(null);

  useEffect(() => {
    let raf = 0;
    let lastTick = 0;
    let shown = '';

    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const b = box.current;
      if (!b) return;

      const overload = secrets.overload;
      const msg = secrets.msg;
      const active = !!msg || overload > 0.001;

      if (flare.current) flare.current.style.opacity = String(0.55 * overload);

      if (!active) {
        if (b.style.display !== 'none') b.style.display = 'none';
        shown = '';
        return;
      }
      if (b.style.display !== 'flex') b.style.display = 'flex';

      const el = line.current;
      if (!el) return;
      if (!msg) {
        el.style.opacity = '0';
        return;
      }

      const age = (now / 1000 - msg.t0) * secrets.ts; // ?slow stretches the line too
      if (age > 2.0) {
        el.style.opacity = '0';
        return;
      }

      const full = msg.text;
      if (now - lastTick > 55) {
        lastTick = now;
        // glyphs keep scrambling until the line has fully resolved
        const settle = Math.min(1, age / 0.45);
        const solid = Math.floor(full.length * settle);
        let out = '';
        for (let i = 0; i < full.length; i++) {
          const ch = full[i];
          if (ch === ' ' || i < solid) out += ch;
          else out += SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0];
        }
        shown = out;
      }
      el.textContent = shown;
      const off = 2 + Math.random() * 5;
      el.style.textShadow = `${off.toFixed(1)}px 0 rgba(255,24,72,.95), ${(-off).toFixed(
        1
      )}px 0 rgba(0,255,235,.95)`;
      el.style.transform = `translate(${(Math.random() - 0.5) * 7}px, ${
        (Math.random() - 0.5) * 5
      }px)`;
      el.style.opacity = String(0.8 + 0.2 * Math.random());
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={box}
      className="pointer-events-none fixed inset-0 z-[70] items-center justify-center"
      style={{ display: 'none' }}
    >
      <div
        ref={flare}
        className="absolute inset-0"
        style={{
          opacity: 0,
          background: 'radial-gradient(circle at 50% 50%, rgba(255,32,72,0.34), transparent 62%)',
          transition: 'opacity 0.18s linear',
        }}
      />
      <div
        ref={line}
        className="relative px-6 text-center font-mono text-[clamp(1.1rem,4vw,2.6rem)] font-bold uppercase tracking-[0.18em] text-white"
        style={{ opacity: 0, transition: 'opacity 0.12s linear', whiteSpace: 'pre-wrap' }}
      />
    </div>
  );
}
