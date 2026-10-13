import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';

// ARG phase 1 solved: the payment form is permanently replaced by this
// minimal observer HUD (once per account / browser, see lib/stabilize.js).
export default function StabilizedPanel() {
  const { t } = useTranslation();
  const store = useStore();
  const obs = String(store.observer || 1).padStart(3, '0');

  return (
    <div
      data-stabilized
      className="rounded-2xl border border-cyan-400/40 bg-black/60 p-5 text-center backdrop-blur-md sm:p-6"
      style={{ boxShadow: '0 0 44px rgba(34, 211, 238, 0.14)' }}
    >
      <div
        className="font-mono text-xs font-black uppercase tracking-[0.4em] text-cyan-300"
        style={{ textShadow: '0 0 12px rgba(34, 211, 238, 0.65)' }}
      >
        [ SINGULARITY STABILIZED ]
      </div>

      <div className="mt-3 space-y-1 text-[12px] leading-relaxed text-white/70">
        <div>{t('stab1')}</div>
        <div>{t('stab2')}</div>
        <div>{t('stab3')}</div>
      </div>

      <div className="mx-auto mt-3 h-px w-16 bg-white/20" />

      <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.25em] text-cyan-200/85">
        OBSERVER REGISTERED #{obs}
      </div>
      <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-white/50">
        ARG PHASE 1: COMPLETED
      </div>
    </div>
  );
}
