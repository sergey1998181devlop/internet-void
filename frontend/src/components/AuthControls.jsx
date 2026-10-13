import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  signInGoogle,
  signInEthereum,
  logout,
  useMe,
  useAuthStatus,
  loadAuthStatus,
} from '../auth';

const GoogleIcon = () => (
  <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C41.4 34.9 44 30 44 24c0-1.3-.1-2.6-.4-3.9z" />
  </svg>
);

export default function AuthControls({ onEditProfile }) {
  const { t } = useTranslation();
  const { user, loading } = useMe();
  const status = useAuthStatus();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    loadAuthStatus();
  }, []);

  if (loading) return null;

  if (user) {
    return (
      <div className="pointer-events-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => onEditProfile && onEditProfile()}
          title={t('editProfile')}
          className="flex cursor-pointer items-center gap-2 rounded-full border border-emerald-400/30 bg-black/50 py-1 pl-1 pr-3 backdrop-blur transition hover:border-emerald-400/60"
        >
          {user.avatar ? (
            <img
              src={user.avatar}
              alt=""
              className="h-6 w-6 rounded-full border border-white/20 object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/25 text-[10px] font-black text-emerald-200">
              {(user.name || '?').slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="max-w-[90px] truncate text-[11px] font-semibold text-white/85">
            {user.name}
          </span>
        </button>
        <button
          onClick={() => logout()}
          className="cursor-pointer rounded-full border border-white/15 bg-black/50 px-2.5 py-1.5 text-[10px] uppercase tracking-widest text-white/55 transition hover:border-white/40 hover:text-white"
          title={t('signOut')}
        >
          ↩
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-[11px] uppercase tracking-widest text-white/70 backdrop-blur transition hover:border-emerald-400/50 hover:text-white"
      >
        {t('signIn')}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-[262px] rounded-2xl border border-white/12 bg-[#0a0910]/95 p-3 shadow-2xl backdrop-blur-xl">
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">
              {t('signIn')}
            </div>

            <button
              disabled={busy !== '' || (status && !status.google)}
              onClick={async () => {
                setErr('');
                setBusy('google');
                await new Promise((r) => setTimeout(r, 60));
                signInGoogle();
              }}
              className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/15 bg-white px-3 py-2.5 text-sm font-bold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <GoogleIcon />
              {busy === 'google' ? t('redirecting') : t('googleBtn')}
            </button>
            {status && !status.google && (
              <div className="mt-1.5 text-[10px] leading-tight text-amber-300/70">
                {t('googleOff')}
              </div>
            )}

            <button
              disabled={busy !== ''}
              onClick={async () => {
                setErr('');
                setBusy('eth');
                try {
                  await signInEthereum();
                  setOpen(false);
                } catch (e) {
                  setErr(e.message === 'no_wallet' ? t('noWallet') : t('authFail'));
                } finally {
                  setBusy('');
                }
              }}
              className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-indigo-400/35 bg-indigo-500/15 px-3 py-2.5 text-sm font-bold text-indigo-100 transition hover:bg-indigo-500/30 disabled:opacity-60"
            >
              ⬡ {busy === 'eth' ? t('signing') : t('ethBtn')}
            </button>

            {err && <div className="mt-2 text-xs text-red-400">{err}</div>}

            <p className="mt-3 text-[10px] leading-relaxed text-white/35">
              {t('guestNote')}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
