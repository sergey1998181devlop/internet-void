import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sendDestroy } from '../lib/socket';
import { getClientId, getState } from '../lib/store';
import { parseAmount, detectSecret, tierOf } from '../lib/tiers';
import { qaHeaders, qaToken } from '../lib/qa';
import { audio } from '../audio/AudioEngine';
import { triggerBitcoin, triggerGlitch } from '../lib/effects';
import { startRickroll } from '../lib/rickroll';
import { startInterstellar } from '../lib/interstellar';
import { startDissolve, resetStable } from '../lib/stabilize';

const SAMPLES = [
  'секрет, который я никогда никому не рассказывал',
  'сайт моего бывшего университета',
  'мой главный грех 2019 года',
  'https://x.com/competitor',
  'переписка, о которой я жалею',
  'бывший работодатель: ooo-toxi.ru',
  'логотип конкурента',
];

const GAMMA_SAMPLES = [
  'https://x.com/void',
  'https://t.me/void_channel',
  'https://x.com/competitor',
];

const SECRET_AMOUNTS = [3.14, 6.66, 7.77, 13.37, 42];
const HIGH_TIERS = [
  [0, 15],
  [9, 30],
  [8, 60],
  [7, 100],
];

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export default function TestPanel() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(null);
  const [last, setLast] = useState('');
  const [custom, setCustom] = useState('');

  const fire = async (amount) => {
    if (busy) return;
    const a = parseAmount(amount, 1);
    setBusy(a);
    try {
      const ev = await sendDestroy({
        text: a >= 5 ? pick(GAMMA_SAMPLES) : pick(SAMPLES),
        name: 'Tester',
        amount: a,
        clientId: getClientId(),
        test: true, // QA panel: paid effects run for free
        qa: qaToken(), // …but only with the token the server knows
        phase: getState().stabilized ? 2 : 1,
      });
      const secret = detectSecret(a);
      setLast(`#${ev.id.split('-')[1]} → ${a}$ · ${secret ? 'secret ' + secret : 'T' + tierOf(a)}`);
      audio.playSuck();
    } catch (e) {
      setLast(e && e.reason === 'insufficient' ? 'insufficient — top up wallet' : 'error');
    } finally {
      setBusy(null);
    }
  };

  const bang = async () => {
    try {
      await fetch('/api/test/big_bang', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...qaHeaders() },
        body: JSON.stringify({ milestone: 1000 }),
      });
      setLast('big bang →');
    } catch {
      setLast('bang blocked');
    }
  };

  // ARG phase 1: a real ENTROPY throw (free test path) — the server answers
  // arg_solved and sendDestroy runs the emissive dissolve end to end
  const entropy = async () => {
    if (busy) return;
    setBusy('entropy');
    try {
      await sendDestroy({
        text: 'ENTROPY',
        name: 'Tester',
        amount: 1,
        clientId: getClientId(),
        test: true,
        qa: qaToken(),
        phase: getState().stabilized ? 2 : 1,
      });
      setLast('entropy → arg_solved');
    } catch (e) {
      setLast(e && e.reason === 'insufficient' ? 'insufficient' : 'error');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === '1') fire(1);
      if (e.key === '2') fire(5);
      if (e.key === '3') fire(10);
      if (e.key === '4') startInterstellar({ name: 'Tester' });
      if (e.key === '5') triggerBitcoin();
      if (e.key === '6') triggerGlitch();
      if (e.key === '7') fire(100);
      if (e.key === '8') fire(60);
      if (e.key === '9') fire(30);
      if (e.key === '0') fire(15);
      if (e.key.toLowerCase() === 'b') bang();
      if (e.key.toLowerCase() === 'r') startRickroll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const btn =
    'cursor-pointer rounded-lg border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition disabled:cursor-wait disabled:opacity-50';

  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 z-30 -translate-x-1/2">
      <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2 rounded-2xl border border-cyan-400/40 bg-black/70 px-3 py-2 backdrop-blur-md">
        <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
          {t('testMode')}
        </span>

        <button
          onClick={() => fire(1)}
          disabled={busy === 1}
          className={`${btn} border-amber-400/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/30`}
          title={t('testSmall')}
        >
          {busy === 1 ? '…' : '$1'}
        </button>

        <button
          onClick={() => fire(5)}
          disabled={busy === 5}
          className={`${btn} border-fuchsia-400/50 bg-fuchsia-500/15 text-fuchsia-200 hover:bg-fuchsia-500/30`}
          title="Gamma $5"
        >
          {busy === 5 ? '…' : '⚡ $5'}
        </button>

        <button
          onClick={() => fire(10)}
          disabled={busy === 10}
          className={`${btn} border-fuchsia-500/60 bg-fuchsia-600/25 text-fuchsia-100 hover:bg-fuchsia-600/45`}
          title={t('testGamma')}
        >
          {busy === 10 ? '…' : '⚡ $10'}
        </button>

        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim()) fire(custom);
          }}
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            inputMode="decimal"
            placeholder="$…"
            aria-label="custom amount"
            className="w-16 rounded-lg border border-white/20 bg-black/60 px-2 py-1.5 text-right font-mono text-[11px] text-white outline-none focus:border-cyan-400/60"
          />
          <button type="submit" className={`${btn} border-cyan-400/50 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/30`}>
            fire
          </button>
        </form>

        <span className="hidden text-[10px] uppercase tracking-widest text-white/40 sm:inline">
          {t('testHint')}
        </span>

        {last && (
          <span className="max-w-[140px] truncate font-mono text-[10px] text-cyan-300/70">
            {last}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/15 bg-black/70 px-3 py-1.5 backdrop-blur-md">
        <span className="hidden text-[10px] uppercase tracking-widest text-white/40 sm:inline">
          secrets
        </span>
        {SECRET_AMOUNTS.map((v) => (
          <button
            key={v}
            onClick={() => fire(v)}
            className={`${btn} border-pink-400/50 bg-pink-500/15 text-pink-200 hover:bg-pink-500/30`}
            title={`secret ${v}`}
          >
            {v}
          </button>
        ))}
        <span className="hidden text-[10px] uppercase tracking-widest text-white/40 sm:inline">
          7 / 8 / 9 / 0
        </span>
        {HIGH_TIERS.map(([k, v]) => (
          <button
            key={k}
            onClick={() => fire(v)}
            className={`${btn} border-amber-300/50 bg-amber-500/15 text-amber-100 hover:bg-amber-500/30`}
            title={`$${v}`}
          >
            ${v}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-2xl border border-white/15 bg-black/70 px-3 py-1.5 backdrop-blur-md">
        <span className="hidden text-[10px] uppercase tracking-widest text-white/40 sm:inline">
          eggs 4 / 5 / 6 / r / b
        </span>
        <button
          onClick={() => startInterstellar({ name: 'Tester' })}
          className={`${btn} border-amber-400/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/30`}
          title="Interstellar (Cornfield Chase)"
        >
          4 · interstellar
        </button>
        <button
          onClick={() => triggerBitcoin()}
          className={`${btn} border-yellow-300/50 bg-yellow-500/15 text-yellow-200 hover:bg-yellow-500/30`}
          title="Bitcoin"
        >
          5 · btc
        </button>
        <button
          onClick={() => triggerGlitch()}
          className={`${btn} border-green-400/50 bg-green-500/15 text-green-200 hover:bg-green-500/30`}
          title="404 / null"
        >
          6 · 404
        </button>
        <button
          onClick={() => startRickroll()}
          className={`${btn} border-pink-400/60 bg-pink-600/25 text-pink-100 hover:bg-pink-600/45`}
          title="Rickroll (15s)"
        >
          r · rickroll
        </button>
        <button
          onClick={bang}
          className={`${btn} border-red-400/50 bg-red-500/15 text-red-200 hover:bg-red-500/30`}
          title="Big bang"
        >
          b · big bang
        </button>
      </div>

      <div className="flex items-center gap-2 rounded-2xl border border-white/15 bg-black/70 px-3 py-1.5 backdrop-blur-md">
        <span className="hidden text-[10px] uppercase tracking-widest text-white/40 sm:inline">
          arg phase 1
        </span>
        <button
          onClick={entropy}
          disabled={busy === 'entropy'}
          className={`${btn} border-teal-400/60 bg-teal-500/15 text-teal-200 hover:bg-teal-500/30`}
          title="POST /destroy with the word ENTROPY ($1, free test path)"
        >
          {busy === 'entropy' ? '…' : 'entropy · solve'}
        </button>
        <button
          onClick={() => {
            startDissolve();
            setLast('dissolve →');
          }}
          className={`${btn} border-orange-400/60 bg-orange-500/15 text-orange-200 hover:bg-orange-500/30`}
          title="Run the emissive dissolve locally (no server)"
        >
          ▶ phase 2 · dissolve
        </button>
        <button
          onClick={async () => {
            resetStable();
            try {
              await fetch('/api/test/arg_reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...qaHeaders() },
                body: JSON.stringify({ clientId: getClientId() }),
              });
            } catch {
              /* offline */
            }
            setLast('stable ← reset');
          }}
          className={`${btn} border-white/25 bg-white/5 text-white/70 hover:bg-white/15`}
          title="Back to the original void (clears localStorage + server record)"
        >
          ↺ phase 1 · reset
        </button>
      </div>
      </div>
    </div>
  );
}
