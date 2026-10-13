import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';

// side plates: recent sacrifices fly in on the right, live ~5s
const LIFE = 5200;
const MAX_PLATES = 3;

const fmt = (a) => {
  const n = Number(a || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

export default function FeedTicker() {
  const store = useStore();
  const { t } = useTranslation();
  const [plates, setPlates] = useState([]);
  const seen = useRef(new Set());
  const first = useRef(true);
  const timers = useRef(new Map());

  useEffect(() => {
    const events = store.events || [];
    if (first.current) {
      first.current = false;
      events.forEach((e) => e.id && seen.current.add(e.id));
      return;
    }
    const fresh = events.filter((e) => e.id && !seen.current.has(e.id));
    if (!fresh.length) return;
    fresh.forEach((e) => {
      seen.current.add(e.id);
      if (seen.current.size > 600) {
        const drop = seen.current.values().next().value;
        seen.current.delete(drop);
      }
    });

    const take = fresh.slice(-2); // never flood: newest 1-2 per burst
    setPlates((prev) => {
      const next = [...prev, ...take].slice(-MAX_PLATES);
      return next;
    });
    take.forEach((e) => {
      const id = String(e.id);
      const timer = setTimeout(() => {
        timers.current.delete(id);
        setPlates((prev) => prev.filter((p) => String(p.id) !== id));
      }, LIFE);
      timers.current.set(id, timer);
    });
  }, [store.events]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach(clearTimeout);
      map.clear();
    };
  }, []);

  if (!plates.length) return null;

  return (
    <div className="pointer-events-none absolute right-3 top-[38%] z-[44] flex w-[min(66vw,280px)] flex-col items-end gap-2 sm:right-4">
      {plates.map((e, i) => (
        <div
          key={String(e.id)}
          className="feed-plate w-full rounded-xl border border-white/15 bg-black/70 px-3 py-2 text-right shadow-[0_8px_30px_rgba(0,0,0,0.6)] backdrop-blur-md"
          style={{ animationDelay: i * 60 + 'ms' }}
        >
          <div className="truncate text-xs leading-snug text-white/85">
            <span className="font-black text-amber-300">{e.name || '?'}</span>
            <span className="text-white/60"> — {e.text || '🖼'}</span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] font-bold text-amber-200/90">
            {t('feedFor')} ${fmt(e.amount)}
          </div>
        </div>
      ))}
    </div>
  );
}
