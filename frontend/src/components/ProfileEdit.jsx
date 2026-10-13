import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '../auth';

export default function ProfileEdit({ open, onClose }) {
  const { t } = useTranslation();
  const { user } = useMe();
  const [nick, setNick] = useState('');
  const [link, setLink] = useState('');
  const [link2, setLink2] = useState('');
  const [unlocked2, setUnlocked2] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open || !user) return undefined;
    const ctrl = new AbortController();
    setLoading(true);
    setErr('');
    setSaved(false);
    fetch('/api/profile/' + encodeURIComponent(user.name || ''), { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (ctrl.signal.aborted) return;
        const p = d && d.profile;
        setNick(p?.nick || user.name || '');
        setLink(p?.link || '');
        setLink2(p?.link2 || '');
        setUnlocked2(Number(d?.lifetime ?? d?.usd ?? 0) >= 100 || !!p?.link2);
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [open, user]);

  if (!open) return null;

  const save = async () => {
    setSaving(true);
    setErr('');
    setSaved(false);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ nick, link, link2: unlocked2 ? link2 : '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(
          data.error === 'nick_taken'
            ? t('nickTaken')
            : data.error === 'link_denied'
              ? t('linkDenied')
              : t('error')
        );
        return;
      }
      setSaved(true);
      setTimeout(onClose, 700);
    } catch {
      setErr(t('error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center p-4 text-white">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md rounded-3xl border border-white/15 bg-[#0a0910]/97 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-black uppercase tracking-[0.3em] text-white/50">
            {t('editProfile')}
          </div>
          <button
            onClick={onClose}
            aria-label={t('close')}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/70 transition hover:border-white/40 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          {user?.avatar ? (
            <img
              src={user.avatar}
              alt=""
              className="h-12 w-12 rounded-full border border-white/25 object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/25 font-black text-emerald-200">
              {(user?.name || '?').slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-white/90">{user?.name}</div>
            <div className="text-[10px] uppercase tracking-widest text-white/40">
              {user?.provider}
            </div>
          </div>
        </div>

        <label className="mt-4 block text-[10px] uppercase tracking-[0.25em] text-white/45">
          {t('nickLabel')}
        </label>
        <input
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          maxLength={32}
          disabled={loading || saving}
          className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/55 px-3.5 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
        />
        <p className="mt-1 text-[10px] leading-snug text-white/35">{t('editHint')}</p>

        <label className="mt-3 block text-[10px] uppercase tracking-[0.25em] text-white/45">
          {t('linkLabel')}
        </label>
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          maxLength={220}
          placeholder="https://…"
          disabled={loading || saving}
          className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/55 px-3.5 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
        />

        {unlocked2 && (
          <>
            <label className="mt-3 block text-[10px] uppercase tracking-[0.25em] text-white/45">
              {t('link2Label')}
            </label>
            <input
              value={link2}
              onChange={(e) => setLink2(e.target.value)}
              maxLength={220}
              placeholder="https://…"
              disabled={loading || saving}
              className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/55 px-3.5 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
            />
          </>
        )}

        {err && <div className="mt-2 text-xs text-red-400">{err}</div>}
        {saved && <div className="mt-2 text-xs text-emerald-300">{t('profileSaved')}</div>}

        <button
          onClick={save}
          disabled={saving || loading || !nick.trim()}
          className="mt-4 w-full cursor-pointer rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-fuchsia-600 px-4 py-3 text-sm font-black uppercase tracking-[0.2em] text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? '…' : t('saveProfile')}
        </button>
      </div>
    </div>
  );
}
