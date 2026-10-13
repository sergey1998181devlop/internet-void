import { useEffect, useRef, useState } from 'react';

// ARG: the rare glitch of the abyss — the form tears into digital noise for
// 0.5-1s, flashes a broken line and heals itself, too fast to screenshot on
// the first try. Fires on deep idle (20+ minutes) or a <1% roll once a
// minute (QA: window.__glitchIdle.ms, window.__voidGlitch.force()).
export default function useVoidGlitch() {
  const [active, setActive] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let idleTimer = 0;
    let randTimer = 0;
    let hideTimer = 0;

    const fire = (ms) => {
      if (busy.current) return;
      busy.current = true;
      setActive(true);
      hideTimer = setTimeout(() => {
        setActive(false);
        busy.current = false;
      }, ms);
    };

    const mark = () => {
      clearTimeout(idleTimer);
      const ms =
        (typeof window !== 'undefined' && window.__glitchIdle && window.__glitchIdle.ms) ||
        20 * 60 * 1000;
      idleTimer = setTimeout(() => fire(500 + Math.random() * 500), ms);
    };

    mark();
    randTimer = setInterval(() => {
      if (Math.random() < 0.007) fire(500 + Math.random() * 500);
    }, 60000);

    const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));

    if (typeof window !== 'undefined') {
      window.__voidGlitch = { force: (ms) => fire(ms || 800) };
    }

    return () => {
      clearTimeout(idleTimer);
      clearTimeout(hideTimer);
      clearInterval(randTimer);
      evs.forEach((e) => window.removeEventListener(e, mark));
    };
  }, []);

  return active;
}
