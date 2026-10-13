import { io } from 'socket.io-client';
import { setState, setBoards, enqueueEvent, getState, addMyEvent, bumpTierFx, getClientId } from './store';
import { fireEasterEgg, startBigBang } from './effects';
import { startInterstellar } from './interstellar';
import { startRickroll } from './rickroll';
import { onArgSolved } from './stabilize';

export const socket = io('/', {
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  autoConnect: true,
  reconnection: true,
  // lets the server resolve an anonymous wallet before a session exists
  auth: { clientId: getClientId() },
});

socket.on('connect', () => setState({ connected: true }));
socket.on('disconnect', () => setState({ connected: false }));

// --- wallet: cents, server-authoritative ------------------------------------
socket.on('wallet_state', (d) => setState({ balance: Number(d && d.balance) || 0 }));
socket.on('balance_update', (d) => setState({ balance: Number(d && d.balance) || 0 }));

socket.on('init', (data) => {
  setState({
    mass: data.mass || 0,
    events: data.events || [],
    online: data.online || 0,
    piggy: Number(data.piggy) || 0,
    piggyTarget: Number(data.piggyTarget) || 20,
    piggyLevel: Number(data.piggyLevel) || 1,
  });
  setBoards(data.boards || { all: data.leaderboard || [], day: [], single: [] });
});

// re-sent (coalesced) after every sacrifice
socket.on('boards_update', (boards) => setBoards(boards));

socket.on('mass_update', (d) => setState({ mass: d.mass }));

socket.on('presence', (d) => setState({ online: d.online }));

// global event: scheduled against the server's absolute wall clock. A client
// that handles the packet late (busy main thread, slow network) still starts
// every phase at the same instant as everyone else — the lead is simply eaten.
socket.on('big_bang', (ev) => {
  const at = Number(ev && ev.at) || 0;
  if (!at) return;
  const delay = Math.min(15, Math.max(-5, (at - Date.now()) / 1000));
  startBigBang(delay, ev || {});
});

socket.on('new_void_event', (ev) => {
  enqueueEvent(ev);
  // the server attaches ev.egg to PAID keyword sacrifices only — free QA
  // throws (test=1) arrive with egg: null and stay silent
  const egg = (ev && ev.egg) || null;
  if (egg === 'interstellar') startInterstellar(ev); // donor name lives on the event
  else if (egg === 'rickroll') startRickroll(); // gated by its own cooldown
  else if (egg) fireEasterEgg(egg);
  if (ev.premium) {
    setTimeout(() => {
      const b = getState().banner;
      if (b && b.id === ev.id) setState({ banner: null });
    }, 6000);
  }
});

// --- gamification: piggy bank + combo window --------------------------------
socket.on('piggy_update', (d) => {
  const st = { piggy: Number(d && d.value) || 0 };
  if (d && Number(d.target) > 0) st.piggyTarget = Number(d.target);
  if (d && Number(d.level) > 0) st.piggyLevel = Number(d.level);
  setState(st);
});

socket.on('piggy_burst', (d) => {
  const st = { piggy: Number(d && d.value) || 0 };
  if (d && Number(d.target) > 0) st.piggyTarget = Number(d.target);
  if (d && Number(d.level) > 0) st.piggyLevel = Number(d.level);
  setState({
    ...st,
    tierFx: bumpTierFx({
      id: 'piggy-' + Date.now(),
      kind: 'tier',
      tier: 4,
      amount: Number(d && d.total) || 10,
      name: (d && d.name) || 'PIGGY BANK',
      text: (d && d.text) || '',
      burst: 'piggy',
      ts: Date.now(),
    }),
  });
});

socket.on('combo_update', (d) => {
  setState({
    combo: {
      sum: Number(d && d.sum) || 0,
      count: Number(d && d.count) || 0,
      ts: Number(d && d.ts) || Date.now(),
    },
  });
});

socket.on('combo_burst', (d) => {
  setState({
    combo: { sum: 0, count: 0, ts: 0 },
    tierFx: bumpTierFx({
      id: 'combo-' + Date.now(),
      kind: 'tier',
      tier: 4,
      amount: Number(d && d.sum) || 10,
      name: (d && d.name) || 'COMBO',
      text: (d && d.text) || '',
      burst: 'combo',
      count: Number(d && d.count) || 0,
      ts: Date.now(),
    }),
  });
});

export async function sendDestroy({ text, name, amount, file, clientId, test, phase, qa }) {
  const fd = new FormData();
  fd.append('text', text || '');
  fd.append('name', name || '');
  fd.append('amount', String(amount || 1));
  fd.append('clientId', clientId);
  // which level of the void is doing the burning — a shared clip replays it there
  fd.append('phase', String(phase === 2 ? 2 : 1));
  // QA harness (TestPanel): simulated sacrifice, never charged — the server
  // honours the flag only for a request carrying the live QA token
  if (test) {
    fd.append('test', '1');
    if (qa) fd.append('qa', qa);
  }
  if (file) fd.append('file', file);

  const res = await fetch('/api/destroy', { method: 'POST', body: fd });
  if (res.status === 402) {
    const d = await res.json().catch(() => ({}));
    const err = new Error('insufficient');
    err.reason = 'insufficient';
    err.cost = d.cost || 0;
    err.balance = d.balance || 0;
    throw err;
  }
  if (!res.ok) throw new Error('destroy_failed');
  const data = await res.json();
  if (typeof data.balance === 'number') setState({ balance: data.balance });
  addMyEvent({ ...data.event, status: 'burned' });
  // ARG phase 1: ENTROPY answered — run the emissive dissolve transition
  if (data.arg_solved) onArgSolved(data);
  return data.event;
}

export async function fetchMyEvents(clientId) {
  try {
    const res = await fetch('/api/my/' + encodeURIComponent(clientId));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
