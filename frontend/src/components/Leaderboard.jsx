import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, fmtMass, MASS_PER_DOLLAR } from '../lib/store';
import { useMe } from '../auth';

const TABS = [
  { key: 'all', icon: '🏆', label: 'topAll' },
  { key: 'day', icon: '🕒', label: 'topDay' },
  { key: 'single', icon: '☄️', label: 'topSingle' },
];

const MEDALS = ['🥇', '🥈', '🥉'];

const fmtUsd = (n) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

// time left until the UTC midnight that wipes the daily board
function untilReset(now) {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const left = Math.max(0, next - now);
  const h = String(Math.floor(left / 3600000)).padStart(2, '0');
  const m = String(Math.floor(left / 60000) % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export default function Leaderboard({ open, onClose, onOpenProfile }) {
  const { t } = useTranslation();
  const store = useStore();
  const { user } = useMe();
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return undefined;
    // every opening starts from the all-time board with a clean search
    setTab('all');
    setQ('');
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;

  const rows = store.boards[tab] || [];
  const needle = q.trim().toLowerCase();
  const list = needle ? rows.filter((r) => String(r.name).toLowerCase().includes(needle)) : rows;
  const me = (user && user.name ? user.name : '').toLowerCase();
  const myRow = me ? rows.findIndex((r) => String(r.name).toLowerCase() === me) : -1;

  const pick = (name) => {
    if (onOpenProfile) onOpenProfile(name);
    onClose();
  };

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/12 bg-[#07060a] p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black uppercase tracking-[0.25em] text-white sm:text-xl">
              {t('leaderboard')}
            </h2>
            <p className="mt-1 text-[11px] uppercase tracking-widest text-white/40">
              {t('boardHint')}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('close')}
            className="cursor-pointer rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 transition hover:border-white/40 hover:text-white"
          >
            {t('close')}
          </button>
        </div>

        {/* tabs */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {TABS.map((x) => (
            <button
              key={x.key}
              onClick={() => setTab(x.key)}
              className={`cursor-pointer rounded-xl border px-2 py-2.5 text-center transition ${
                tab === x.key
                  ? 'border-amber-400/70 bg-amber-500/15 text-amber-100'
                  : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25 hover:text-white/80'
              }`}
            >
              <span className="block text-base leading-none">{x.icon}</span>
              <span className="mt-1.5 block text-[10px] font-black uppercase tracking-[0.12em]">
                {t(x.label)}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={32}
            placeholder={t('boardSearch')}
            aria-label={t('boardSearch')}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/55 px-3.5 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-amber-400/50"
          />
          {tab === 'day' && (
            <span className="shrink-0 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white/50">
              {t('boardReset')} {untilReset(now)}
            </span>
          )}
        </div>

        {myRow >= 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5">
            <span className="truncate text-xs font-bold text-amber-100">
              {user && user.name ? user.name : ''}
            </span>
            <span className="shrink-0 font-mono text-sm font-black text-amber-300">
              #{myRow + 1} · {fmtMass(rows[myRow].mass)}
            </span>
          </div>
        )}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          {list.length === 0 && (
            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-6 text-center text-sm text-white/40">
              {needle ? t('boardNoMatch') : t('noLeaderboard')}
            </div>
          )}
          <ol className="space-y-1">
            {list.map((row, i) => {
              const rank = needle ? rows.indexOf(row) + 1 : i + 1;
              const isMe = me && String(row.name).toLowerCase() === me;
              return (
                <li
                  key={String(row.name) + rank}
                  onClick={() => pick(row.name)}
                  title={t('viewProfile')}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm transition hover:bg-white/5 ${
                    isMe ? 'border border-amber-400/40 bg-amber-500/10' : ''
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="w-7 shrink-0 text-center font-mono text-xs text-white/40">
                      {rank <= 3 ? MEDALS[rank - 1] : rank}
                    </span>
                    <span className="truncate text-white/85">{row.name}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="font-mono text-xs font-bold text-amber-300/90">
                      {fmtMass(row.mass)}
                      <span className="ml-1 text-[10px] text-amber-200/50">M☉</span>
                    </span>
                    {tab === 'single' && (
                      <span className="font-mono text-[10px] text-emerald-300/70">
                        ${fmtUsd(row.mass / MASS_PER_DOLLAR)}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
