import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  signInGoogle,
  signInEthereum,
  useAuthStatus,
  loadAuthStatus,
} from '../auth';

export default function AuthPrompt({ open, onClose }) {
  const { t } = useTranslation();
  const status = useAuthStatus();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (open) loadAuthStatus();
  }, [open]);

  if (!open) return null;

  const eth = async () => {
    setErr('');
    setBusy('eth');
    try {
      await signInEthereum();
      onClose();
    } catch (e) {
      setErr(e.message === 'no_wallet' ? t('noWallet') : t('authFail'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-emerald-400/25 bg-[#07100c] p-6 text-center"
        style={{ animation: 'void-pop 380ms cubic-bezier(.2,1.4,.4,1)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-3xl">🕳</div>
        <h3 className="mt-2 text-lg font-black uppercase tracking-[0.18em] text-white">
          {t('savedTitle')}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-white/60">{t('savedText')}</p>

        <button
          onClick={() => {
            setErr('');
            signInGoogle();
          }}
          disabled={Boolean(status && !status.google)}
          className="mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C41.4 34.9 44 30 44 24c0-1.3-.1-2.6-.4-3.9z" />
          </svg>
          {t('googleBtn')}
        </button>

        <button
          onClick={eth}
          disabled={busy === 'eth'}
          className="mt-2 w-full cursor-pointer rounded-xl border border-indigo-400/35 bg-indigo-500/15 px-4 py-3 text-sm font-bold text-indigo-100 transition hover:bg-indigo-500/30 disabled:opacity-60"
        >
          ⬡ {busy === 'eth' ? t('signing') : t('ethBtn')}
        </button>

        {status && !status.google && (
          <div className="mt-2 text-[10px] leading-tight text-amber-300/70">{t('googleOff')}</div>
        )}

        {err && <div className="mt-2 text-xs text-red-400">{err}</div>}

        <button
          onClick={onClose}
          className="mt-3 w-full cursor-pointer rounded-lg px-4 py-2 text-xs uppercase tracking-widest text-white/45 transition hover:text-white/80"
        >
          {t('notNow')}
        </button>
      </div>
    </div>
  );
}
