import { useEffect, useSyncExternalStore, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  subscribeMusic,
  getMusic,
  loadTracks,
  play,
  toggle,
  next,
  setVolume,
  armAutoplay,
} from '../lib/music';

const btn =
  'pointer-events-auto flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/75 backdrop-blur transition hover:border-amber-300/60 hover:text-amber-200';

export default function MusicPlayer() {
  const { t } = useTranslation();
  const m = useSyncExternalStore(subscribeMusic, getMusic);
  // phone: the card is collapsed into the album-art button until tapped
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // the radio starts itself on entry (fades in from silence)
    loadTracks().then((tracks) => {
      if (tracks.length) armAutoplay();
    });
  }, []);

  const track = m.tracks[m.index];

  const onToggle = async () => {
    if (!m.tracks.length) {
      const tracks = await loadTracks();
      if (tracks.length) {
        play(0);
        return;
      }
      return;
    }
    toggle();
  };

  if (m.error && !m.tracks.length) return null;

  const playGlyph = m.loading && !track ? (
    <span className="h-3.5 w-3.5 animate-spin rounded-full border border-white/40 border-t-transparent" />
  ) : m.playing ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 4.5v15l13-7.5-13-7.5z" />
    </svg>
  );

  return (
    <>
      {/* phone: collapsed art button under the wallet pill */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('radio')}
        aria-label={t('radio')}
        className={`pointer-events-auto absolute right-2 top-[58px] z-30 flex h-11 w-11 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-white/25 bg-black/65 backdrop-blur md:right-3 ${
          open ? 'hidden' : 'flex'
        } sm:hidden`}
      >
        {track ? (
          <img
            src={track.art}
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.visibility = 'hidden';
            }}
            className="absolute inset-0 h-full w-full object-cover opacity-55"
          />
        ) : null}
        <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white/90">
          {m.playing ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 4.5v15l13-7.5-13-7.5z" />
            </svg>
          )}
        </span>
      </button>

      {/* full card: always on from sm up, tap-to-open on phones */}
      <div
        className={`pointer-events-auto absolute right-2 top-[58px] z-30 max-w-[calc(100vw-1rem)] items-center gap-2 rounded-2xl border border-white/15 bg-black/55 p-2 pr-3 shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur-md sm:right-6 sm:top-[78px] ${
          open ? 'flex' : 'hidden'
        } sm:flex [@media(max-height:480px)]:hidden!`}
      >
        {track ? (
          <img
            src={track.art}
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.visibility = 'hidden';
            }}
            className="h-11 w-11 shrink-0 rounded-lg object-cover ring-1 ring-white/15"
          />
        ) : (
          <div className="h-11 w-11 shrink-0 rounded-lg border border-white/15 bg-white/5" />
        )}

        <div className="min-w-0">
          <div className="max-w-[104px] truncate text-[11px] font-semibold leading-tight text-white/90 sm:max-w-[170px]">
            {track ? track.name : t('radio')}
          </div>
          <div className="max-w-[104px] truncate text-[10px] leading-tight text-white/45 sm:max-w-[170px]">
            {track ? track.artist : m.loading ? t('radioLoading') : t('radioHint')}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={onToggle} title={m.playing ? t('pause') : t('play')} className={btn}>
            {playGlyph}
          </button>

          <button type="button" onClick={next} title={t('nextTrack')} className={btn}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setOpen(false)}
            title={t('close')}
            aria-label={t('close')}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/50 text-xs text-white/70 backdrop-blur transition hover:border-white/40 hover:text-white sm:hidden"
          >
            ✕
          </button>
        </div>

        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={m.volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          title={t('volume')}
          aria-label={t('volume')}
          className="hidden w-16 shrink-0 cursor-pointer accent-amber-300 sm:block"
        />
      </div>
    </>
  );
}
