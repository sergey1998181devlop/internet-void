// Tier & secret logic shared by the HTTP API and the socket layer.
// Frontend keeps a mirror in frontend/src/lib/tiers.js — keep them in sync.

export const AMOUNT_MIN = 0.01;
export const AMOUNT_MAX = 100000;

// 1–2.99 / 3–5.99 / 6–9.99 / 10–24.99 / 25–49.99 / 50–99.99 / 100+
export function tierOf(amount) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a < 3) return 1;
  if (a < 6) return 2;
  if (a < 10) return 3;
  if (a < 25) return 4;
  if (a < 50) return 5;
  if (a < 100) return 6;
  return 7;
}

// exact sums trigger easter eggs; amount is already rounded to 2 decimals
const SECRET_TOLERANCE = 0.005;
export const SECRET_AMOUNTS = [
  { id: 'pi', amount: 3.14 },
  { id: 'demon', amount: 6.66 },
  { id: 'jackpot', amount: 7.77 },
  { id: 'leet', amount: 13.37 },
  { id: 'chill', amount: 42 },
];

export function detectSecret(amount) {
  const a = round2(amount);
  if (!Number.isFinite(a)) return null;
  const hit = SECRET_AMOUNTS.find((s) => Math.abs(a - s.amount) < SECRET_TOLERANCE);
  return hit ? hit.id : null;
}

export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function sanitizeAmount(value, fallback = 1) {
  let n = Number(value);
  if (!Number.isFinite(n) || n <= 0) n = fallback;
  n = Math.min(AMOUNT_MAX, Math.max(AMOUNT_MIN, n));
  return round2(n);
}

// full classification used inside createVoidEvent
export function classify(amount) {
  const a = sanitizeAmount(amount);
  const secret = detectSecret(a);
  return {
    amount: a,
    tier: tierOf(a),
    secret,
    premium: a >= 5, // legacy flag, kept for old clients
  };
}
