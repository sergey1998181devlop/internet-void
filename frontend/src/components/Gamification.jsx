import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';

const COMBO_CAP = 10;
const COMBO_WINDOW_MS = 30000;

export default function Gamification() {
  const { t } = useTranslation();
  const store = useStore();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const comboAlive = Boolean(store.combo.ts) && now - store.combo.ts < COMBO_WINDOW_MS;
  const sum = comboAlive ? store.combo.sum : 0;
  const count = comboAlive ? store.combo.count : 0;
  const piggy = Math.max(0, Number(store.piggy) || 0);
  const target = Math.max(1, Number(store.piggyTarget) || 20);
  const level = Math.max(1, Number(store.piggyLevel) || 1);
  const p = Math.min(1, piggy / target);
  const c = Math.min(1, sum / COMBO_CAP);
  const targetLabel = Number.isInteger(target) ? String(target) : target.toFixed(2);

  return (
    <div className="mt-3 space-y-2">
      {/* piggy bank flask */}
      <div className="flex items-center gap-2" title={t('piggy')}>
        <div className="relative h-5 w-9 shrink-0 overflow-hidden rounded-lg border border-rose-300/40 bg-black/50">
          <div
            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-rose-500 to-amber-400 transition-all duration-500"
            style={{ height: `${p * 100}%` }}
          />
          <span className="absolute inset-0 flex items-center justify-center text-[11px]">
            🐷
          </span>
        </div>
        <span className="text-[9px] uppercase tracking-widest text-white/45">
          {t('piggy')}{' '}
          <span className="font-mono text-rose-200/80">${piggy.toFixed(2)}</span>
          <span className="text-white/30">/{targetLabel}</span>
          {level > 1 && (
            <span className="ml-1 font-mono text-amber-300/80">
              {t('lvl')} {level}
            </span>
          )}
        </span>
      </div>

      {/* combo window */}
      {count > 0 && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-fuchsia-300">
            {t('combo')} ×{count}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-amber-400 to-amber-200 transition-all duration-300"
              style={{ width: `${c * 100}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[9px] text-fuchsia-200/80">
            ${sum.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
}
