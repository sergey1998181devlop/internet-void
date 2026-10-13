import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { recordDestroyMedia, cancelShareRecording } from '../lib/shareGif';
import { PHRASE_CATEGORIES, pickPhrase, shareUrl } from '../lib/sharePhrases';

// per official docs: X/Twitter web intent takes text+url, Telegram share takes
// url+text, Reddit submit takes url+title — Facebook and LinkedIn only take a
// url (their composers read the og: tags of the shared page instead), and
// Discord has no web intent at all, so the last three copy the caption for the
// poster to paste.
const NETWORKS = [
  { id: 'x', label: 'X', url: (t, u) => `https://x.com/intent/tweet?text=${t}&url=${u}` },
  { id: 'tg', label: 'Telegram', url: (t, u) => `https://t.me/share/url?url=${u}&text=${t}` },
  { id: 'rd', label: 'Reddit', url: (t, u) => `https://www.reddit.com/submit?url=${u}&title=${t}` },
  { id: 'fb', label: 'Facebook', prefill: false, url: (t, u) => `https://www.facebook.com/sharer/sharer.php?u=${u}` },
  { id: 'li', label: 'LinkedIn', prefill: false, url: (t, u) => `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
  { id: 'dc', label: 'Discord', prefill: false, url: null },
];

export default function ShareModal({ event, glCanvas, onClose, onBack }) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState('recording'); // recording | ready | error
  const [stage, setStage] = useState('waiting');
  const [media, setMedia] = useState(null);
  const [cat, setCat] = useState('mystery');
  const [phrase, setPhrase] = useState('');
  const [flash, setFlash] = useState('');
  const [clipSec, setClipSec] = useState(0);
  // the clip published on the server — this is what socials turn into a preview
  const [clipLink, setClipLink] = useState('');
  const [uploading, setUploading] = useState(false);
  const alive = useRef(true);
  const urlRef = useRef(null);
  // the caption the og: tags are published with — read at upload time, so a
  // shuffle during the recording still lands in the preview
  const phraseRef = useRef('');

  const lang = (i18n && i18n.language) || 'en';
  const item = event?.text || event?.name || '';

  const fresh = (category) => pickPhrase(category, { item, lang });

  useEffect(() => {
    setPhrase(fresh('mystery'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, lang]);

  useEffect(() => {
    phraseRef.current = phrase;
  }, [phrase]);

  // upload the finished clip: /v/<id> carries the og-tags socials read, so a
  // shared link shows the video preview with the caption right away
  const publish = async (media0, text) => {
    if (!media0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('clip', media0.blob, `the-internet-void-${event.id}.${media0.ext}`);
      if (media0.poster) fd.append('poster', media0.poster, `poster-${event.id}.jpg`);
      fd.append('text', text);
      fd.append('eventId', String(event.id || ''));
      fd.append('w', String(media0.width || 0));
      fd.append('h', String(media0.height || 0));
      fd.append('dur', String(Math.round(media0.duration || 0)));
      fd.append('fps', String(media0.fps || 0));
      fd.append('bytes', String(media0.bytes || 0));
      const res = await fetch('/api/share/clip', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('http ' + res.status);
      const d = await res.json();
      if (alive.current && d.url) setClipLink(d.url);
    } catch {
      /* offline — the plain site link is used instead */
    } finally {
      if (alive.current) setUploading(false);
    }
  };

  useEffect(() => {
    if (!event) return;
    alive.current = true;
    setStatus('recording');
    setStage('waiting');
    setMedia(null);
    setClipSec(0);
    setClipLink('');
    setUploading(false);
    cancelShareRecording();

    const startRecording = () =>
      recordDestroyMedia({ glCanvas, event, onStage: (s) => alive.current && setStage(s) })
        .then((r) => {
          if (!alive.current) {
            URL.revokeObjectURL(r.url);
            return;
          }
          urlRef.current = r.url;
          setMedia(r);
          setStatus('ready');
          publish(r, `${phraseRef.current}\n${shareUrl()}`);
        })
        .catch(() => alive.current && setStatus('error'));

    // a clip this sacrifice was already shared with — open the sheet straight
    // on it, no second recording and no second upload
    const reuse = async () => {
      try {
        const res = await fetch(`/api/share/clip/${encodeURIComponent(event.id)}`);
        if (!res.ok) return false;
        const d = await res.json();
        if (!alive.current || !d.url) return false;
        const file = String(d.file || '');
        setMedia({
          kind: d.kind === 'gif' ? 'gif' : 'video',
          url: d.url,
          posterUrl: d.poster || '',
          width: d.w || 0,
          height: d.h || 0,
          duration: d.dur || 0,
          fps: d.fps || 0,
          bytes: d.bytes || 0,
          ext: /\.gif$/i.test(file) ? 'gif' : file.split('.').pop() || 'mp4',
          shared: true,
        });
        setClipLink(d.pageUrl);
        setStatus('ready');
        return true;
      } catch {
        return false;
      }
    };

    (async () => {
      if (await reuse()) return;
      if (alive.current) await startRecording();
    })();

    return () => {
      alive.current = false;
      cancelShareRecording();
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id]);

  if (!event) return null;

  const link = clipLink || shareUrl();
  const all = `${phrase}\n${link}`;

  const say = (msg) => {
    setFlash(msg);
    setTimeout(() => setFlash(''), 1600);
  };

  const copyText = async (value = all, msg) => {
    try {
      await navigator.clipboard.writeText(value);
      say(msg || t('copied'));
    } catch {
      /* ignore */
    }
  };

  const openNetwork = (n) => {
    if (n.url) {
      window.open(
        n.url(encodeURIComponent(phrase), encodeURIComponent(link)),
        '_blank',
        'noopener,noreferrer'
      );
    }
    // Facebook, LinkedIn and Discord cannot prefill a caption — the caption is
    // on the clipboard instead, and the preview text comes from the og: tags
    if (n.prefill === false) copyText(all, t('sharePaste'));
  };

  const download = () => {
    if (!media) return;
    const a = document.createElement('a');
    a.href = media.url;
    a.download = `the-internet-void-${event.id}.${media.ext}`;
    a.click();
  };

  const chooseCat = (id) => {
    setCat(id);
    setPhrase(fresh(id));
  };

  const retry = () => {
    setStatus('recording');
    setStage('waiting');
    setMedia(null);
    setClipLink('');
    alive.current = true;
    cancelShareRecording();
    recordDestroyMedia({ glCanvas, event, onStage: (s) => alive.current && setStage(s) })
      .then((r) => {
        if (!alive.current) {
          URL.revokeObjectURL(r.url);
          return;
        }
        urlRef.current = r.url;
        setMedia(r);
        setStatus('ready');
        publish(r, `${phraseRef.current}\n${shareUrl()}`);
      })
      .catch(() => alive.current && setStatus('error'));
  };

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/12 bg-[#07060a] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black uppercase tracking-[0.22em] text-white">
              {t('shareTitle')}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-white/45">{t('shareLead')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onBack && (
              <button
                onClick={onBack}
                className="cursor-pointer rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 transition hover:border-amber-400/50 hover:text-amber-200"
              >
                ← {t('back')}
              </button>
            )}
            <button
              onClick={onClose}
              className="cursor-pointer rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 transition hover:border-white/40 hover:text-white"
            >
              {t('close')}
            </button>
          </div>
        </div>

        {status === 'recording' && (
          <div className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-6 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-amber-300/30 border-t-amber-300" />
            <div className="mt-4 text-sm font-bold uppercase tracking-widest text-amber-200">
              {t(`stage_${stage}`)}
            </div>
            <div className="mt-2 text-[11px] leading-relaxed text-white/45">{t('shareHint')}</div>
          </div>
        )}

        {status === 'error' && (
          <div className="mt-5 rounded-2xl border border-rose-400/25 bg-rose-500/10 p-6 text-center">
            <div className="text-sm font-bold text-rose-200">{t('shareError')}</div>
            <button
              onClick={retry}
              className="mt-4 cursor-pointer rounded-xl border border-white/20 px-4 py-2 text-xs uppercase tracking-widest text-white/80 hover:border-white/50"
            >
              {t('shareRetry')}
            </button>
          </div>
        )}

        {status === 'ready' && media && (
          <>
            {media.kind === 'video' ? (
              <video
                key={media.url}
                src={media.url}
                poster={media.posterUrl || undefined}
                className="mt-5 w-full rounded-2xl border border-white/10 bg-black"
                autoPlay
                loop
                muted
                playsInline
                controls
                onLoadedMetadata={(e) => setClipSec(e.currentTarget.duration || 0)}
              />
            ) : (
              <img
                src={media.url}
                alt=""
                className="mt-5 w-full rounded-2xl border border-white/10 bg-black"
              />
            )}
            <div className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-white/30">
              {media.width ? `${media.width}×${media.height}` : ''}
              {media.fps ? ` · ${media.fps}fps` : ''}
              {` · ${Math.round((clipSec || media.duration || 0) * 10) / 10}s`}
              {media.bytes ? ` · ${(media.bytes / 1048576).toFixed(1)}MB` : ''}
              {media.ext ? ` · ${media.ext}` : ''}
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-sky-300/90">
                {clipLink || t('shareUploading')}
              </span>
              {!clipLink && (
                <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-sky-300/40 border-t-sky-300" />
              )}
            </div>

            <div className="mt-4 flex gap-1.5">
              {PHRASE_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => chooseCat(c.id)}
                  className={`flex-1 cursor-pointer rounded-full border px-2 py-2 text-[11px] font-bold uppercase tracking-widest transition ${
                    cat === c.id
                      ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                      : 'border-white/12 text-white/45 hover:border-white/30 hover:text-white/80'
                  }`}
                >
                  {t(c.key)}
                </button>
              ))}
            </div>

            <div className="relative mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="pr-7 text-sm leading-relaxed text-white/85">{phrase}</p>
              <button
                onClick={() => setPhrase(fresh(cat))}
                title={t('shareShuffle')}
                className="absolute right-3 top-3 cursor-pointer text-base leading-none text-white/35 transition hover:text-amber-300"
              >
                🎲
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {NETWORKS.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openNetwork(n)}
                  className="cursor-pointer rounded-xl border border-white/12 px-2 py-2.5 text-[11px] font-bold text-white/70 transition hover:border-white/40 hover:text-white"
                >
                  {n.label}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => copyText(all)}
                className="cursor-pointer rounded-xl bg-amber-400 px-3 py-3 text-xs font-black uppercase tracking-widest text-black transition hover:bg-amber-300"
              >
                {t('shareCopyText')}
              </button>
              <button
                onClick={download}
                className="cursor-pointer rounded-xl border border-white/15 px-3 py-3 text-xs font-bold uppercase tracking-widest text-white/80 transition hover:border-white/40 hover:text-white"
              >
                {media.kind === 'video' ? t('shareDownloadVideo') : t('shareDownload')}
              </button>
            </div>
          </>
        )}

        {flash && (
          <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-2 text-center text-xs font-bold uppercase tracking-widest text-emerald-200">
            {flash}
          </div>
        )}
      </div>
    </div>
  );
}
