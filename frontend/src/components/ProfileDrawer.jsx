import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setState, getState } from '../lib/store';

const TITLE_COLORS = [
  '#9ca3af', '#a3e635', '#38bdf8', '#fbbf24', '#f97316', '#fde047',
];

const fmtUsd = (n) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

export default function ProfileDrawer({ name, onClose }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!name) return undefined;
    const ctrl = new AbortController();
    setLoading(true);
    setErr('');
    setData(null);
    fetch('/api/profile/' + encodeURIComponent(name), { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http ' + r.status))))
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setErr(t('error'));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  if (!name) return null;

  const replay = (ev) => {
    if (!ev) return;
    const e = {
      ...ev,
      name: ev.name || name,
      id: (ev.id || 'ev') + '-r' + Date.now(),
      ts: Date.now(),
      amount: Number(ev.amount) || 1,
    };
    setState({ queue: [...getState().queue, e] });
    onClose();
  };

  const badges = [
    { key: 'rocket', icon: '🚀' },
    { key: 'divine', icon: '✨' },
    { key: 'gamma', icon: '💥' },
    { key: 'secret', icon: '🔮' },
  ];

  return (
    <div className="pointer-events-auto fixed inset-0 z-[60] select-none text-white">
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute right-0 top-0 flex h-full w-[min(94vw,430px)] flex-col overflow-y-auto border-l border-white/15 bg-[#0a0910]/95 shadow-[-20px_0_60px_rgba(0,0,0,0.7)]">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/45">
            {t('viewProfile')}
          </div>
          <button
            onClick={onClose}
            aria-label={t('close')}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/70 transition hover:border-white/40 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-5">
          {loading && <div className="text-sm text-white/50">…</div>}
          {err && <div className="text-sm text-red-400">{err}</div>}

          {data && (
            <>
              <div className="flex items-center gap-3">
                {data.profile?.avatar ? (
                  <img
                    src={data.profile.avatar}
                    alt=""
                    className="h-14 w-14 rounded-full border-2 border-amber-300/40 object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-white/20 bg-white/10 text-xl font-black text-amber-200">
                    {(data.profile?.nick || data.name).slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="truncate text-xl font-black">
                    {data.profile?.nick || data.name}
                  </div>
                  <div
                    className="mt-0.5 inline-block rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest"
                    style={{
                      color: TITLE_COLORS[data.titleIdx] || TITLE_COLORS[0],
                      borderColor: (TITLE_COLORS[data.titleIdx] || TITLE_COLORS[0]) + '66',
                    }}
                  >
                    {t('title' + data.titleIdx)}
                  </div>
                </div>
              </div>

              {/* totals */}
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/45 p-4">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-white/40">
                      {t('totalDonated')}
                    </div>
                    <div className="mt-1 text-3xl font-black text-amber-300">
                      ${fmtUsd(data.usd)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-bold text-amber-200/80">
                      {data.mass.toFixed(2)} M☉
                    </div>
                    <div className="text-[11px] text-white/50">
                      {data.pct >= 0.1 ? data.pct.toFixed(1) : data.pct.toFixed(2)}% {t('ofHole')}
                    </div>
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-300"
                    style={{ width: `${Math.max(1, Math.min(100, data.pct))}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-white/50">
                  {data.count} {t('sacrifices')}
                </div>
              </div>

              {/* badges */}
              <div className="mt-3 flex flex-wrap gap-2">
                {badges
                  .filter((b) => data.badges && data.badges[b.key])
                  .map((b) => (
                    <span
                      key={b.key}
                      title={t('badge' + b.key.charAt(0).toUpperCase() + b.key.slice(1))}
                      className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-sm"
                    >
                      {b.icon}
                    </span>
                  ))}
              </div>

              {/* top sacrifice + replay */}
              <div className="mt-4 rounded-2xl border border-amber-300/25 bg-black/50 p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-200/80">
                  ★ {t('topSacrifice')}
                </div>
                {data.top ? (
                  <>
                    {data.top.imageUrl ? (
                      <img
                        src={data.top.imageUrl}
                        alt=""
                        className="mt-2 h-24 w-full rounded-lg border border-white/10 object-cover"
                      />
                    ) : null}
                    <div className="mt-2 text-sm leading-snug text-white/85">
                      {data.top.text || '🖼'}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="font-mono text-lg font-black text-amber-300">
                        +${fmtUsd(data.top.amount)}
                      </span>
                      <button
                        onClick={() => replay(data.top)}
                        className="cursor-pointer rounded-full border border-amber-400/50 bg-amber-500/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-amber-100 transition hover:bg-amber-500/30"
                      >
                        ▶ {t('replay')}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="mt-2 text-sm text-white/45">{t('noRecent')}</div>
                )}
              </div>

              {/* gallery of past sacrifices — every one of them replays */}
              {data.recent && data.recent.length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.28em] text-white/45">
                    {t('recentSacrifices')}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {data.recent.slice(0, 8).map((s, i) => (
                      <div key={s.id || i} className="relative">
                        {s.imageUrl ? (
                          <img
                            src={s.imageUrl}
                            alt=""
                            className="h-20 w-full rounded-lg border border-white/10 object-cover"
                          />
                        ) : (
                          <div className="line-clamp-3 flex h-20 items-center rounded-lg border border-white/10 bg-white/5 p-2 text-[11px] leading-tight text-white/70">
                            {s.text || '…'}
                          </div>
                        )}
                        <span className="pointer-events-none absolute left-1 top-1 rounded-full bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                          +${fmtUsd(s.amount)}
                        </span>
                        <button
                          onClick={() => replay(s)}
                          title={t('replay')}
                          className="absolute bottom-1 right-1 cursor-pointer rounded-full border border-amber-400/50 bg-black/75 px-2 py-0.5 text-[11px] font-bold text-amber-100 transition hover:bg-amber-500/30"
                        >
                          ▶
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {[data.profile?.link, data.profile?.link2]
                .filter((u) => typeof u === 'string' && u.startsWith('http'))
                .map((u, i) => (
                  <a
                    key={i}
                    href={u}
                    target="_blank"
                    rel="nofollow ugc noopener noreferrer"
                    className={
                      'block truncate rounded-xl border border-white/15 bg-black/45 px-4 py-3 text-center text-xs text-sky-300 transition hover:border-sky-400/50 ' +
                      (i > 0 ? 'mt-2' : 'mt-4')
                    }
                  >
                    🔗 {u}
                  </a>
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
