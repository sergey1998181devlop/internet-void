import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, getClientId, setState, MASS_PER_DOLLAR } from '../lib/store';
import { fetchMyEvents } from '../lib/socket';
import { useMe, logout, signInGoogle } from '../auth';
import WalletSection from './WalletSection';

const PAGE_SIZE = 10;

export default function Cabinet({ open, onClose, onShare }) {
  const { t } = useTranslation();
  const store = useStore();
  const { user } = useMe();
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (open) setPage(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);

    const load = async () => {
      let data = null;
      if (user) {
        try {
          const res = await fetch('/api/account/events', { credentials: 'same-origin' });
          if (res.ok) data = await res.json();
        } catch { /* ignore */ }
      }
      if (!data) data = await fetchMyEvents(getClientId());
      if (alive && data) setState({ myEvents: data.events || [] });
      if (alive) setLoading(false);
    };
    load();
    return () => { alive = false; };
  }, [open, user?.userId]);

  if (!open) return null;

  const total = store.myEvents.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const rank =
    store.leaderboard.findIndex(
      (r) => r.mass <= total * MASS_PER_DOLLAR && total > 0
    ) + 1;
  // the board only ships its top 100: outside of it the place is a floor
  const rankLabel = rank > 0 ? '#' + rank : total > 0 ? '#100+' : '—';

  const pageCount = Math.max(1, Math.ceil(store.myEvents.length / PAGE_SIZE));
  const cur = Math.min(page, pageCount - 1);
  const rows = store.myEvents.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE);

  const replay = (ev) => {
    setState({
      queue: [
        ...store.queue,
        {
          ...ev,
          id: (ev.id || 'ev') + '-r' + Date.now().toString(36),
          ts: Date.now(),
          amount: Number(ev.amount) || 1,
          name: ev.name || (user && user.name) || 'You',
        },
      ],
    });
    onClose();
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/12 bg-[#07060a] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black uppercase tracking-[0.25em] text-white">
              {t('cabinet')}
            </h2>
            <p className="mt-1 text-xs uppercase tracking-widest text-white/40">
              {t('yourContribution')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 hover:border-white/40 hover:text-white"
          >
            {t('close')}
          </button>
        </div>

        {user ? (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt=""
                  className="h-9 w-9 rounded-full border border-white/20 object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/25 text-sm font-black text-emerald-200">
                  {(user.name || '?').slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-white">{user.name}</div>
                <div className="truncate text-[11px] text-white/45">
                  {user.email || (user.provider === 'ethereum' ? '0x…' : '')}
                </div>
              </div>
            </div>
            <button
              onClick={() => logout()}
              className="shrink-0 cursor-pointer rounded-full border border-white/15 px-3 py-1.5 text-[10px] uppercase tracking-widest text-white/60 transition hover:border-white/40 hover:text-white"
            >
              {t('signOut')}
            </button>
          </div>
        ) : (
          <div className="mt-5 flex flex-col items-stretch gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs leading-relaxed text-white/55">{t('guestNote')}</div>
            <button
              onClick={() => signInGoogle()}
              className="w-full cursor-pointer rounded-xl bg-white px-3 py-3 text-xs font-black text-black transition hover:bg-white/90 sm:w-auto sm:shrink-0 sm:py-2"
            >
              {t('googleBtn')}
            </button>
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4">
            <div className="text-[10px] uppercase tracking-widest text-amber-200/60">
              {t('yourContribution')}
            </div>
            <div className="mt-1 text-3xl font-black text-amber-300">
              {total.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-[10px] uppercase tracking-widest text-white/40">
              {t('leaderboard')}
            </div>
            <div className="mt-1 text-3xl font-black text-white">
              {rankLabel}
            </div>
          </div>
        </div>

        <WalletSection />

        <div className="mt-5 text-[10px] uppercase tracking-[0.25em] text-white/40">
          {t('cabinet')}
        </div>

        <div className="mt-2 space-y-2">
          {loading && (
            <div className="text-sm text-white/40">{t('sending')}</div>
          )}
          {!loading && store.myEvents.length === 0 && (
            <div className="text-sm text-white/40">{t('cabinetEmpty')}</div>
          )}
          {rows.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-white/85">
                  {e.text || (e.imageUrl ? '🖼 image' : '—')}
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-widest text-white/35">
                  {new Date(e.ts).toLocaleString()} ·{' '}
                  <span className="text-emerald-400/70">{t('destroyed')}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2.5">
                <div className="font-mono text-sm text-amber-300/85">{e.amount}</div>
                <div className="flex gap-1">
                  <button
                    onClick={() => replay(e)}
                    title={t('replay')}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-white/12 text-[11px] text-white/55 transition hover:border-amber-400/50 hover:text-amber-200"
                  >
                    ▶
                  </button>
                  <button
                    onClick={() => onShare && onShare(e)}
                    title={t('shareGif')}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-white/12 text-[11px] text-white/55 transition hover:border-amber-400/50 hover:text-amber-200"
                  >
                    🎞
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {pageCount > 1 && (
          <div className="mt-5 flex items-center justify-center gap-4">
            <button
              onClick={() => setPage(cur - 1)}
              disabled={cur === 0}
              aria-label="previous page"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-white/12 text-sm text-white/60 transition hover:border-white/40 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:border-white/12 disabled:hover:text-white/60"
            >
              ←
            </button>
            <span className="min-w-[4.5rem] text-center font-mono text-xs tracking-widest text-white/45">
              {cur + 1} / {pageCount}
            </span>
            <button
              onClick={() => setPage(cur + 1)}
              disabled={cur >= pageCount - 1}
              aria-label="next page"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-white/12 text-sm text-white/60 transition hover:border-white/40 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:border-white/12 disabled:hover:text-white/60"
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
