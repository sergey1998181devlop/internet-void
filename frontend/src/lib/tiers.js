// Client mirror of backend/src/tiers.js — keep in sync.

export const AMOUNT_MIN = 0.01;
export const AMOUNT_MAX = 100000;

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

export const SECRET_AMOUNTS = [
  { id: 'pi', amount: 3.14 },
  { id: 'demon', amount: 6.66 },
  { id: 'jackpot', amount: 7.77 },
  { id: 'leet', amount: 13.37 },
  { id: 'chill', amount: 42 },
];

export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function detectSecret(amount) {
  const a = round2(amount);
  if (!Number.isFinite(a)) return null;
  const hit = SECRET_AMOUNTS.find((s) => Math.abs(a - s.amount) < 0.005);
  return hit ? hit.id : null;
}

// parses whatever the user typed: comma decimal separator, spaces, $ prefix
export function parseAmount(value, fallback = 1) {
  let n = Number(String(value == null ? '' : value).replace(/[^0-9.,-]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) n = fallback;
  n = Math.min(AMOUNT_MAX, Math.max(AMOUNT_MIN, n));
  return round2(n);
}

// visual scale for particle counts / sizes: $1 ≈ 1.2, $10 ≈ 2.2, $100 ≈ 5
export function fxScale(amount) {
  const a = Math.max(0, Number(amount) || 1);
  return Math.min(5, 0.8 + Math.sqrt(a) * 0.45);
}

// ---------------------------------------------------------------------------
// Tier & secret catalog
// ---------------------------------------------------------------------------
export const TIERS = {
  1: { id: 1, color: '#cbd5e1', name: { en: 'Micro Impact', ru: 'Микроимпульс' } },
  2: { id: 2, color: '#7dd3fc', name: { en: 'Energy Charge', ru: 'Заряд Энергии' } },
  3: { id: 3, color: '#c4b5fd', name: { en: 'Gamma Ray', ru: 'Гамма-Луч' } },
  4: { id: 4, color: '#fcd34d', name: { en: 'SHOWTIME', ru: 'ШОУ-ТАЙМ' } },
  5: { id: 5, color: '#fda4af', name: { en: 'Meteor Storm', ru: 'Метеоритный Дождь' } },
  6: { id: 6, color: '#fdba74', name: { en: 'Boss Attack', ru: 'Атака Босса' } },
  7: { id: 7, color: '#fde047', name: { en: 'DIVINE SPONSOR', ru: 'ГЛАВНЫЙ СПОНСОР' } },
};

export const SECRETS = {
  pi: { id: 'pi', amount: 3.14, color: '#f9a8d4', name: { en: 'π Glitch', ru: 'Пи-Глюк' } },
  demon: { id: 'demon', amount: 6.66, color: '#f87171', name: { en: 'Demon Gate', ru: 'Врата Демона' } },
  jackpot: { id: 'jackpot', amount: 7.77, color: '#fbbf24', name: { en: 'JACKPOT', ru: 'ДЖЕКПОТ' } },
  leet: { id: 'leet', amount: 13.37, color: '#22d3ee', name: { en: '1337', ru: '1337' } },
  chill: { id: 'chill', amount: 42, color: '#c084fc', name: { en: 'Chill Vibe', ru: 'Чилл-Вайб' } },
};

// priorities: secrets (8) interrupt anything, then tiers 7..1
export function fxPriority(fx) {
  if (!fx) return 0;
  if (fx.kind === 'secret') return 8;
  return Math.max(1, Math.min(7, Number(fx.tier) || 1));
}

const FX_DURATION = {
  t1: 1600, t2: 3600, t3: 4600, t4: 7000, t5: 8500, t6: 7500, t7: 12000,
  pi: 8000, demon: 9000, jackpot: 10000, leet: 8000, chill: 12000,
};

export function fxDuration(fx) {
  if (!fx) return 2000;
  if (fx.kind === 'secret') return FX_DURATION[fx.secret] || 6000;
  return FX_DURATION['t' + (Number(fx.tier) || 1)] || 2000;
}

export function tierName(tier, lang) {
  const t = TIERS[tier];
  if (!t) return '';
  return t.name[String(lang || '').startsWith('ru') ? 'ru' : 'en'];
}

export function secretName(id, lang) {
  const s = SECRETS[id];
  if (!s) return '';
  return s.name[String(lang || '').startsWith('ru') ? 'ru' : 'en'];
}

// normalizes a void event into a queued fx descriptor; null = no tier visual
export function fxOf(ev) {
  if (!ev) return null;
  // ARG: the server marks shows that lost the global cooldown — the feed
  // line still exists, the shared 3D scene stays readable
  if (ev.silent) return null;
  if (ev.secret && SECRETS[ev.secret]) {
    return {
      id: ev.id,
      kind: 'secret',
      secret: ev.secret,
      amount: Number(ev.amount) || 0,
      name: ev.name || 'Anonymous',
      text: ev.text || '',
      ts: ev.ts || Date.now(),
    };
  }
  const tier = Number(ev.tier) || 0;
  if (tier >= 1 && tier <= 7) {
    return {
      id: ev.id,
      kind: 'tier',
      tier,
      amount: Number(ev.amount) || 0,
      name: ev.name || 'Anonymous',
      text: ev.text || '',
      ts: ev.ts || Date.now(),
    };
  }
  return null;
}

// audio: pitch maps to the amount (bigger donation = higher blip)
export function pitchFor(amount) {
  const a = Math.max(0, Number(amount) || 1);
  return 520 + Math.min(a, 100) * 4.5;
}
