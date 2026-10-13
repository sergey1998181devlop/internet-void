import { useSyncExternalStore } from 'react';

let me = null;
let loading = true;
// stable reference: useSyncExternalStore compares snapshots with Object.is
let snap = { user: null, loading: true };
const listeners = new Set();

let authStatus = null;
let statusPromise = null;

export function useAuthStatus() {
  return authStatus;
}

export function loadAuthStatus() {
  if (statusPromise) return statusPromise;
  statusPromise = fetch('/api/auth/status', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((d) => {
      authStatus = d;
      emit();
      return d;
    })
    .catch(() => ({ google: false, ethereum: false }));
  return statusPromise;
}

function emit() {
  snap = { user: me, loading };
  listeners.forEach((l) => l());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function snapshot() {
  return snap;
}

export function useMe() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export async function refreshMe() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    const data = await res.json();
    me = data.user || null;
  } catch {
    me = null;
  }
  loading = false;
  emit();
  return me;
}

export function signInGoogle() {
  window.location.href = '/api/auth/google';
}

export async function signInEthereum() {
  const ethereum = window.ethereum;
  if (!ethereum) throw new Error('no_wallet');

  const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
  const address = accounts?.[0];
  if (!address) throw new Error('no_account');

  const nonceRes = await fetch(
    '/api/auth/ethereum/nonce?address=' + encodeURIComponent(address),
    { credentials: 'same-origin' }
  );
  if (!nonceRes.ok) throw new Error('nonce_failed');
  const { message } = await nonceRes.json();

  const signature = await ethereum.request({
    method: 'personal_sign',
    params: [message, address],
  });

  const res = await fetch('/api/auth/ethereum', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ address, signature }),
  });
  if (!res.ok) throw new Error('verify_failed');
  return refreshMe();
}

export async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } finally {
    me = null;
    emit();
  }
}

export async function claimGuest(clientId) {
  if (!clientId) return null;
  try {
    await fetch('/api/auth/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ clientId }),
    });
  } catch {
    /* non-fatal */
  }
  return refreshMe();
}

// called once on boot: handles /api/auth/google/callback -> /?auth=ok
export async function handleAuthCallback(clientId) {
  const url = new URL(window.location.href);
  const flag = url.searchParams.get('auth');
  if (!flag) return refreshMe();

  url.searchParams.delete('auth');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);

  if (flag === 'ok') await claimGuest(clientId);
  await refreshMe();
  return flag;
}
