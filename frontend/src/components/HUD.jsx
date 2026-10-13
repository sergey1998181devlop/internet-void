import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, getClientId, consumeQueue, fmtMass, setState } from '../lib/store';
import { sendDestroy } from '../lib/socket';
import { audio } from '../audio/AudioEngine';
import { LANG_OPTIONS } from '../i18n';
import { downloadShareCard } from '../lib/shareCard';
import {
  TIERS,
  SECRETS,
  tierOf,
  detectSecret,
  tierName,
  secretName,
  parseAmount,
} from '../lib/tiers';
import AuthControls from './AuthControls';
import AuthPrompt from './AuthPrompt';
import Gamification from './Gamification';
import MusicPlayer from './MusicPlayer';
import { openDeposit } from './WalletModals';
import { armAutoplay, pauseRadio } from '../lib/music';
import { useMe } from '../auth';
import useVoidGlitch from '../lib/voidGlitch';
import { emitVoidFragment } from '../lib/hints';
import { fragmentText } from '../lib/fragments';
import StabilizedPanel from './StabilizedPanel';
import { useNarrow } from '../lib/media';

function Odometer({ value }) {
  const [display, setDisplay] = useState(value);
  const raf = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    const from = display;
    const to = value;
    const t0 = performance.now();
    const dur = 700;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setDisplay(from + (to - from) * e);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span className="tabular-nums">{fmtMass(display)}</span>
  );
}

// mass + top-3 champions + piggy bank: shared between the phone card and
// the wide-screen corner panel
function MassBody({ store, t, onOpenRecords, onOpenProfile }) {
  return (
    <>
      {/* top 3 is always on screen, the full top 100 lives behind the button */}
      <button
        onClick={onOpenRecords}
        className="mt-3 w-full cursor-pointer rounded-lg border border-white/12 bg-white/[0.04] px-2.5 py-2 text-left text-[10px] uppercase tracking-[0.25em] text-white/55 transition hover:border-amber-400/40 hover:text-white/85 2xl:py-3 2xl:text-xs"
      >
        {t('leaderboard')} <span className="float-right text-amber-300/70">▸</span>
      </button>

      <ol className="mt-2 space-y-1 2xl:space-y-1.5">
        {store.boards.all.length === 0 && (
          <li className="text-xs text-white/35 2xl:text-sm">{t('noLeaderboard')}</li>
        )}
        {store.boards.all.slice(0, 3).map((row, i) => (
          <li
            key={row.name + i}
            onClick={() => onOpenProfile(row.name)}
            title={t('viewProfile')}
            className="flex cursor-pointer items-center justify-between gap-3 rounded px-1 text-xs transition hover:bg-white/5 2xl:text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="w-4 shrink-0 text-center">{['🥇', '🥈', '🥉'][i]}</span>
              <span className="truncate text-white/75">{row.name}</span>
            </span>
            <span className="shrink-0 font-mono text-amber-300/80">
              {fmtMass(row.mass)}
            </span>
          </li>
        ))}
      </ol>

      <Gamification />
    </>
  );
}

export default function HUD({ onOpenCabinet, onOpenRecords, glCanvas, onOpenProfile, onEditProfile }) {
  const { t, i18n } = useTranslation();
  const store = useStore();
  const { user } = useMe();
  const rootRef = useRef(null);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [amountStr, setAmountStr] = useState('1');
  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [prompt, setPrompt] = useState(false);
  const sound = useSyncExternalStore(
    audio.subscribe.bind(audio),
    audio.getSnapshot.bind(audio),
    audio.getSnapshot.bind(audio)
  );
  const [lastEvent, setLastEvent] = useState(null);

  // phone shell: burger menu + tap-to-expand panels, so the void itself
  // stays visible between them
  const narrow = useNarrow();
  const [menu, setMenu] = useState(false);
  const [massOpen, setMassOpen] = useState(false);
  const [burnOpen, setBurnOpen] = useState(false);

  // ARG: the UI stays crystal clean — all riddles live in the shadow layer
  // (console, headers, robots.txt, source); only secret reactions remain here
  const [custom, setCustom] = useState(false);
  // ARG: typing a secret fragment into the amount makes it react
  const [flicker3, setFlicker3] = useState(false);
  const [redFlash6, setRedFlash6] = useState(false);
  const lastFlick = useRef(0);
  const lastFlash = useRef(0);
  const glitch = useVoidGlitch();

  useEffect(() => {
    const v = String(amountStr || '');
    const now = Date.now();
    if (v.startsWith('3.') && now - lastFlick.current > 1500) {
      lastFlick.current = now;
      setFlicker3(true);
    }
    if (v.startsWith('6') && now - lastFlash.current > 2500) {
      lastFlash.current = now;
      setRedFlash6(true);
    }
  }, [amountStr]);

  useEffect(() => {
    if (!flicker3) return undefined;
    const id = setTimeout(() => setFlicker3(false), 750);
    return () => clearTimeout(id);
  }, [flicker3]);

  useEffect(() => {
    if (!redFlash6) return undefined;
    const id = setTimeout(() => setRedFlash6(false), 550);
    return () => clearTimeout(id);
  }, [redFlash6]);

  // signed-in donors sacrifice under their profile nick — prefill it once
  useEffect(() => {
    if (!user || name) return undefined;
    let dead = false;
    fetch('/api/profile/' + encodeURIComponent(user.name || ''), { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!dead && !name) setName((d && d.profile && d.profile.nick) || user.name || '');
      })
      .catch(() => {
        if (!dead && !name) setName(user.name || '');
      });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const amount = parseAmount(amountStr, 1);
  const secretId = detectSecret(amount);
  const tier = tierOf(amount);
  const previewColor = secretId ? SECRETS[secretId].color : TIERS[tier].color;
  const previewLabel = secretId
    ? `✨ ${secretName(secretId, i18n.language)}`
    : `${tierName(tier, i18n.language)} · T${tier}`;

  const fileUrlRef = useRef('');

  const pickFile = (f) => {
    if (!f) return;
    if (!f.type || !f.type.startsWith('image/')) {
      setErr(t('imageOnly'));
      return;
    }
    setErr('');
    setFile(f);
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    fileUrlRef.current = URL.createObjectURL(f);
    setFileUrl(fileUrlRef.current);
  };

  const clearFile = () => {
    setFile(null);
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    fileUrlRef.current = '';
    setFileUrl('');
  };

  useEffect(() => () => {
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
  }, []);

  const onDragOver = (e) => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    setDragOver(true);
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer?.files?.[0]);
  };

  // meteor storm shatters the HUD panels, then they reassemble
  useEffect(() => {
    const onShatter = () => {
      const root = rootRef.current;
      if (!root) return;
      const els = Array.from(root.querySelectorAll('[data-shard]'));
      els.forEach((el) => {
        el.classList.remove('fx-shard', 'fx-reassemble');
        el.style.setProperty('--tx', `${(Math.random() - 0.5) * 170}px`);
        el.style.setProperty('--ty', `${40 + Math.random() * 150}px`);
        el.style.setProperty('--rot', `${(Math.random() - 0.5) * 40}deg`);
        void el.offsetWidth;
        el.classList.add('fx-shard');
      });
      setTimeout(() => {
        els.forEach((el) => {
          el.classList.remove('fx-shard');
          el.classList.add('fx-reassemble');
        });
        setTimeout(() => {
          els.forEach((el) => el.classList.remove('fx-reassemble'));
        }, 500);
      }, 950);
    };
    window.addEventListener('void:shatter', onShatter);
    return () => window.removeEventListener('void:shatter', onShatter);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    // keyword eggs (rickroll, interstellar, bitcoin, 404…) ride a normal
    // paid throw now: the server stamps ev.egg and every client plays it
    if (!text.trim() && !file) return;
    setBusy(true);
    setErr('');
    try {
      const ev = await sendDestroy({
        text,
        name,
        amount,
        file,
        clientId: getClientId(),
        phase: store.stabilized ? 2 : 1,
      });
      setLastEvent(ev);
      setText('');
      clearFile();
      audio.playSuck();
      // phone: the burn sheet folds away so the effect owns the screen
      if (narrow) setBurnOpen(false);
      // guest mode: offer to keep the record after the impulse donation
      if (!user) setTimeout(() => setPrompt(true), 2600);
    } catch (e2) {
      // a failed throw wakes the core — one corrupted sector in the console
      emitVoidFragment();
      if (e2 && e2.reason === 'insufficient') {
        setState({ insufficient: { name: 'throw', cost: e2.cost, balance: e2.balance } });
      } else {
        setErr(t('error'));
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleSound = () => {
    const on = audio.toggle();
    localStorage.setItem('void_sound', on ? '1' : '0');
    // the mute button owns the whole bus: bring the radio with it
    if (on) armAutoplay();
    else pauseRadio();
  };

  const changeLang = (lng) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('void_lang', lng);
  };

  // the burn form is shared: the phone folds it into a sheet, the wider
  // layouts park it in the bottom-right corner as before
  const burnForm = (inSheet) => (
    <form
      onSubmit={submit}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`relative overflow-hidden p-4 transition ${
        inSheet
          ? 'rounded-none border-0 bg-transparent'
          : 'rounded-2xl border bg-black/50 backdrop-blur-md'
      } ${
        dragOver
          ? 'border-amber-400/80 ring-2 ring-amber-400/50 shadow-[0_0_28px_rgba(255,190,70,0.35)]'
          : inSheet
            ? ''
            : 'border-white/10'
      }`}
    >
      {glitch && (
        <div
          data-glitch="true"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-2xl void-glitch"
        >
          <div className="void-glitch-noise" />
          <div className="void-glitch-text">
            <span>
              DATA_CORRUPT @ 0x
              {Array.from({ length: 10 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('')}
            </span>
            <span>[V01D_FRACTURE]</span>
          </div>
        </div>
      )}
      {!inSheet && (
        <label className="block text-[10px] uppercase tracking-[0.25em] text-white/45 2xl:text-xs">
          {t('placeholder')}
        </label>
      )}
      <div className="relative mt-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={280}
          className="w-full resize-none rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-base text-white placeholder-white/30 outline-none focus:border-amber-400/50 sm:text-sm 2xl:text-base"
          placeholder={t('enterHint')}
        />
      </div>

      {fileUrl && (
        <div className="relative mt-2 overflow-hidden rounded-lg border border-white/15">
          <img
            src={fileUrl}
            alt=""
            className="h-28 w-full bg-black/60 object-contain"
          />
          <button
            type="button"
            onClick={clearFile}
            aria-label="remove image"
            className="absolute right-1.5 top-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white/25 bg-black/70 text-xs text-white/80 transition hover:border-red-400/70 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-base text-white placeholder-white/30 outline-none focus:border-amber-400/50 sm:text-sm 2xl:text-base"
          placeholder={t('namePlaceholder')}
        />
        <label
          title={file ? file.name : t('dropImage')}
          className={`flex cursor-pointer items-center justify-center rounded-lg border px-3.5 text-xs transition ${
            file
              ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
              : 'border-white/10 bg-black/50 text-white/60 hover:border-white/30 hover:text-white'
          }`}
        >
          {file ? '✓' : '+'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] || null)}
          />
        </label>
      </div>

      <div className="relative mt-3">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 font-mono text-xs font-bold text-white/45"
        >
          $
        </span>
        <input
          value={amountStr}
          onChange={(e) => {
            setAmountStr(e.target.value);
            setCustom(true);
          }}
          onBlur={() => {
            setAmountStr(String(parseAmount(amountStr, 1)));
          }}
          onFocus={() => {
            // an untouched default $1 clears on focus — just $ and cursor
            setAmountStr((s) => (s === '1' ? '' : s));
          }}
          inputMode="decimal"
          aria-label={t('amountLabel')}
          placeholder={t('customAmount')}
          className={`w-full rounded-full border bg-black/60 py-2 pl-7 pr-3 text-right font-mono text-[16px] font-bold text-white placeholder-white/30 outline-none focus:border-amber-400/60 sm:py-1.5 sm:text-xs ${
            custom ? 'border-white/20' : 'border-amber-400/55 shadow-[0_0_10px_rgba(255,190,70,0.15)]'
          }${flicker3 ? ' void-flicker' : ''}`}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {[1, 3, 5, 10, 25, 50, 100].map((v) => (
          <button
            type="button"
            key={v}
            onClick={() => {
              setAmountStr(String(v));
              setCustom(false);
            }}
            className={`cursor-pointer rounded-full border px-2.5 py-1.5 text-xs font-bold transition sm:py-1 ${
              !custom && amount === v
                ? 'border-amber-400/80 bg-amber-500/25 text-amber-100'
                : 'border-white/12 text-white/50 hover:border-white/30'
            }`}
          >
            ${v}
          </button>
        ))}
        <span
          className="ml-auto truncate text-[10px] font-black uppercase tracking-widest"
          style={{ color: previewColor }}
          title={t('amountLabel')}
        >
          {previewLabel}
        </span>
      </div>

      {err && <div className="mt-2 text-xs text-red-400">{err}</div>}

      <button
        type="submit"
        disabled={busy || (!text.trim() && !file)}
        className="mt-3 w-full cursor-pointer rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-fuchsia-600 px-4 py-3.5 text-sm font-black uppercase tracking-[0.2em] text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 sm:py-3 2xl:py-4 2xl:text-base"
      >
        {busy ? t('burning') : t('burn')}
      </button>

      {lastEvent && !busy && (
        <button
          type="button"
          onClick={() => downloadShareCard(glCanvas, lastEvent, store.mass)}
          className="mt-2 w-full cursor-pointer rounded-xl border border-white/15 px-4 py-2.5 text-xs uppercase tracking-widest text-white/70 transition hover:border-white/40 hover:text-white sm:py-2"
        >
          {t('downloadCard')} ↓
        </button>
      )}

      <p className="mt-2 text-center text-[9px] uppercase tracking-[0.2em] text-white/25">
        {t('dropImage')}
      </p>
    </form>
  );

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-20 select-none text-white">
      {redFlash6 && (
        <div className="pointer-events-none absolute inset-0 void-redflash" aria-hidden="true" />
      )}
      {/* top bar */}
      <div data-shard className="pointer-events-auto absolute left-0 right-0 top-0 flex items-start justify-between gap-2 p-3 sm:gap-3 sm:p-4 md:p-6 2xl:p-10">
        <div className="min-w-0">
          <h1 className="whitespace-nowrap text-[11px] font-black uppercase leading-none tracking-[0.16em] text-white/90 sm:text-sm sm:tracking-[0.24em] lg:text-xl lg:tracking-[0.3em] 2xl:text-3xl">
            {t('title')}
          </h1>
          <p className="mt-1 hidden text-[11px] uppercase tracking-[0.22em] text-white/45 lg:block 2xl:text-sm">
            {t('tagline')}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-widest text-emerald-300/70 sm:mt-2 2xl:text-xs">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            {store.online} {t('online')}
          </div>
          {/* ARG meta-puzzle: a fragment of the hidden phrase fades in with
              the tail of each secret animation — strictly under the status */}
          {store.fragment ? (
            <div
              data-fragment
              className="mt-1"
              style={{
                fontFamily: 'monospace, ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '11px',
                letterSpacing: '2px',
                color: 'rgba(165,180,252,0.72)',
                textShadow:
                  '0 0 6px rgba(134,239,172,0.35), 0 0 14px rgba(167,139,250,0.6)',
              }}
            >
              {fragmentText(store.fragment)}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {/* internal wallet: balance + instant top-up (count-down on spends) */}
          <button
            onClick={() => openDeposit(500)}
            title={t('depositTitle')}
            className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-full border border-emerald-400/25 bg-black/50 px-2.5 py-1.5 backdrop-blur transition hover:border-emerald-400/60 sm:px-3 2xl:px-4 2xl:py-2.5"
          >
            <span className="hidden text-[10px] uppercase tracking-widest text-white/45 md:inline 2xl:text-xs">
              {t('balance')}
            </span>
            <span className="font-mono text-[12px] font-bold text-emerald-300 2xl:text-sm">
              {/* balance lives in cents, the odometer reads dollars */}
              $<Odometer value={store.balance / 100} />
            </span>
            <span className="text-[11px] font-black leading-none text-emerald-300">＋</span>
          </button>

          {/* sign-in / profile joins the burger menu on phones */}
          <div className="hidden sm:block">
            <AuthControls onEditProfile={onEditProfile} />
          </div>
          <select
            aria-label={t('language')}
            value={i18n.language}
            onChange={(e) => changeLang(e.target.value)}
            className="pointer-events-auto hidden cursor-pointer rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-[11px] uppercase tracking-widest text-white/70 backdrop-blur outline-none hover:border-white/35 sm:block 2xl:px-4 2xl:py-2 2xl:text-xs"
          >
            {LANG_OPTIONS.map((l) => (
              <option key={l} value={l} className="bg-black">
                {l.toUpperCase()}
              </option>
            ))}
          </select>

          <button
            onClick={toggleSound}
            title={sound ? t('soundOff') : t('soundOn')}
            className="pointer-events-auto hidden cursor-pointer rounded-full border border-white/15 bg-black/50 p-2 text-white/70 backdrop-blur transition hover:border-white/40 hover:text-white sm:block 2xl:p-2.5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5 6 9H2v6h4l5 4V5z" />
              {sound ? (
                <>
                  <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                  <path d="M18.5 5.5a9 9 0 0 1 0 13" />
                </>
              ) : (
                <path d="m17 9 4 6M21 9l-4 6" />
              )}
            </svg>
          </button>

          <button
            onClick={onOpenCabinet}
            className="pointer-events-auto hidden cursor-pointer rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-[11px] uppercase tracking-widest text-white/70 backdrop-blur transition hover:border-white/40 hover:text-white sm:block 2xl:px-4 2xl:py-2.5"
          >
            <span className="hidden lg:inline">{t('cabinet')}</span>
            <span className="lg:hidden">☰</span>
          </button>

          {/* burger: the whole secondary UI collapses here on phones */}
          <button
            onClick={() => setMenu(true)}
            aria-label="Menu"
            className="pointer-events-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/75 backdrop-blur transition hover:border-white/40 hover:text-white sm:hidden"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* burger sheet */}
      {menu && (
        <div className="pointer-events-auto fixed inset-0 z-40 flex flex-col bg-black/90 backdrop-blur-xl sm:hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-[11px] font-black uppercase tracking-[0.3em] text-white/80">
              ☰ {t('title')}
            </span>
            <button
              onClick={() => setMenu(false)}
              aria-label={t('close')}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/15 text-white/70 transition hover:border-white/40 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="space-y-2 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              onClick={() => {
                setMenu(false);
                onOpenCabinet();
              }}
              className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-white/12 bg-white/[0.05] px-4 py-4 text-left text-sm font-bold uppercase tracking-[0.2em] text-white/85 transition hover:border-amber-400/40"
            >
              {t('cabinet')} <span className="text-amber-300/70">▸</span>
            </button>
            <button
              onClick={() => {
                setMenu(false);
                onOpenRecords();
              }}
              className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-white/12 bg-white/[0.05] px-4 py-4 text-left text-sm font-bold uppercase tracking-[0.2em] text-white/85 transition hover:border-amber-400/40"
            >
              {t('leaderboard')} <span className="text-amber-300/70">▸</span>
            </button>
            <label className="block cursor-pointer rounded-xl border border-white/12 bg-white/[0.05] px-4 py-3">
              <span className="text-[10px] uppercase tracking-[0.25em] text-white/45">
                {t('language')}
              </span>
              <select
                aria-label={t('language')}
                value={i18n.language}
                onChange={(e) => changeLang(e.target.value)}
                className="mt-1 w-full cursor-pointer bg-transparent text-base uppercase tracking-widest text-white/85 outline-none"
              >
                {LANG_OPTIONS.map((l) => (
                  <option key={l} value={l} className="bg-black">
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={toggleSound}
              className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-white/12 bg-white/[0.05] px-4 py-4 text-left text-sm font-bold uppercase tracking-[0.2em] text-white/85 transition hover:border-white/30"
            >
              {sound ? t('soundOff') : t('soundOn')}
              <span className="text-white/50">{sound ? '🔊' : '🔇'}</span>
            </button>
          </div>
        </div>
      )}

      {/* cosmic radio: right under the top-bar buttons */}
      <MusicPlayer />

      {/* mass + leaderboard: pill on phones, card on wider screens */}
      {narrow ? (
        <div data-shard className="pointer-events-auto absolute left-2 top-[58px] z-30">
          {massOpen ? (
            <div className="max-h-[54dvh] w-[min(94vw,420px)] overflow-y-auto rounded-2xl border border-white/10 bg-black/70 p-3 backdrop-blur-md">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-[0.3em] text-white/45">
                  {t('massLabel')}
                </div>
                <button
                  onClick={() => setMassOpen(false)}
                  aria-label={t('close')}
                  className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/15 text-xs text-white/60 transition hover:border-white/40 hover:text-white"
                >
                  ✕
                </button>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-black text-amber-300 drop-shadow-[0_0_18px_rgba(255,170,60,0.55)]">
                  <Odometer value={store.mass} />
                </span>
                <span className="text-sm font-bold text-amber-200/60">M☉</span>
              </div>
              <MassBody
                store={store}
                t={t}
                onOpenRecords={onOpenRecords}
                onOpenProfile={onOpenProfile}
              />
            </div>
          ) : (
            <button
              onClick={() => setMassOpen(true)}
              className="flex cursor-pointer items-center gap-2 rounded-full border border-amber-400/25 bg-black/65 py-2 pl-3 pr-2.5 backdrop-blur transition hover:border-amber-400/50"
            >
              <span className="text-[9px] uppercase tracking-[0.22em] text-white/50">
                {t('massLabel')}
              </span>
              <span className="font-mono text-sm font-black text-amber-300 drop-shadow-[0_0_12px_rgba(255,170,60,0.5)]">
                <Odometer value={store.mass} />
              </span>
              <span className="text-xs font-bold text-amber-200/60">M☉</span>
              <span className="text-[10px] text-white/45">▾</span>
            </button>
          )}
        </div>
      ) : (
        <div data-shard className="pointer-events-auto absolute left-0 top-[132px] w-full p-4 sm:bottom-0 sm:top-auto sm:max-h-[86dvh] sm:max-w-[38vw] sm:overflow-y-auto sm:p-6 lg:max-w-[420px] 2xl:p-10">
          <div className="rounded-2xl border border-white/10 bg-black/45 p-3 backdrop-blur-md sm:p-4 2xl:p-6">
            <div className="text-[10px] uppercase tracking-[0.3em] text-white/45 2xl:text-xs">
              {t('massLabel')}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-black text-amber-300 drop-shadow-[0_0_18px_rgba(255,170,60,0.55)] sm:text-5xl 2xl:text-6xl">
                <Odometer value={store.mass} />
              </span>
              <span className="text-sm font-bold text-amber-200/60 2xl:text-base">M☉</span>
            </div>
            <MassBody
              store={store}
              t={t}
              onOpenRecords={onOpenRecords}
              onOpenProfile={onOpenProfile}
            />
          </div>
        </div>
      )}

      {/* throw form: bottom sheet on phones, corner panel from sm up */}
      {narrow ? (
        store.stabilized ? (
          <div
            data-shard
            className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            <div className="max-h-[60dvh] overflow-y-auto">
              <StabilizedPanel />
            </div>
          </div>
        ) : (
          <div
            data-shard
            className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            {burnOpen ? (
              <div className="max-h-[74dvh] overflow-y-auto rounded-2xl border border-white/10 bg-black/70 backdrop-blur-md">
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-white/10 bg-black/85 px-4 py-2.5">
                  <span className="min-w-0 truncate text-[10px] uppercase tracking-[0.25em] text-white/55">
                    {t('placeholder')}
                  </span>
                  <button
                    onClick={() => setBurnOpen(false)}
                    aria-label={t('close')}
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/15 text-white/70 transition hover:border-white/40 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
                {burnForm(true)}
              </div>
            ) : (
              <button
                onClick={() => setBurnOpen(true)}
                className="w-full cursor-pointer rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-fuchsia-600 px-4 py-4 text-sm font-black uppercase tracking-[0.22em] text-black shadow-[0_10px_30px_rgba(0,0,0,0.45)] transition active:brightness-110"
              >
                ＋ {t('burn')}
              </button>
            )}
          </div>
        )
      ) : (
        <div data-shard className="pointer-events-auto absolute bottom-0 right-0 w-full p-3 sm:max-h-[calc(100dvh-5.5rem)] sm:max-w-[50vw] sm:overflow-y-auto sm:p-4 md:p-6 lg:max-w-[440px] 2xl:p-10">
          {store.stabilized ? <StabilizedPanel /> : burnForm(false)}
        </div>
      )}

      {/* recent ticker */}
      <div data-shard className="pointer-events-none absolute bottom-5 left-1/2 hidden w-[320px] -translate-x-1/2 xl:block">
        <div className="rounded-2xl border border-amber-300/20 bg-black/75 px-3.5 py-2.5 shadow-[0_10px_40px_rgba(0,0,0,0.75)] backdrop-blur-md">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.28em] text-amber-200/80">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(255,180,60,0.9)]" />
            {t('recent')}
          </div>
          <div className="mt-1.5 space-y-1">
            {store.events.slice(0, 3).map((e) => (
              <div
                key={e.id}
                className="truncate text-[12px] leading-tight text-white/80 [text-shadow:0_1px_6px_rgba(0,0,0,0.95)]"
              >
                <span className="font-semibold text-amber-300">{e.name}</span>
                <span className="mx-1 text-white/30">→</span>
                <span className="text-white/65">{(e.text || 'image').slice(0, 40)}</span>
              </div>
            ))}
            {store.events.length === 0 && (
              <div className="text-[12px] text-white/45">{t('noRecent')}</div>
            )}
          </div>
        </div>
      </div>

      <AuthPrompt open={prompt} onClose={() => setPrompt(false)} />
    </div>
  );
}
