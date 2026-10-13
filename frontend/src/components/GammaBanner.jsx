import { useEffect } from 'react';
import { useStore, clearBanner } from '../lib/store';
import { audio } from '../audio/AudioEngine';

export default function GammaBanner() {
  const { banner } = useStore();

  useEffect(() => {
    if (!banner) return;
    audio.playGamma();
    const id = setTimeout(clearBanner, 6000);
    return () => clearTimeout(id);
  }, [banner?.id]);

  if (!banner) return null;

  const isLink = /^(https?:\/\/|www\.|t\.me\/|x\.com\/|twitter\.com\/)/i.test(
    (banner.text || '').trim()
  );

  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 -translate-y-1/2 px-4">
      <div
        className="pointer-events-auto mx-auto max-w-3xl rounded-3xl border border-fuchsia-400/50 bg-fuchsia-950/40 px-6 py-5 text-center backdrop-blur-xl"
        style={{ animation: 'void-pop 420ms cubic-bezier(.2,1.4,.4,1)' }}
      >
        <div className="text-[11px] font-black uppercase tracking-[0.4em] text-fuchsia-300">
          ⚡ GAMMA BURST
        </div>
        <div className="mt-2 text-2xl font-black text-white sm:text-4xl">
          {banner.name}
        </div>
        {banner.text && (
          <div className="mt-1 break-words text-sm text-fuchsia-100/80 sm:text-lg">
            {isLink ? (
              <a
                href={banner.text.startsWith('http') ? banner.text : 'https://' + banner.text}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-fuchsia-400/60 underline-offset-4 hover:text-white"
              >
                {banner.text}
              </a>
            ) : (
              banner.text
            )}
          </div>
        )}
      </div>
    </div>
  );
}
