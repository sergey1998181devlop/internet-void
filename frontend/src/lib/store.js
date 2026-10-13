import { useSyncExternalStore } from 'react';
import { fxOf, fxPriority } from './tiers';

// 1$ of sacrifice = 0.01 M☉ (mirrors MASS_PER_DOLLAR on the backend)
export const MASS_PER_DOLLAR = 0.01;

export const fmtMass = (n) =>
  Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const TIER_FX_CAP = 12;

let state = {
  mass: 0,
  events: [],
  leaderboard: [],
  // three public boards (top 100 each): all-time, current UTC day, biggest
  // single sacrifice. `leaderboard` mirrors boards.all for older call sites
  boards: { all: [], day: [], single: [] },
  online: 0,
  queue: [],
  flash: 0,
  banner: null,
  connected: false,
  myEvents: [],
  // one active bitcoin easter egg at a time
  coin: null,
  // pending tier/secret celebrations (TierOverlay consumes them)
  tierFx: [],
  // ARG priority: bumped by startBigBang — the bang owns the screen alone
  bangStamp: 0,
  // gamification (dynamic piggy target: level ×2.0 from $20, server-driven)
  piggy: 0,
  piggyTarget: 20,
  piggyLevel: 1,
  combo: { sum: 0, count: 0, ts: 0 },
  // last divine-tier sponsor (persistent badge for the session)
  sponsor: null,
  // internal wallet: balance in cents + modal flags
  balance: 0,
  depositOpen: false,
  depositPreset: 0,
  insufficient: null,
  // cosmic radio: the open state lives in the store so the HUD can close
  // the player when the mass panel expands (phones: one panel at a time)
  playerOpen: false,
  // ARG phase 1: a fragment of the hidden phrase (null = nothing shown)
  fragment: null,
  // ARG phase 1 solved: the void runs the stabilized (ultramarine) version
  stabilized: false,
  // share recording pins the level of the replayed sacrifice (0 = none)
  recordPhase: 0,
  observer: 0,
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// keep the legacy `leaderboard` array in sync with boards.all
export function setBoards(boards) {
  const b = {
    all: (boards && boards.all) || [],
    day: (boards && boards.day) || [],
    single: (boards && boards.single) || [],
  };
  setState({ boards: b, leaderboard: b.all });
}

export function useStore() {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function enqueueEvent(ev) {
  const fx = fxOf(ev);
  // tier & secret events own the screen (TierOverlay), legacy gamma banner
  // only stays for events that predate the tier system
  const legacy = ev.premium && !fx;
  const tierFx = fx ? pushTierFx(state.tierFx, fx) : state.tierFx;
  setState({
    events: [ev, ...state.events].slice(0, 40),
    queue: [...state.queue, ev],
    mass: typeof ev.mass === 'number' ? ev.mass : state.mass,
    banner: legacy
      ? { id: ev.id, name: ev.name, text: ev.text, link: ev.text }
      : state.banner,
    flash: legacy ? 1.25 : state.flash,
    tierFx,
    myEvents:
      ev.clientId && ev.clientId === getClientId()
        ? [{ ...ev, status: 'burned' }, ...state.myEvents]
        : state.myEvents,
  });
}

function pushTierFx(queue, fx) {
  const next = [...queue, fx];
  if (next.length <= TIER_FX_CAP) return next;
  // drop the lowest-priority oldest entries first
  const sorted = next
    .map((f, i) => ({ f, i }))
    .sort((a, b) => fxPriority(a.f) - fxPriority(b.f) || a.i - b.i);
  const drop = new Set(sorted.slice(0, next.length - TIER_FX_CAP).map((x) => x.i));
  return next.filter((_, i) => !drop.has(i));
}

// queue a hand-made fx (piggy/combo bursts, test hooks)
export function bumpTierFx(fx) {
  return pushTierFx(state.tierFx, fx);
}

// takes the highest-priority queued fx; returns null if nothing outranks `activePriority`
export function takeTierFx(activePriority = -1) {
  const queue = state.tierFx;
  if (!queue.length) return null;
  let best = 0;
  for (let i = 1; i < queue.length; i++) {
    if (fxPriority(queue[i]) > fxPriority(queue[best])) best = i;
  }
  if (activePriority >= 0 && fxPriority(queue[best]) <= activePriority) return null;
  const fx = queue[best];
  setState({ tierFx: queue.filter((_, i) => i !== best) });
  return fx;
}

export function consumeQueue(n) {
  if (state.queue.length === 0) return;
  setState({ queue: state.queue.slice(n) });
}

export function clearFlash() {
  if (state.flash > 0) setState({ flash: 0 });
}

export function clearBanner() {
  if (state.banner) setState({ banner: null });
}

export function addMyEvent(ev) {
  setState({ myEvents: [ev, ...state.myEvents].slice(0, 100) });
}

export function getClientId() {
  let id = localStorage.getItem('void_client_id');
  if (!id) {
    id = 'v_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('void_client_id', id);
  }
  return id;
}
