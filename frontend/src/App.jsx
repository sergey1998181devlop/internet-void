import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
// first import on purpose: parks the ?qa= token and scrubs it from the URL
import { qaPing, qaToken } from './lib/qa';
import BlackHole from './scene/BlackHole';
import VoidObjects from './scene/VoidObjects';
import Coin from './scene/Coin';
import Rocket from './scene/Rocket';
import RickrollNotes from './scene/RickrollNotes';
import Burst from './scene/Burst';
import DissolveParticles from './scene/DissolveParticles';
import StabilizedRelic from './scene/StabilizedRelic';
import HUD from './components/HUD';
import FlashOverlay from './components/FlashOverlay';
import GammaBanner from './components/GammaBanner';
import Cabinet from './components/Cabinet';
import ShareModal from './components/ShareModal';
import Leaderboard from './components/Leaderboard';
import TestPanel from './components/TestPanel';
import GlitchOverlay from './components/GlitchOverlay';
import SecretOverlay from './components/SecretOverlay';
import BigBangOverlay from './components/BigBangOverlay';
import InterstellarOverlay from './components/InterstellarOverlay';
import TierOverlay from './components/TierOverlay';
import FeedTicker from './components/FeedTicker';
import ProfileDrawer from './components/ProfileDrawer';
import ProfileEdit from './components/ProfileEdit';
import WalletModals from './components/WalletModals';
import LegalFooter from './components/LegalFooter';
import TopupBanner from './components/TopupBanner';
import { useStore, consumeQueue, getClientId, getState, enqueueEvent } from './lib/store';
import { handleAuthCallback } from './auth';
import { orbit } from './scene/orbit';
import { audio } from './audio/AudioEngine';
import { getMusic, getMusicDebug } from './lib/music';
import useClickSecrets from './lib/useClickSecrets';
import useGestures from './lib/useGestures';
import { payThenFire, requestEffect } from './lib/wallet';
import { startBigBang, effects, triggerBitcoin, triggerGlitch } from './lib/effects';
import { startRickroll } from './lib/rickroll';
import { startInterstellar } from './lib/interstellar';
import './lib/socket';
import { initVoidCore } from './lib/hints';
import { bootStabilized } from './lib/stabilize';

initVoidCore();

// debug slow motion (software-GL screenshot runs): /?slow=0.15
{
  const slow = Number(new URLSearchParams(window.location.search).get('slow'));
  if (slow > 0 && slow <= 1) effects.ts = slow;
}

export default function App() {
  const store = useStore();
  const [cabinet, setCabinet] = useState(false);
  const [shareEvent, setShareEvent] = useState(null);
  const [records, setRecords] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [editProfile, setEditProfile] = useState(false);
  // QA panel: only a link with a live ?qa=<token> turns this on
  const [qa, setQa] = useState(false);
  const massRef = useRef(0);
  // a share recording may pin the level of the sacrifice it is replaying
  const showRelic = store.recordPhase ? store.recordPhase === 2 : store.stabilized;
  const glCanvas = useRef(null);

  // spam-clicking the void: 10 left clicks overheat it, 5 right clicks invert it
  useClickSecrets();
  // held-button drawing (shake / circles / infinity), centre dwell, AFK
  useGestures();

  useEffect(() => {
    massRef.current = store.mass;
  }, [store.mass]);

  // Google OAuth callback (/?auth=ok) -> claim guest history -> load profile
  useEffect(() => {
    handleAuthCallback(getClientId());
  }, []);

  // QA panel: the token travels only in the tester's link, and the backend
  // has the last word on whether it is live
  useEffect(() => {
    let alive = true;
    qaPing().then((on) => {
      if (alive) setQa(on);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ARG phase 1: restore the stabilized void (localStorage + server record)
  useEffect(() => {
    bootStabilized();
  }, []);

  // local preview of the global event: /?bang=1
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('bang')) {
      const id = setTimeout(() => startBigBang(1, { milestone: 1000 }), 700);
      return () => clearTimeout(id);
    }
    return undefined;
  }, []);

  // spatial audio: pan + drag follows how the camera swings around the horizon
  useEffect(() => {
    window.__voidAudio = audio;
    window.__music = getMusic;
    window.__musicDebug = getMusicDebug;
    window.__effects = effects;
    window.__getState = getState;
    // paid-effect entry point (keyword eggs fire from ev.egg on paid throws)
    window.__wallet = { payThenFire, requestEffect };
    // QA-only: drop a card straight into the queue (no backend donation) —
    // installed only after the backend confirms the ?qa= token is live
    let cardAlive = true;
    qaPing().then((on) => {
      if (!on || !cardAlive) return;
      window.__voidCard = (text, opts = {}) =>
        enqueueEvent({
          id: 'hook-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          text: String(text ?? ''),
          name: opts.name || 'Tester',
          amount: Number(opts.amount) || 1,
          tier: Number(opts.tier) || 1,
          secret: null,
          imageUrl: opts.imageUrl || null,
          kind: opts.imageUrl ? 'image' : 'text',
          premium: false,
          clientId: getClientId(),
          ts: Date.now(),
        });
    });
    let raf;
    const loop = () => {
      audio.setPan(Math.sin(orbit.theta) * 0.75);
      audio.setMotion(orbit.vel);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cardAlive = false;
      cancelAnimationFrame(raf);
      delete window.__voidCard;
    };
  }, []);

  // unlock the ambient drone on the first user gesture (browser autoplay policy)
  useEffect(() => {
    if (localStorage.getItem('void_sound') === '0') return;
    const unlock = () => {
      audio.enable();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // ARG: the R key answers with a quiet vinyl tick (unless a field is focused)
  useEffect(() => {
    const onR = (e) => {
      const el = document.activeElement;
      const tag = el ? String(el.tagName || '').toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (el && el.isContentEditable)) return;
      if (e.key && e.key.toLowerCase() === 'r' && !e.repeat) audio.playTick();
    };
    window.addEventListener('keydown', onR);
    return () => window.removeEventListener('keydown', onR);
  }, []);

  // ARG free triggers stay STRICTLY LOCAL: rickroll, local bang, interstellar,
  // bitcoin, glitch — the person mashing the key only breaks their own
  // screen, the other 1000 viewers never see it (the QA panel owns these keys
  // in a QA session, so this listener stands down there)
  useEffect(() => {
    if (qa) return undefined;
    const onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      const tag = el ? String(el.tagName || '').toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (el && el.isContentEditable)) return;
      const k = String(e.key || '').toLowerCase();
      if (k === 'r') startRickroll();
      else if (k === 'b') {
        if (effects.bangState === 'idle') startBigBang(0, { milestone: 0 });
      } else if (e.key === '4') startInterstellar({ name: 'Anonymous' });
      else if (e.key === '5') triggerBitcoin();
      else if (e.key === '6') triggerGlitch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [qa]);

  return (
    <div id="void-root" className="relative h-full w-full overflow-hidden bg-black">
      <Canvas
        className="absolute inset-0"
        dpr={[1, 1.5]}
        camera={{ fov: 55, near: 0.1, far: 300, position: [0, 5.9, 21.5] }}
        gl={{
          antialias: false,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: true,
        }}
        onCreated={({ gl }) => {
          gl.setClearColor('#000000', 1);
          glCanvas.current = gl.domElement;
        }}
      >
        <BlackHole massRef={massRef} />
        <VoidObjects queue={store.queue} onConsumed={consumeQueue} />
        <Coin />
        <Suspense fallback={null}>
          <Rocket />
        </Suspense>
        <RickrollNotes />
        <Burst />
        <DissolveParticles />
        {showRelic && <StabilizedRelic />}
      </Canvas>

      <HUD
        onOpenCabinet={() => setCabinet(true)}
        onOpenRecords={() => setRecords(true)}
        glCanvas={glCanvas}
        onOpenProfile={setProfileName}
        onEditProfile={() => setEditProfile(true)}
      />
      {qa && <TestPanel />}
      <TierOverlay />
      <FeedTicker />
      <FlashOverlay />
      <GammaBanner />
      <GlitchOverlay />
      <SecretOverlay />
      <BigBangOverlay />
      <InterstellarOverlay />
      <Cabinet
        open={cabinet}
        onClose={() => setCabinet(false)}
        onShare={(ev) => {
          setCabinet(false);
          setShareEvent(ev);
        }}
      />
      <ShareModal
        event={shareEvent}
        glCanvas={glCanvas}
        onClose={() => setShareEvent(null)}
        onBack={() => {
          setShareEvent(null);
          setCabinet(true);
        }}
      />
      <Leaderboard
        open={records}
        onClose={() => setRecords(false)}
        onOpenProfile={setProfileName}
      />
      <ProfileDrawer name={profileName} onClose={() => setProfileName('')} />
      <ProfileEdit open={editProfile} onClose={() => setEditProfile(false)} />
      <WalletModals />
      <TopupBanner />
      <LegalFooter />
    </div>
  );
}
