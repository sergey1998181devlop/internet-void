import { socket } from './socket';
import { setState, getClientId } from './store';

// ---------------------------------------------------------------------------
// Wallet client: the ONLY way an effect plays is a server `effect` command —
// the server checks the balance, spends atomically and acks with the new
// balance. Free paths (ripples, tier FX from other people's donations) skip
// this entirely.
// ---------------------------------------------------------------------------

// guests identify themselves with the anonymous client id; a session cookie
// always wins server-side, so it is safe to send along either way
const ownerQs = () => 'clientId=' + encodeURIComponent(getClientId());

export function requestEffect(name, amount) {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) return resolve({ ok: false, reason: 'offline' });
    socket.timeout(4000).emit('effect', { name, amount }, (err, ack) => {
      if (err) return resolve({ ok: false, reason: 'timeout' });
      const a = ack || { ok: false, reason: 'no_ack' };
      if (typeof a.balance === 'number') setState({ balance: a.balance });
      resolve(a);
    });
  });
}

// spend first, play only on success; an empty wallet opens the top-up prompt.
// `amount` is only used by effects priced by the typed sum (rickroll: any
// amount works, the keyword is what triggers the show).
export async function payThenFire(name, fireFn, amount) {
  const r = await requestEffect(name, amount);
  if (r.ok) {
    if (typeof fireFn === 'function') fireFn();
    return true;
  }
  if (r.reason === 'insufficient') {
    setState({ insufficient: { name, cost: r.cost || 0, balance: r.balance || 0 } });
  }
  return false;
}

export async function fetchBalance() {
  try {
    const res = await fetch('/api/v1/wallet/balance?' + ownerQs(), { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.balance === 'number') setState({ balance: data.balance });
    return data;
  } catch {
    return null;
  }
}

export async function deposit(amountCents, clientId) {
  const res = await fetch('/api/v1/wallet/deposit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ amountCents, clientId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'deposit_failed');
  if (typeof data.balance === 'number') setState({ balance: data.balance });
  return data;
}

// ---- cryptomus gateway (real crypto payments) -----------------------------
export async function fetchCryptoConfig() {
  try {
    const res = await fetch('/api/cryptomus/config', { credentials: 'same-origin' });
    if (!res.ok) return { live: false };
    return await res.json();
  } catch {
    return { live: false };
  }
}

export async function createCryptoInvoice(amountCents, clientId) {
  const res = await fetch('/api/cryptomus/invoice', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ amountCents, clientId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'invoice_failed');
  return data;
}

export async function fetchCryptoStatus(orderId, clientId) {
  const res = await fetch(
    '/api/cryptomus/status?orderId=' + encodeURIComponent(orderId) + '&clientId=' + encodeURIComponent(clientId || ''),
    { credentials: 'same-origin' }
  );
  if (!res.ok) throw new Error('status_failed');
  return res.json();
}

export async function fetchTransactions({ limit = 10, offset = 0, type = 'all', status = 'all' } = {}) {
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset), type, status });
  try {
    const res = await fetch('/api/v1/wallet/transactions?' + qs + '&' + ownerQs(), {
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export const fmtMoney = (cents) =>
  '$' + (Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
