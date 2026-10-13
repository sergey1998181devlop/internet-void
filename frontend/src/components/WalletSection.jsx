import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { fetchBalance, fetchTransactions, fmtMoney } from '../lib/wallet';
import { openDeposit } from './WalletModals';

// wallet card inside the cabinet: balance + top-up presets + full history
// with type/status filters and pagination

const PRESETS = [500, 1000, 2500, 5000, 10000];
const TYPES = ['all', 'deposit', 'spend', 'bonus', 'refund'];
const STATUSES = ['all', 'completed', 'pending', 'failed'];
const PAGE = 10;

export default function WalletSection() {
  const { t } = useTranslation();
  const store = useStore();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchBalance();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchTransactions({ limit: PAGE, offset, type, status }).then((data) => {
      if (!alive) return;
      if (data) {
        setItems(data.items || []);
        setTotal(data.total || 0);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [offset, type, status]);

  const signed = (cents) =>
    (cents >= 0 ? '+' : '-') + fmtMoney(Math.abs(cents));

  return (
    <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.06] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-emerald-200/60">
            {t('wallet')}
          </div>
          <div className="mt-1 text-3xl font-black text-emerald-300">
            {fmtMoney(store.balance)}
          </div>
        </div>
        <button
          onClick={() => openDeposit(500)}
          className="cursor-pointer rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-black transition hover:bg-emerald-400"
        >
          {t('topup')}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => openDeposit(p)}
            className="relative cursor-pointer rounded-lg border border-white/12 bg-white/[0.04] px-1 py-1.5 text-[11px] font-bold text-white/70 transition hover:border-white/30 hover:text-white"
          >
            +${p / 100}
            {p >= 5000 && (
              <span className="absolute -top-1.5 right-0.5 rounded-full bg-amber-400/90 px-1 text-[8px] font-black text-black">
                +10%
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-4 text-[10px] uppercase tracking-[0.25em] text-white/40">
        {t('walletHistory')}
      </div>

      <div className="mt-2 flex gap-2">
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setOffset(0);
          }}
          className="min-w-0 flex-1 cursor-pointer rounded-lg border border-white/15 bg-black/50 px-2 py-1.5 text-[11px] uppercase tracking-wider text-white/70 outline-none"
        >
          {TYPES.map((v) => (
            <option key={v} value={v} className="bg-black">
              {v === 'all' ? t('typeAll') : t('type_' + v)}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
          className="min-w-0 flex-1 cursor-pointer rounded-lg border border-white/15 bg-black/50 px-2 py-1.5 text-[11px] uppercase tracking-wider text-white/70 outline-none"
        >
          {STATUSES.map((v) => (
            <option key={v} value={v} className="bg-black">
              {v === 'all' ? t('statusAll') : t('status_' + v)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-2 space-y-2">
        {loading && <div className="py-2 text-center text-xs text-white/40">{t('sending')}</div>}
        {!loading && items.length === 0 && (
          <div className="py-2 text-center text-xs text-white/40">{t('walletEmpty')}</div>
        )}
        {items.map((tx) => (
          <div
            key={tx.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-xs text-white/85">
                {t('type_' + tx.type)} · {tx.desc}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-white/35">
                {new Date(tx.ts).toLocaleString()} · {t('status_' + tx.status)}
              </div>
            </div>
            <div
              className={
                'shrink-0 font-mono text-sm font-bold ' +
                (tx.amount >= 0 ? 'text-emerald-300' : 'text-red-300/90')
              }
            >
              {signed(tx.amount)}
            </div>
          </div>
        ))}
      </div>

      {total > PAGE && (
        <div className="mt-3 flex items-center justify-between text-[11px] text-white/50">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE))}
            disabled={offset === 0}
            className="cursor-pointer rounded-lg border border-white/15 px-3 py-1 uppercase tracking-widest disabled:opacity-30"
          >
            ← {t('prev')}
          </button>
          <span>
            {offset + 1}–{Math.min(total, offset + PAGE)} / {total}
          </span>
          <button
            onClick={() => setOffset(offset + PAGE)}
            disabled={offset + PAGE >= total}
            className="cursor-pointer rounded-lg border border-white/15 px-3 py-1 uppercase tracking-widest disabled:opacity-30"
          >
            {t('next')} →
          </button>
        </div>
      )}
    </div>
  );
}
