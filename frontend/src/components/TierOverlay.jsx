import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useStore,
  setState,
  takeTierFx,
  bumpTierFx,
} from '../lib/store';
import {
  TIERS,
  SECRETS,
  fxDuration,
  fxPriority,
  fxScale,
  fxOf,
  tierName,
  secretName,
  tierOf,
  detectSecret,
  parseAmount,
} from '../lib/tiers';
import { audio } from '../audio/AudioEngine';
import { scheduleFragment } from '../lib/fragments';

const fmtAmount = (a) => Number(a || 0).toFixed(2);
const DIVINE_THEMES = ['gold', 'cyber', 'cosmos'];
// donor comment lands when the hero-hold ends and the object starts to be
// sucked into the void (hold 2.0s + suck begins), bursts have no object
const CARD_DELAY = 2100;
let divineTimer = 0;

function triggerShake(px, ms) {
  const el = document.getElementById('void-root');
  if (!el) return;
  el.classList.remove('void-shake');
  void el.offsetWidth;
  const scale = 1 + (2 * (px + 4)) / Math.min(window.innerWidth, window.innerHeight);
  el.style.setProperty('--shk', px + 'px');
  el.style.setProperty('--shk-scale', String(scale));
  el.classList.add('void-shake');
  setTimeout(() => el.classList.remove('void-shake'), ms);
}

function speakFx(fx, lang) {
  const parts = [fx.name, fx.text || ''].filter(Boolean).join('. ');
  audio.speak(parts);
  void lang;
}

function startFx(fx, lang, timers) {
  const a = fx.amount || 0;
  if (fx.kind === 'secret') {
    audio.playSecret(fx.secret);
    if (fx.secret === 'demon') triggerShake(7, 750);
    else if (fx.secret === 'pi') triggerShake(3, 500);
    else if (fx.secret === 'jackpot') triggerShake(4.5, 600);
    else if (fx.secret === 'leet') triggerShake(2.5, 400);
    // ARG puzzle: the phrase fragment rides the fade-out of the effect
    scheduleFragment(fx.secret, fxDuration(fx));
    return;
  }
  switch (fx.tier) {
    case 1:
      audio.playTier1(a);
      triggerShake(1.5, 420);
      break;
    case 2:
      audio.playTier2();
      triggerShake(2.5, 520);
      break;
    case 3:
      audio.playTier3();
      triggerShake(3.5, 640);
      break;
    case 4:
      audio.playFanfare();
      setState({ flash: 1.2 });
      // the comment lands exactly when the object starts getting sucked in
      if (!fx.burst) timers.current.push(setTimeout(() => speakFx(fx, lang), 2100));
      break;
    case 5:
      audio.playMeteors();
      setState({ flash: 1.1 });
      if (!fx.burst) timers.current.push(setTimeout(() => speakFx(fx, lang), 2100));
      timers.current.push(setTimeout(() => triggerShake(6, 900), 650));
      timers.current.push(
        setTimeout(() => window.dispatchEvent(new CustomEvent('void:shatter')), 1300)
      );
      break;
    case 6:
      audio.playBassDrop();
      setState({
        flash: 1.3,
        rocket: { id: fx.id + '-' + Date.now(), ts: Date.now(), amount: fx.amount },
      });
      if (!fx.burst) timers.current.push(setTimeout(() => speakFx(fx, lang), 2100));
      timers.current.push(setTimeout(() => triggerShake(10, 1100), 2100));
      break;
    case 7:
      audio.playDivine();
      setState({ flash: 1.1 });
      if (!fx.burst) timers.current.push(setTimeout(() => speakFx(fx, lang), 2100));
      setState({ sponsor: { name: fx.name, amount: a, ts: Date.now() } });
      divineOn();
      break;
    default:
      break;
  }
}

function divineOn() {
  const el = document.documentElement;
  el.classList.remove(...DIVINE_THEMES.map((t) => 'void-divine-' + t));
  const theme = DIVINE_THEMES[(Math.random() * DIVINE_THEMES.length) | 0];
  el.classList.add('void-divine-' + theme);
  clearTimeout(divineTimer);
  divineTimer = setTimeout(() => el.classList.remove('void-divine-' + theme), 180000);
}

// ---------------------------------------------------------------------------
// canvas particle system: confetti / coin rain / treasure burst / meteors / sparks
// ---------------------------------------------------------------------------
function ParticleBurst({ mode, count = 50, colors = ['#fff'], duration = 3000, origin = [0.5, 0.5] }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let raf = 0;
    let dead = false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pick = () => colors[(Math.random() * colors.length) | 0];
    const parts = [];

    if (mode === 'confetti') {
      for (let i = 0; i < count; i++) {
        parts.push({
          x: Math.random() * W,
          y: -20 - Math.random() * H * 0.35,
          vx: (Math.random() - 0.5) * 90,
          vy: 60 + Math.random() * 140,
          w: 5 + Math.random() * 6,
          h: 8 + Math.random() * 9,
          rot: Math.random() * 6.28,
          vr: (Math.random() - 0.5) * 7,
          c: pick(),
          life: duration,
          t: 0,
          grav: 70,
          flutter: Math.random() * 6.28,
        });
      }
    } else if (mode === 'rain') {
      for (let i = 0; i < count; i++) {
        parts.push({
          x: Math.random() * W,
          y: -20 - Math.random() * H * 1.1,
          vx: (Math.random() - 0.5) * 26,
          vy: 190 + Math.random() * 230,
          r: 4 + Math.random() * 6,
          c: pick(),
          life: duration + 1500,
          t: 0,
          grav: 40,
          coin: true,
        });
      }
    } else if (mode === 'burst') {
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 90 + Math.random() * 430;
        parts.push({
          x: origin[0] * W,
          y: origin[1] * H,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 70,
          w: 4 + Math.random() * 7,
          h: 4 + Math.random() * 7,
          rot: Math.random() * 6.28,
          vr: (Math.random() - 0.5) * 9,
          c: pick(),
          life: 1500 + Math.random() * 1600,
          t: 0,
          grav: 320,
        });
      }
    } else if (mode === 'meteor') {
      for (let i = 0; i < count; i++) {
        const sp = 520 + Math.random() * 430;
        const delay = Math.random() * 1900;
        parts.push({
          x: W * (0.3 + Math.random() * 1.05),
          y: -60 - Math.random() * H * 0.6,
          vx: -sp * 0.62,
          vy: sp * 0.55,
          c: pick(),
          life: delay + 2400,
          t: 0,
          delay,
          streak: true,
        });
      }
    } else {
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 270;
        parts.push({
          x: origin[0] * W,
          y: origin[1] * H,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          r: 1.5 + Math.random() * 2.6,
          c: pick(),
          life: 700 + Math.random() * 600,
          t: 0,
          grav: 150,
        });
      }
    }

    const t0 = performance.now();
    let last = t0;
    const tick = (now) => {
      if (dead) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, W, H);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += dt * 1000;
        if (p.delay && p.t < p.delay) continue;
        p.vy += (p.grav || 0) * dt;
        if (p.flutter != null) p.vx += Math.sin(p.flutter + p.t / 240) * 45 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot = (p.rot || 0) + (p.vr || 0) * dt;
        const alpha = Math.max(0, 1 - p.t / p.life);
        if (alpha <= 0 || p.y > H + 70 || p.x < -90 || p.x > W + 90) {
          parts.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = alpha;
        if (p.streak) {
          const sp = Math.hypot(p.vx, p.vy) || 1;
          const len = sp * 0.085;
          const nx = p.vx / sp;
          const ny = p.vy / sp;
          ctx.strokeStyle = p.c;
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - nx * len, p.y - ny * len);
          ctx.stroke();
          ctx.fillStyle = p.c;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.6, 0, 6.28);
          ctx.fill();
        } else if (p.coin || p.r) {
          ctx.fillStyle = p.c;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, 6.28);
          ctx.fill();
        } else {
          ctx.fillStyle = p.c;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
      if (parts.length && now - t0 < duration + 3000) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
    };
  }, [mode, count, duration, origin]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0" />;
}

// ---------------------------------------------------------------------------
// shared donor card
// ---------------------------------------------------------------------------
function FxCard({ fx, dur, color, label, delay = 0 }) {
  return (
    <div
      className="fx-card absolute left-1/2 top-1/2 z-[46] w-[min(86vw,440px)]"
      style={{ '--cdur': Math.max(600, dur - delay) + 'ms', animationDelay: delay ? delay + 'ms' : undefined }}
    >
      <div
        className="relative overflow-hidden rounded-3xl border-2 bg-black/85 shadow-[0_0_50px_rgba(0,0,0,.7)]"
        style={{ borderColor: color + 'aa' }}
      >
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(130% 90% at 50% -10%, ${color}38, transparent 62%)` }}
        />
        <div className="relative rounded-[1.35rem] bg-black/80 px-6 py-5 text-center backdrop-blur-md">
          <div className="text-[10px] font-black uppercase tracking-[0.35em]" style={{ color }}>
            {label}
          </div>
          <div className="mt-1.5 truncate text-3xl font-black text-white">{fx.name}</div>
          {fx.text ? (
            <div className="mt-1 line-clamp-2 text-sm text-white/70">{fx.text}</div>
          ) : null}
          <div className="mt-2 font-mono text-lg font-bold" style={{ color }}>
            +${fmtAmount(fx.amount)}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="fx-shine absolute -inset-y-4 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// tier effects
// ---------------------------------------------------------------------------
function MicroImpulse({ fx, dur, lang }) {
  const scale = fxScale(fx.amount);
  const n = Math.round(7 + scale * 5);
  const sparks = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const ang = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const d = 70 + Math.random() * 130 * scale;
        return {
          dx: Math.cos(ang) * d,
          dy: Math.sin(ang) * d,
          delay: Math.random() * 0.3,
          size: 5 + Math.random() * 8,
          color: i % 3 ? '#fde68a' : '#ffffff',
        };
      }),
    [n, scale]
  );

  return (
    <div className="fx-life pointer-events-none absolute inset-0" style={{ '--dur': dur + 'ms' }}>
      <div className="fx-coin-rise absolute left-1/2 top-1/2 text-5xl">🪙</div>
      {sparks.map((s, i) => (
        <span
          key={i}
          className="fx-spark absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: s.size,
            height: s.size,
            background: s.color,
            boxShadow: `0 0 8px ${s.color}`,
            '--dx': s.dx + 'px',
            '--dy': s.dy + 'px',
            animationDelay: s.delay + 's',
          }}
        />
      ))}
      <ParticleBurst
        mode="sparks"
        count={Math.round(10 + 7 * scale)}
        colors={['#fde68a', '#fbbf24', '#ffffff']}
        duration={900}
      />
      <div
        className="fx-float-up absolute left-1/2 top-[62%] whitespace-nowrap rounded-full border border-amber-300/40 bg-black/70 px-4 py-1.5 text-sm font-bold text-amber-100 backdrop-blur"
        style={{ animationDelay: CARD_DELAY + 'ms' }}
      >
        {fx.name} <span className="text-amber-300">+${fmtAmount(fx.amount)}</span>
      </div>
      <div className="absolute left-1/2 top-[46%] -translate-x-1/2 text-[9px] font-black uppercase tracking-[0.3em] text-white/45">
        {tierName(1, lang)}
      </div>
    </div>
  );
}

function EnergyCharge({ fx, dur, lang }) {
  const scale = fxScale(fx.amount);
  return (
    <div className="fx-life pointer-events-none absolute inset-0" style={{ '--dur': dur + 'ms' }}>
      <ParticleBurst
        mode="confetti"
        count={Math.round(34 + 26 * scale)}
        colors={['#7dd3fc', '#a5f3fc', '#fde68a', '#f9a8d4', '#c4b5fd', '#ffffff']}
        duration={3400}
      />
      <FxCard fx={fx} dur={dur} color={TIERS[2].color} label={tierName(2, lang)} delay={CARD_DELAY} />
    </div>
  );
}

function GammaRay({ fx, dur, lang }) {
  const scale = fxScale(fx.amount);
  const color = TIERS[3].color;
  const edges = [
    'left-0 right-0 top-0 h-[3px]',
    'left-0 right-0 bottom-0 h-[3px]',
    'top-0 bottom-0 left-0 w-[3px]',
    'top-0 bottom-0 right-0 w-[3px]',
  ];
  return (
    <div className="fx-life pointer-events-none absolute inset-0" style={{ '--dur': dur + 'ms' }}>
      {edges.map((cls, i) => (
        <div
          key={i}
          className={`fx-edge absolute ${cls}`}
          style={{
            background: `linear-gradient(${i < 2 ? '90deg' : '180deg'}, transparent, ${color}, transparent)`,
            boxShadow: `0 0 14px ${color}`,
            animationDelay: `${i * 0.22}s`,
          }}
        />
      ))}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          className="fx-bolt"
          points="18,0 23,14 16,18 26,34 20,38 30,56"
          fill="none"
          stroke="#c4b5fd"
          strokeWidth="0.6"
          style={{ animationDelay: '0.5s' }}
        />
        <polyline
          className="fx-bolt"
          points="82,0 77,16 84,20 74,38 80,42 70,62"
          fill="none"
          stroke="#a5b4fc"
          strokeWidth="0.6"
          style={{ animationDelay: '1.3s' }}
        />
        <polyline
          className="fx-bolt"
          points="50,100 54,84 47,80 57,62 51,58 58,40"
          fill="none"
          stroke="#e9d5ff"
          strokeWidth="0.6"
          style={{ animationDelay: '2.1s' }}
        />
      </svg>
      <ParticleBurst
        mode="sparks"
        count={Math.round(16 + 11 * scale)}
        colors={['#c4b5fd', '#a5f3fc', '#ffffff']}
        duration={2600}
      />
      <FxCard fx={fx} dur={dur} color={color} label={tierName(3, lang)} delay={CARD_DELAY} />
    </div>
  );
}

function Showtime({ fx, dur, lang }) {
  const scale = fxScale(fx.amount);
  const burstLabel =
    fx.burst === 'piggy'
      ? '🐷 PIGGY BANK!'
      : fx.burst === 'combo'
        ? `⚡ COMBO ×${fx.count || 2}`
        : tierName(4, lang);
  return (
    <div className="fx-life pointer-events-none absolute inset-0" style={{ '--dur': dur + 'ms' }}>
      <div className="fx-dim absolute inset-0 bg-black/45" />
      <div className="fx-portal absolute left-1/2 top-1/2 h-[min(62vw,430px)] w-[min(62vw,430px)]">
        <div
          className="fx-ring absolute left-1/2 top-1/2 h-full w-full rounded-full border-[3px] border-dashed border-amber-300/70"
          style={{ boxShadow: '0 0 30px rgba(251,191,36,.55), inset 0 0 30px rgba(251,191,36,.3)' }}
        />
        <div
          className="fx-ring-rev absolute left-1/2 top-1/2 h-[76%] w-[76%] rounded-full border-2 border-fuchsia-400/60"
          style={{ boxShadow: '0 0 24px rgba(232,121,249,.5)' }}
        />
        <div
          className="fx-core absolute left-1/2 top-1/2 h-[46%] w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(255,240,180,.95), rgba(251,191,36,.45) 55%, transparent 75%)',
          }}
        />
      </div>
      <ParticleBurst
        mode="burst"
        count={Math.round(58 + 42 * scale)}
        colors={['#fde047', '#fbbf24', '#fff7ed', '#fdba74']}
        duration={3600}
      />
      <FxCard fx={fx} dur={dur} color={TIERS[4].color} label={burstLabel} delay={fx.burst ? 400 : CARD_DELAY} />
    </div>
  );
}

function MeteorStorm({ fx, dur, lang }) {
  const scale = fxScale(fx.amount);
  return (
    <div className="fx-life pointer-events-none absolute inset-0" style={{ '--dur': dur + 'ms' }}>
      <ParticleBurst
        mode="meteor"
        count={Math.round(9 + 7 * scale)}
        colors={['#fda4af', '#f43f5e', '#fbbf24', '#fff1f2']}
        duration={4800}
      />
      <ParticleBurst
        mode="confetti"
        count={Math.round(26 + 20 * scale)}
        colors={['#fb7185', '#fda4af', '#fecdd3', '#fbbf24']}
        duration={5400}
      />
      <FxCard fx={fx} dur={dur} color={TIERS[5].color} label={tierName(5, lang)} delay={CARD_DELAY} />
    </div>
  );
}

function BossAttack({ fx, dur, lang }) {
  return (
    <div className="fx-life pointer-events-none absolute inset-0" style={{ '--dur': dur + 'ms' }}>
      {/* the 3D rocket does the flying (scene/Rocket.jsx) — this is the impact plate */}
      <div
        className="fx-impact absolute left-1/2 top-1/2 z-[46] w-[min(86vw,430px)]"
        style={{ '--idelay': CARD_DELAY + 'ms', '--idur': Math.max(2600, dur - CARD_DELAY) + 'ms' }}
      >
        <div
          className="rounded-2xl border-2 border-orange-400/70 bg-black/85 px-6 py-5 text-center"
          style={{ boxShadow: '0 0 46px rgba(249,115,22,.55)' }}
        >
          <div className="text-[10px] font-black uppercase tracking-[0.35em] text-orange-300">
            {tierName(6, lang)}
          </div>
          <div className="mt-1.5 truncate text-3xl font-black text-white">{fx.name}</div>
          {fx.text ? (
            <div className="mt-1 line-clamp-2 text-sm text-white/70">{fx.text}</div>
          ) : null}
          <div className="mt-2 font-mono text-lg font-bold text-orange-300">
            +${fmtAmount(fx.amount)}
          </div>
        </div>
      </div>
    </div>
  );
}

function Divine({ fx, dur, lang }) {
  const scale = fxScale(fx.amount);
  return (
    <div className="fx-life pointer-events-none absolute inset-0" style={{ '--dur': dur + 'ms' }}>
      <div
        className="fx-rays absolute left-1/2 top-1/2 h-[150vmax] w-[150vmax] opacity-40"
        style={{
          background:
            'conic-gradient(from 0deg, transparent 0 14deg, rgba(253,224,71,.5) 18deg 22deg, transparent 26deg 40deg, rgba(253,224,71,.35) 44deg 48deg, transparent 52deg 70deg, rgba(253,224,71,.5) 74deg 78deg, transparent 82deg 100deg, rgba(253,224,71,.4) 104deg 108deg, transparent 112deg 140deg, rgba(253,224,71,.5) 144deg 148deg, transparent 152deg 180deg, rgba(253,224,71,.45) 184deg 188deg, transparent 192deg 220deg, rgba(253,224,71,.5) 224deg 228deg, transparent 232deg 260deg, rgba(253,224,71,.4) 264deg 268deg, transparent 272deg 300deg, rgba(253,224,71,.5) 304deg 308deg, transparent 312deg 360deg)',
        }}
      />
      <ParticleBurst
        mode="burst"
        count={Math.round(70 + 45 * scale)}
        colors={['#fde047', '#fbbf24', '#fffbeb', '#fdba74']}
        duration={5200}
      />
      <ParticleBurst
        mode="confetti"
        count={Math.round(30 + 16 * scale)}
        colors={['#fde047', '#fbbf24', '#ffffff']}
        duration={6400}
      />
      <div
        className="fx-divine absolute left-1/2 top-1/2 z-[46] w-[min(90vw,580px)] text-center"
        style={{ '--cdur': dur + 'ms', animationDelay: CARD_DELAY + 'ms' }}
      >
        <div className="text-sm font-black uppercase tracking-[0.5em] text-amber-200 drop-shadow-[0_0_18px_rgba(253,224,71,.9)]">
          {tierName(7, lang)}
        </div>
        <div className="mt-2 break-words text-5xl font-black text-white drop-shadow-[0_0_30px_rgba(253,224,71,.85)] sm:text-7xl">
          {fx.name}
        </div>
        <div className="mt-2 font-mono text-2xl font-bold text-amber-200">
          +${fmtAmount(fx.amount)}
        </div>
        {fx.text ? <div className="mt-2 text-sm text-white/75">{fx.text}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// secret effects
// ---------------------------------------------------------------------------
function PiGlitch({ fx, dur, lang }) {
  const blobs = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => {
        const ang = (i / 10) * Math.PI * 2 + Math.random() * 0.6;
        const d = 60 + Math.random() * 160;
        return {
          dx: Math.cos(ang) * d,
          dy: Math.sin(ang) * d,
          s: 34 + Math.random() * 62,
          c: i % 3 === 0 ? '#8b5a2b' : i % 3 === 1 ? '#fde68a' : '#fef3c7',
        };
      }),
    []
  );
  return (
    <div className="fx-life pointer-events-none absolute inset-0" style={{ '--dur': dur + 'ms' }}>
      <ParticleBurst
        mode="sparks"
        count={22}
        colors={['#f9a8d4', '#fbcfe8', '#ffffff']}
        duration={2800}
      />
      <div className="fx-pie absolute left-1/2 top-1/2 text-[15vmin] leading-none">🥧</div>
      {blobs.map((b, i) => (
        <span
          key={i}
          className="fx-splat-blob absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: b.s,
            height: b.s,
            background: b.c,
            animationDelay: '1.5s',
            '--dx': b.dx + 'px',
            '--dy': b.dy + 'px',
          }}
        />
      ))}
      <FxCard
        fx={fx}
        dur={dur}
        color={SECRETS.pi.color}
        label={`${secretName('pi', lang)} · π = 3.14`}
        delay={1750}
      />
    </div>
  );
}

function DemonGate({ fx, dur, lang }) {
  return (
    <div className="fx-life pointer-events-none absolute inset-0" style={{ '--dur': dur + 'ms' }}>
      <div
        className="fx-demon absolute inset-0"
        style={{
          background:
            'radial-gradient(85% 65% at 50% 45%, rgba(153,27,27,.62), rgba(0,0,0,.8))',
        }}
      />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          className="fx-bolt"
          points="14,0 21,15 13,19 25,36 18,40 30,58"
          fill="none"
          stroke="#fca5a5"
          strokeWidth="0.7"
          style={{ animationDelay: '0.3s' }}
        />
        <polyline
          className="fx-bolt"
          points="86,0 79,17 87,21 75,40 82,44 69,64"
          fill="none"
          stroke="#fee2e2"
          strokeWidth="0.7"
          style={{ animationDelay: '1.1s' }}
        />
        <polyline
          className="fx-bolt"
          points="52,100 57,84 49,80 60,60 53,56 61,36"
          fill="none"
          stroke="#f87171"
          strokeWidth="0.7"
          style={{ animationDelay: '1.9s' }}
        />
      </svg>
      <ParticleBurst
        mode="sparks"
        count={26}
        colors={['#ef4444', '#fca5a5', '#f87171']}
        duration={3200}
      />
      <div className="absolute left-1/2 top-1/2 z-[46] -translate-x-1/2 -translate-y-1/2 text-center">
        <div className="fx-flicker text-[15vmin] leading-none">😈</div>
        <div
          className="fx-flicker font-mono text-6xl font-black text-red-400 drop-shadow-[0_0_24px_rgba(239,68,68,.95)]"
          style={{ animationDelay: '0.35s' }}
        >
          6.66
        </div>
        <div className="mt-2 text-sm font-black uppercase tracking-[0.4em] text-red-300">
          {secretName('demon', lang)}
        </div>
        <div className="mt-1 text-white/85">
          {fx.name} <span className="text-red-300">+${fmtAmount(fx.amount)}</span>
        </div>
        {fx.text ? (
          <div className="mx-auto mt-1 max-w-[320px] text-xs text-white/60">{fx.text}</div>
        ) : null}
      </div>
    </div>
  );
}

function Jackpot({ fx, dur, lang }) {
  return (
    <div className="fx-life pointer-events-none absolute inset-0" style={{ '--dur': dur + 'ms' }}>
      <div
        className="fx-card absolute left-1/2 top-1/2 z-[46] w-[min(88vw,460px)]"
        style={{ '--cdur': dur + 'ms' }}
      >
        <div className="rounded-3xl border-2 border-amber-300/80 bg-gradient-to-b from-yellow-500/25 to-black/85 p-5 text-center shadow-[0_0_60px_rgba(251,191,36,.5)] backdrop-blur-md">
          <div className="text-[10px] font-black uppercase tracking-[0.4em] text-amber-200">
            {secretName('jackpot', lang)} · 7.77
          </div>
          <div className="mt-3 flex justify-center gap-2">
            {[1.35, 1.75, 2.15].map((rd, i) => (
              <div
                key={i}
                className="h-16 w-14 overflow-hidden rounded-lg border border-amber-400/60 bg-black/80 shadow-[inset_0_0_12px_rgba(251,191,36,.35)]"
              >
                <div className="fx-reel" style={{ '--rdur': rd + 's' }}>
                  {['🍋', '🔔', '🍒', '⭐', '🍋', '🔔', '7️⃣'].map((s, j) => (
                    <div key={j} className="flex h-16 items-center justify-center text-3xl">
                      {s}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 font-mono text-3xl font-black text-amber-300 drop-shadow-[0_0_18px_rgba(251,191,36,.9)]">
            +${fmtAmount(fx.amount)}
          </div>
          <div className="mt-1 truncate text-xl font-black text-white">{fx.name}</div>
          {fx.text ? <div className="mt-1 truncate text-xs text-white/65">{fx.text}</div> : null}
        </div>
      </div>
      <div
        className="fx-jackpot absolute left-1/2 top-1/2 z-[47] whitespace-nowrap text-center text-[12vmin] font-black uppercase tracking-wider text-yellow-300"
        style={{ textShadow: '0 0 30px rgba(253,224,71,.95), 4px 4px 0 #b45309' }}
      >
        JACKPOT!
      </div>
      <ParticleBurst
        mode="rain"
        count={70}
        colors={['#fbbf24', '#fde047', '#fff7ed']}
        duration={4400}
      />
    </div>
  );
}

function LeetGlitch({ fx, dur, lang }) {
  return (
    <div className="fx-life pointer-events-none absolute inset-0" style={{ '--dur': dur + 'ms' }}>
      <div className="absolute inset-0 bg-[#020617]/85" />
      <div className="fx-scanlines absolute inset-0 opacity-70" />
      <ParticleBurst
        mode="sparks"
        count={22}
        colors={['#22d3ee', '#67e8f9', '#a5f3fc']}
        duration={3000}
      />
      <div className="absolute left-1/2 top-1/2 z-[46] -translate-x-1/2 -translate-y-1/2 text-center">
        <div className="relative inline-block">
          <div
            className="fx-pixel-pop font-mono text-[15vmin] font-black leading-none tracking-tighter text-cyan-300"
            style={{ textShadow: '0 0 26px #22d3ee, 5px 5px 0 #0e7490' }}
          >
            13.37
          </div>
          <div className="absolute left-1/2 top-[36%] -translate-x-1/2">
            <div className="fx-shades flex gap-1">
              <span className="block h-[3.6vmin] w-[6.5vmin] rounded-[2px] bg-black" />
              <span className="block h-[1.4vmin] w-[2.6vmin] self-center bg-black" />
              <span className="block h-[3.6vmin] w-[6.5vmin] rounded-[2px] bg-black" />
            </div>
          </div>
        </div>
        <div className="mt-3 font-mono text-lg font-black uppercase tracking-[0.4em] text-cyan-400">
          DEAL WITH IT
        </div>
        <div className="mt-1 font-mono text-sm text-white/70">
          {fx.name} +${fmtAmount(fx.amount)}
        </div>
        <div className="mt-1 text-[10px] font-black uppercase tracking-[0.3em] text-cyan-500/70">
          {secretName('leet', lang)}
        </div>
      </div>
    </div>
  );
}

function ChillVibe({ fx, dur, lang }) {
  return (
    <div className="fx-life pointer-events-none absolute inset-0" style={{ '--dur': dur + 'ms' }}>
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(30,27,75,.75), rgba(49,46,129,.5) 45%, rgba(15,23,42,.8))',
        }}
      />
      <div
        className="fx-wave absolute left-0 top-[26%] h-[26vh] w-full"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(168,85,247,.5), rgba(192,132,252,.75), rgba(168,85,247,.4), transparent)',
          filter: 'blur(34px)',
          animationDuration: '6.5s',
        }}
      />
      <div
        className="fx-wave absolute left-0 top-[56%] h-[20vh] w-full opacity-70"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(129,140,248,.5), rgba(216,180,254,.6), transparent)',
          filter: 'blur(38px)',
          animationDelay: '1.4s',
          animationDuration: '8s',
        }}
      />
      <div className="fx-drift absolute left-[10%] top-[18%] h-[26vmin] w-[26vmin] rounded-full bg-purple-500/35 blur-3xl" />
      <div
        className="fx-drift absolute bottom-[16%] right-[8%] h-[32vmin] w-[32vmin] rounded-full bg-fuchsia-500/30 blur-3xl"
        style={{ animationDelay: '3s' }}
      />
      <div
        className="fx-breathe absolute left-1/2 top-1/2 text-[22vmin] font-black leading-none text-purple-200/50"
        style={{ textShadow: '0 0 60px rgba(192,132,252,.8)' }}
      >
        42
      </div>
      <ParticleBurst
        mode="sparks"
        count={16}
        colors={['#c084fc', '#e9d5ff']}
        duration={4200}
        origin={[0.5, 0.55]}
      />
      <FxCard
        fx={fx}
        dur={dur}
        color={SECRETS.chill.color}
        label={`${secretName('chill', lang)} · 42`}
        delay={1700}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// orchestrator
// ---------------------------------------------------------------------------
function renderFx(fx, dur, lang) {
  const props = { fx, dur, lang };
  if (fx.kind === 'secret') {
    switch (fx.secret) {
      case 'pi':
        return <PiGlitch {...props} />;
      case 'demon':
        return <DemonGate {...props} />;
      case 'jackpot':
        return <Jackpot {...props} />;
      case 'leet':
        return <LeetGlitch {...props} />;
      case 'chill':
        return <ChillVibe {...props} />;
      default:
        return null;
    }
  }
  switch (fx.tier) {
    case 1:
      return <MicroImpulse {...props} />;
    case 2:
      return <EnergyCharge {...props} />;
    case 3:
      return <GammaRay {...props} />;
    case 4:
      return <Showtime {...props} />;
    case 5:
      return <MeteorStorm {...props} />;
    case 6:
      return <BossAttack {...props} />;
    case 7:
      return <Divine {...props} />;
    default:
      return null;
  }
}

export default function TierOverlay() {
  const store = useStore();
  const { i18n } = useTranslation();
  const [active, setActive] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [pinnedFade, setPinnedFade] = useState(false);
  const timers = useRef([]);

  // take the next queued fx whenever the current one ends or a higher
  // priority celebration arrives
  useEffect(() => {
    const next = takeTierFx(active ? fxPriority(active) : -1);
    if (next) setActive(next);
  }, [store.tierFx, active]);

  // ARG priority 1: a big bang interrupts whatever plays right now
  useEffect(() => {
    if (store.bangStamp) setActive(null);
  }, [store.bangStamp]);

  // run the active fx: sounds, TTS, flash, shakes, global theme
  useEffect(() => {
    if (!active) return undefined;
    const dur = fxDuration(active);
    startFx(active, i18n.language, timers);
    const end = setTimeout(() => setActive(null), dur + 200);
    return () => {
      clearTimeout(end);
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // golden pinned banner for tier 5 (45s)
  useEffect(() => {
    if (!active || active.kind !== 'tier' || active.tier !== 5 || active.burst) return;
    setPinnedFade(false);
    setPinned({ id: active.id, name: active.name, amount: active.amount });
  }, [active]);

  useEffect(() => {
    if (!pinned) return undefined;
    const fade = setTimeout(() => setPinnedFade(true), 43500);
    const drop = setTimeout(() => {
      setPinned(null);
      setPinnedFade(false);
    }, 45500);
    return () => {
      clearTimeout(fade);
      clearTimeout(drop);
    };
  }, [pinned]);

  // QA hooks (ENABLE_TEST_HOOKS builds)
  useEffect(() => {
    window.__fireTier = (amount, opts = {}) => {
      const a = parseAmount(amount);
      const ev = {
        id: 'hook-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        amount: a,
        tier: opts.tier ?? tierOf(a),
        secret: opts.secret !== undefined ? opts.secret : detectSecret(a),
        name: opts.name || 'Hook',
        text: opts.text || '',
        ts: Date.now(),
      };
      const fx = fxOf(ev);
      if (fx) setState({ tierFx: bumpTierFx(fx) });
      return fx;
    };
    window.__fireBurst = (kind) => {
      setState({
        tierFx: bumpTierFx({
          id: kind + '-' + Date.now(),
          kind: 'tier',
          tier: 4,
          burst: kind,
          amount: kind === 'piggy' ? 10 : 10,
          count: 3,
          name: 'Tester',
          text: '',
          ts: Date.now(),
        }),
      });
    };
    return () => {
      delete window.__fireTier;
      delete window.__fireBurst;
    };
  }, []);

  const lang = i18n.language;

  return (
    <div className="pointer-events-none absolute inset-0 z-[45] select-none text-white">
      {active ? renderFx(active, fxDuration(active), lang) : null}

      {/* stacked top-right: divine sponsor badge + pinned meteor banner */}
      <div className="absolute right-4 top-16 z-[46] flex w-[min(72vw,340px)] flex-col items-end gap-2 sm:top-20">
        {store.sponsor ? (
          <div className="fx-badge w-full rounded-xl border border-amber-300/50 bg-gradient-to-r from-amber-500/25 to-yellow-300/15 px-3 py-2 text-right shadow-[0_0_24px_rgba(255,200,60,0.35)] backdrop-blur-md">
            <div className="text-[9px] font-black uppercase tracking-[0.3em] text-amber-200">
              ★ {tierName(7, lang)}
            </div>
            <div className="truncate text-sm font-black text-amber-100">
              {store.sponsor.name}
            </div>
            <div className="font-mono text-[11px] text-amber-300/80">
              ${fmtAmount(store.sponsor.amount)}
            </div>
          </div>
        ) : null}
        {pinned ? (
          <div
            className={`fx-pin w-full rounded-xl border border-amber-400/60 bg-gradient-to-r from-amber-600/30 to-yellow-400/15 px-3 py-2 text-right shadow-[0_0_26px_rgba(251,191,36,0.4)] backdrop-blur-md transition-opacity duration-700 ${
              pinnedFade ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <div className="text-[9px] font-black uppercase tracking-[0.3em] text-amber-200">
              ☄ {tierName(5, lang)}
            </div>
            <div className="truncate text-sm font-black text-white">{pinned.name}</div>
            <div className="font-mono text-[11px] text-amber-300/90">
              +${fmtAmount(pinned.amount)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
