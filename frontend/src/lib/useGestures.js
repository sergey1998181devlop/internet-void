import { useEffect, useRef } from 'react';
import { fireOverload, fireWhite } from './secrets';
import { triggerGargantua, spawnRipple } from './effects';
import { classifyStroke, turnsAround, GESTURE_DEFAULTS } from './gestureShapes';
import { isControl } from './useClickSecrets';

// Gesture secrets of the void — the input split from the design spec:
//
//   held left button / touch drag   drawing mode, the stroke is recorded
//     shake    (horizontal)         -> singularity overload
//     3 circles around the hole     -> gargantua (disk spins x3)
//     the infinity sign             -> white hole
//   no button (plain hover / stillness)
//     dwell at the centre (0,0) 5s -> quiet micro-reaction: a soft ring on
//                                     the horizon + its vacuum click
//     full AFK 60s                 -> the UI sinks to a whisper (any input
//                                     snaps it straight back)
//   plain clicks are handled by useClickSecrets (10x LMB / 5x RMB)
//
// The stroke only exists while a button is down: pointermove without buttons
// wipes it, so a wandering cursor can never draw a secret by accident.
// Everything is tunable at runtime through `window.__gestures.cfg`.

const TICK = 100; // ms — hover / afk timer resolution

export default function useGestures() {
  const stroke = useRef([]);
  const drawing = useRef(false);
  const lastInput = useRef(Date.now());
  const hover = useRef({ since: -1, x: 0, y: 0, fires: 0, lastFire: -1e9 });
  const afkApplied = useRef(false);
  const pointer = useRef({ x: 0, y: 0 });

  // one live config object: tests bend the timings through the QA hook
  const cfg = useRef({
    hoverMs: 5000,
    hoverR: 0.08, // fraction of min(w, h)
    hoverCool: 12000,
    hoverAmp: 0.55,
    afkMs: 60000,
  });

  useEffect(() => {
    const C = cfg.current;

    // gesture secrets are free and purely local — only the person who drew
    // the stroke ever sees them
    const fire = (result) => {
      let fired = false;
      if (result.kind === 'shake') fired = fireOverload();
      else if (result.kind === 'circle') fired = triggerGargantua();
      else if (result.kind === 'infinity') fired = fireWhite();
      if (typeof window !== 'undefined') {
        window.__gestures = window.__gestures || {};
        window.__gestures.last = { ...result, fired };
      }
      return fired;
    };

    const finish = () => {
      if (!drawing.current) return;
      drawing.current = false;
      const pts = stroke.current;
      stroke.current = [];
      if (pts.length < 6) return;
      const view = {
        cx: window.innerWidth / 2,
        cy: window.innerHeight / 2,
        minDim: Math.min(window.innerWidth, window.innerHeight),
      };
      fire(classifyStroke(pts, C, view));
    };

    const onDown = (e) => {
      lastInput.current = Date.now();
      hover.current.since = -1;
      if (e.button !== 0 || isControl(e.target)) return;
      drawing.current = true;
      stroke.current = [{ x: e.clientX, y: e.clientY, t: Date.now() }];
    };

    const onMove = (e) => {
      lastInput.current = Date.now();
      pointer.current.x = e.clientX;
      pointer.current.y = e.clientY;

      // stroke: only while the left button is actually held
      if (drawing.current) {
        if (e.buttons & 1) {
          stroke.current.push({ x: e.clientX, y: e.clientY, t: Date.now() });
        } else {
          // button let go elsewhere — the spec: reset, do not classify
          drawing.current = false;
          stroke.current = [];
        }
      }

      // hover at the centre (no button): a dwell only starts on real stillness
      const h = hover.current;
      if (e.buttons !== 0) {
        h.since = -1;
      } else {
        const minDim = Math.min(window.innerWidth, window.innerHeight);
        const dx = e.clientX - window.innerWidth / 2;
        const dy = e.clientY - window.innerHeight / 2;
        const inR = Math.hypot(dx, dy) <= C.hoverR * minDim;
        if (!inR) h.since = -1;
        else if (h.since < 0) h.since = Date.now();
        h.x = e.clientX;
        h.y = e.clientY;
      }
    };

    const onUp = (e) => {
      lastInput.current = Date.now();
      if (e.button !== 0 || !drawing.current) return;
      stroke.current.push({ x: e.clientX, y: e.clientY, t: Date.now() });
      finish();
    };

    const onAnyInput = () => {
      lastInput.current = Date.now();
      hover.current.since = -1;
    };

    const onCancel = () => {
      drawing.current = false;
      stroke.current = [];
    };

    // ARG: each lap of a held stroke builds an orange ring around the cursor —
    // one full loop glows, two loops burn brighter, the third one fires
    let glow = null;
    const setGlow = (level) => {
      if (glow) {
        if (level <= 0) {
          glow.className = 'void-ring-glow';
          return;
        }
        glow.style.left = `${pointer.current.x}px`;
        glow.style.top = `${pointer.current.y}px`;
        glow.className = `void-ring-glow l${level}`;
        return;
      }
      if (level <= 0) return;
      glow = document.createElement('div');
      glow.className = 'void-ring-glow';
      glow.style.left = `${pointer.current.x}px`;
      glow.style.top = `${pointer.current.y}px`;
      document.body.appendChild(glow);
    };

    const tick = () => {
      const now = Date.now();
      const h = hover.current;

      // ARG: laps around the stroke's own centre light the ring up live
      const pts = stroke.current;
      if (drawing.current && pts.length >= 6) {
        let sx = 0;
        let sy = 0;
        for (let i = 0; i < pts.length; i++) {
          sx += pts[i].x;
          sy += pts[i].y;
        }
        const turns = turnsAround(pts, sx / pts.length, sy / pts.length);
        const maxTurns = C.circleTurns ?? GESTURE_DEFAULTS.circleTurns;
        setGlow(turns >= maxTurns ? 3 : Math.floor(turns));
      } else {
        setGlow(0);
      }

      // centre dwell -> a quiet ring on the horizon (own cooldown)
      if (
        h.since >= 0 &&
        now - h.since >= C.hoverMs &&
        now - h.lastFire >= C.hoverCool
      ) {
        const cv = document.querySelector('#void-root canvas');
        const rect = cv ? cv.getBoundingClientRect() : null;
        const w = (rect && rect.width) || window.innerWidth;
        const hgt = (rect && rect.height) || window.innerHeight;
        const ox = rect ? rect.left : 0;
        const oy = rect ? rect.top : 0;
        spawnRipple(
          window.innerWidth / 2 - ox,
          window.innerHeight / 2 - oy,
          w,
          hgt,
          C.hoverAmp
        );
        h.lastFire = now;
        h.fires += 1;
      }

      // full stillness -> the UI sinks to a whisper, any input restores it
      const afk = now - lastInput.current >= C.afkMs;
      if (afk !== afkApplied.current) {
        afkApplied.current = afk;
        document.body.classList.toggle('void-afk', afk);
      }
    };

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onAnyInput);
    window.addEventListener('wheel', onAnyInput, { passive: true });
    window.addEventListener('touchstart', onAnyInput, { passive: true });
    window.addEventListener('blur', onCancel);
    const iv = setInterval(tick, TICK);

    if (typeof window !== 'undefined') {
      window.__gestures = {
        cfg: C,
        last: null,
        get drawing() {
          return drawing.current;
        },
        get len() {
          return stroke.current.length;
        },
        hover: () => ({ since: hover.current.since, fires: hover.current.fires }),
        idleMs: () => Date.now() - lastInput.current,
        afk: () => afkApplied.current,
        reset: () => {
          drawing.current = false;
          stroke.current = [];
          hover.current.since = -1;
          lastInput.current = Date.now();
          document.body.classList.remove('void-afk');
          afkApplied.current = false;
        },
      };
    }

    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onAnyInput);
      window.removeEventListener('wheel', onAnyInput);
      window.removeEventListener('touchstart', onAnyInput);
      window.removeEventListener('blur', onCancel);
      clearInterval(iv);
      if (glow) glow.remove();
      document.body.classList.remove('void-afk');
      if (typeof window !== 'undefined') delete window.__gestures;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
