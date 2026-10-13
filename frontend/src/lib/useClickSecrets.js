import { useEffect, useRef } from 'react';
import { fireOverload, fireWhite } from './secrets';

// Spam-clicking the void triggers its two secrets:
//   10 left clicks in 2s -> singularity overload
//    5 right clicks in 2s -> white hole (context menu stays out of the way)
// Clicks on real controls are ignored so nobody trips it by hammering a button.
// The easter eggs are free and purely local: only the person who triggered
// them ever sees them.

const TIME_WINDOW = 2000; // ms — the spam window
const LEFT_N = 10;
const RIGHT_N = 5;

const CONTROL = 'button, a, input, textarea, select, [role="button"], [data-no-secret]';

export const isControl = (el) => !!(el && el.closest && el.closest(CONTROL));

export default function useClickSecrets() {
  const left = useRef([]);
  const right = useRef([]);

  useEffect(() => {
    const onContext = (e) => {
      // text fields keep their native menu (paste etc.), the void does not
      if (!isControl(e.target)) e.preventDefault();
    };

    const onDown = (e) => {
      if (isControl(e.target)) return;
      const now = Date.now();

      if (e.button === 0) {
        const arr = left.current.filter((t) => now - t < TIME_WINDOW);
        arr.push(now);
        left.current = arr;
        if (arr.length >= LEFT_N) {
          left.current = [];
          fireOverload();
        }
      } else if (e.button === 2) {
        const arr = right.current.filter((t) => now - t < TIME_WINDOW);
        arr.push(now);
        right.current = arr;
        if (arr.length >= RIGHT_N) {
          right.current = [];
          fireWhite();
        }
      }
    };

    window.addEventListener('contextmenu', onContext);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('contextmenu', onContext);
      window.removeEventListener('mousedown', onDown);
    };
  }, []);
}
