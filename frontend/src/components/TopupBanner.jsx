import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// return trip from a failed payment page (Plisio cancel_url = /?topup=failed):
// the money case is settled by the wallet polling, so this only explains the
// landing — the param is scrubbed so a refresh doesn't replay the notice
export default function TopupBanner() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('topup') !== 'failed') return undefined;
    url.searchParams.delete('topup');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    setShow(true);
    const id = setTimeout(() => setShow(false), 15000);
    return () => clearTimeout(id);
  }, []);

  if (!show) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-40 px-4">
      <div
        className="pointer-events-auto relative mx-auto max-w-xl rounded-3xl border border-amber-400/40 bg-amber-950/40 px-6 py-4 text-center backdrop-blur-xl"
        style={{ animation: 'void-pop 420ms cubic-bezier(.2,1.4,.4,1)' }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={() => setShow(false)}
          className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border border-amber-300/50 bg-black/70 text-[11px] font-black text-amber-200 hover:text-white"
        >
          ✕
        </button>
        <div className="text-[11px] font-black uppercase tracking-[0.35em] text-amber-300">
          {t('topupFailed')}
        </div>
        <div className="mt-2 break-words text-sm text-amber-100/85 sm:text-base">
          {t('topupFailedHint')}
        </div>
      </div>
    </div>
  );
}
