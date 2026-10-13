// Race test for the internal wallet: ten simultaneous spends of $0.25 against
// a balance of $1.00. Exactly four must succeed, the balance must end at 0
// (never negative) and every spend ack must arrive in under 50ms.
//
// The seeded top-up goes through the QA-only /deposit route, so the root
// .env's QA_TOKEN is required (BASE=http://localhost:8080 to override).

import { readFileSync } from 'node:fs';
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://localhost:8080';
const N = 10;
const COST = 25; // cents — EFFECT_COSTS.overload
const START = 100; // cents — $1.00
const CLIENT_ID = 'v_race' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// QA token: env wins, else parse the repo-root .env
const QA_TOKEN = (() => {
  if (process.env.QA_TOKEN) return process.env.QA_TOKEN.trim();
  try {
    const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
    const m = env.match(/^QA_TOKEN=(.*)$/m);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
})();

let failed = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log('PASS ' + label);
  else {
    failed++;
    console.log('FAIL ' + label + (extra ? ' ' + extra : ''));
  }
};

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'content-type': 'application/json', 'x-qa-token': QA_TOKEN },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

if (!QA_TOKEN) {
  console.log('FAIL QA_TOKEN is required (set it in .env or the environment)');
  process.exit(1);
}

// --- top the fresh wallet up to exactly $1 -----------------------------------
const dep = await api('/api/v1/wallet/deposit', {
  method: 'POST',
  body: JSON.stringify({ amountCents: START, clientId: CLIENT_ID }),
});
ok(dep.data.ok === true && dep.data.balance === START, 'deposit $1 -> balance 100', JSON.stringify(dep.data));

// --- ten parallel sockets, ten parallel spends -------------------------------
const sockets = Array.from(
  { length: N },
  () =>
    io(BASE, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      auth: { clientId: CLIENT_ID },
    })
);

await Promise.all(
  sockets.map(
    (s, i) =>
      new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('connect timeout #' + i)), 5000);
        s.on('connect', () => {
          clearTimeout(to);
          resolve();
        });
        s.on('connect_error', (e) => {
          clearTimeout(to);
          reject(e);
        });
      })
  )
);

const t0 = Date.now();
const results = await Promise.all(
  sockets.map(
    (s) =>
      new Promise((resolve) => {
        const start = process.hrtime.bigint();
        s.timeout(3000).emit('effect', { name: 'overload' }, (err, ack) => {
          const ms = Number(process.hrtime.bigint() - start) / 1e6;
          resolve({ err, ack: ack || null, ms });
        });
      })
  )
);
const wall = Date.now() - t0;

sockets.forEach((s) => s.close());

const wins = results.filter((r) => !r.err && r.ack && r.ack.ok);
const losses = results.filter((r) => !r.err && r.ack && r.ack.ok === false);
const errs = results.filter((r) => r.err || !r.ack);

ok(errs.length === 0, 'every spend got an ack', JSON.stringify(errs));
ok(wins.length === 4, 'exactly 4 of 10 spends succeeded', 'won=' + wins.length);
ok(losses.length === N - wins.length, 'the rest were refused', 'refused=' + losses.length);
ok(
  losses.every((r) => r.ack.reason === 'insufficient'),
  'refusals carry reason=insufficient',
  JSON.stringify(losses.map((r) => r.ack && r.ack.reason))
);
ok(
  results.every((r) => r.ack && typeof r.ack.balance === 'number' && r.ack.balance >= 0),
  'no ack ever reported a negative balance',
  JSON.stringify(results.map((r) => r.ack && r.ack.balance))
);

// --- latency: one spend must settle well under 50ms --------------------------
const times = results.map((r) => r.ms).sort((a, b) => a - b);
const maxMs = times[times.length - 1];
ok(maxMs < 50, 'every spend ack < 50ms', 'max=' + maxMs.toFixed(2) + 'ms p50=' + times[Math.floor(times.length / 2)].toFixed(2) + 'ms');
console.log('  wall clock for all 10 in parallel: ' + wall + 'ms');

// --- final state: balance 0, four spend transactions on record ---------------
const bal = await api('/api/v1/wallet/balance?clientId=' + CLIENT_ID);
ok(bal.data.balance === 0, 'final balance is exactly 0', JSON.stringify(bal.data));

const tx = await api('/api/v1/wallet/transactions?clientId=' + CLIENT_ID + '&type=spend&limit=100');
const spends = (tx.data.items || []).filter((t) => t.type === 'spend' && t.amount === -COST);
ok(spends.length === 4, 'four spend transactions recorded', 'count=' + spends.length);
ok(
  (tx.data.items || []).every((t) => t.status === 'completed'),
  'recorded transactions are completed'
);

const all = await api('/api/v1/wallet/transactions?clientId=' + CLIENT_ID + '&limit=100');
const total = (all.data.items || []).reduce((s, t) => s + t.amount, 0);
ok(total === 0, 'all transaction amounts sum to the final balance', 'sum=' + total);

console.log(failed === 0 ? '\nALL PASSED' : '\n' + failed + ' FAILED');
process.exit(failed === 0 ? 0 : 1);
