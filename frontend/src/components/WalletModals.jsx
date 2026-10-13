import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, setState, getClientId } from '../lib/store';
import { fmtMoney, fetchCryptoConfig, createCryptoInvoice, fetchCryptoStatus } from '../lib/wallet';

// deposit presets in cents; from $50 up the server adds its own +10% bonus
const PRESETS = [500, 1000, 2500, 5000, 10000];
const MIN = 100;
const MAX = 1000000;
const FAIL_STATUSES = ['fail', 'cancel', 'system_fail'];

export function openDeposit(preset = 0) {
  setState({ depositOpen: true, depositPreset: preset, insufficient: null });
}

export default function WalletModals() {
  const { t } = useTranslation();
  const store = useStore();
  // the input is in dollars, presets arrive in cents
  const [amount, setAmount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // cryptomus: config flag + the invoice we are waiting on
  const [cfg, setCfg] = useState(null);
  const [pay, setPay] = useState(null);
  const pollRef = useRef(null);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    if (store.depositOpen && cfg === null) {
      fetchCryptoConfig().then((c) => setCfg(c || { live: false }));
    }
  }, [store.depositOpen, cfg]);

  useEffect(() => () => stopPoll(), []);

  useEffect(() => {
    if (store.depositOpen) {
      setAmount((store.depositPreset || 500) / 100);
      setErr('');
      setBusy(false);
      setPay(null);
      stopPoll();
    }
  }, [store.depositOpen, store.depositPreset]);

  const closeDeposit = () => {
    stopPoll();
    setPay(null);
    setState({ depositOpen: false, depositPreset: 0 });
  };

  // the webhook credits the wallet even if this tab closes — we poll to
  // notice it: server status pulls the invoice over our own API key
  const startPoll = (orderId) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const st = await fetchCryptoStatus(orderId, getClientId());
        if (st.credited || st.status === 'paid' || st.status === 'paid_over') {
          stopPoll();
          if (typeof st.balance === 'number') setState({ balance: st.balance });
          setPay(null);
          setState({ depositOpen: false, depositPreset: 0 });
        } else if (FAIL_STATUSES.includes(st.status)) {
          stopPoll();
          setPay(null);
          setErr(t('payFailed'));
        }
      } catch {
        /* keep polling */
      }
    }, 4000);
  };

  const confirm = async () => {
    const cents = Math.floor(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents < MIN || cents > MAX) {
      setErr(t('depositRange', { min: fmtMoney(MIN), max: fmtMoney(MAX) }));
      return;
    }
    // cryptomus is the only top-up path; before the merchant goes live the
    // button shows a "coming soon" note instead of faking a credit
    if (!cfg || !cfg.live) {
      setErr(t('paySoon'));
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const inv = await createCryptoInvoice(cents, getClientId());
      setPay({ url: inv.url, orderId: inv.orderId });
      window.open(inv.url, '_blank', 'noopener,noreferrer');
      startPoll(inv.orderId);
    } catch {
      setErr(t('depositErr'));
    } finally {
      setBusy(false);
    }
  };

  const bonus = Math.floor(Number(amount) * 100) >= 5000;

  return (
    <>
      {/* ---- top up ---- */}
      {store.depositOpen && (
        <div
          className="absolute inset-0 z-[66] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={closeDeposit}
        >
          <div
            className="max-h-[86dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-white/12 bg-[#07060a] p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-black uppercase tracking-[0.22em] text-white">
                  {t('depositTitle')}
                </h3>
                <p className="mt-1 text-xs uppercase tracking-widest text-white/40">
                  {t('bonusNote')}
                </p>
              </div>
              <button
                onClick={closeDeposit}
                className="cursor-pointer rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 hover:border-white/40 hover:text-white"
              >
                {t('close')}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-5 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setAmount(p / 100)}
                  className={
                    'relative min-h-[40px] cursor-pointer rounded-xl border px-1 py-2.5 text-xs font-bold transition sm:py-2 ' +
                    (Math.floor(Number(amount) * 100) === p
                      ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-200'
                      : 'border-white/15 bg-white/[0.04] text-white/70 hover:border-white/35')
                  }
                >
                  +${p / 100}
                  {p >= 5000 && (
                    <span className="absolute -top-1.5 right-1 rounded-full bg-amber-400/90 px-1 text-[8px] font-black text-black">
                      +10%
                    </span>
                  )}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-[10px] uppercase tracking-widest text-white/45">
              {t('amount')}
            </label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xl font-black text-emerald-300">$</span>
              <input
                type="number"
                min={MIN / 100}
                max={MAX / 100}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2.5 text-base text-white outline-none focus:border-emerald-400/60 sm:py-2 sm:text-sm"
              />
            </div>
            {bonus && (
              <div className="mt-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
                + {fmtMoney(Math.floor(Math.floor(Number(amount) * 100) * 0.1))} {t('bonusWord')}
              </div>
            )}
            {err && <div className="mt-2 text-xs text-red-400">{err}</div>}

            {pay ? (
              <div className="mt-4 space-y-2">
                <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-3 text-center text-xs uppercase tracking-widest text-amber-200">
                  {t('waitPayment')}
                </div>
                <a
                  href={pay.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block cursor-pointer rounded-xl border border-white/20 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.2em] text-white/80 transition hover:border-white/45 hover:text-white"
                >
                  {t('openPayPage')}
                </a>
              </div>
            ) : cfg && !cfg.live ? (
              <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-center text-xs leading-relaxed tracking-widest text-amber-200">
                {t('paySoon')}
              </div>
            ) : (
              <button
                onClick={confirm}
                disabled={busy || !cfg}
                className="mt-4 w-full cursor-pointer rounded-xl bg-emerald-500 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-black transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {busy ? t('sending') : t('confirm')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---- not enough funds for an effect ---- */}
      {store.insufficient && (
        <div
          className="absolute inset-0 z-[66] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setState({ insufficient: null })}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-white/12 bg-[#07060a] p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-3xl">⌀</div>
            <h3 className="mt-2 text-lg font-black uppercase tracking-[0.2em] text-white">
              {t('insufficientTitle')}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              {t('insufficientBody', {
                cost: fmtMoney(store.insufficient.cost),
                balance: fmtMoney(store.insufficient.balance),
              })}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => openDeposit(500)}
                className="flex-1 cursor-pointer rounded-xl bg-emerald-500 px-3 py-2.5 text-xs font-black uppercase tracking-widest text-black transition hover:bg-emerald-400"
              >
                {t('topup')}
              </button>
              <button
                onClick={() => setState({ insufficient: null })}
                className="flex-1 cursor-pointer rounded-xl border border-white/15 px-3 py-2.5 text-xs uppercase tracking-widest text-white/60 transition hover:border-white/35 hover:text-white"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
