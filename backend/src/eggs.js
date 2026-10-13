// Server-side easter-egg detection for sacrifices.
// KEEP IN SYNC with the client copy in frontend/src/lib/effects.js (+ the
// rickroll keywords from frontend/src/lib/rickroll.js): the server is the
// authority and only a PAID throw carries an egg (ev.egg) to other clients —
// free QA throws (test=1) never trigger shows.
const RULES = [
  [
    'interstellar',
    /(gargantua|interstellar|гаргантюа|гаргантюа|интерстеллар|\bmurph\b|мерф|\bstay\b|don'?t let me leave|tesseract|тессеракт|singularity|сингулярность|event horizon|горизонт событий|endurance|эндьюранс|\bmiller\b|миллер)/i,
  ],
  ['bitcoin', /(bitcoin|btc|crypto|blockchain|token|\u20bf|\u0431\u0438\u0442\u043a\u043e\u0438\u043d|\u043a\u0440\u0438\u043f\u0442\u043e)/i],
  ['glitch', /(^|[^0-9])(404|null|nil)([^0-9]|$)/i],
  ['rickroll', /(rickroll|rick astley|never gonna give you up)/i],
];

// 'interstellar' | 'bitcoin' | 'glitch' | 'rickroll' | null
export function detectEgg(text) {
  const s = String(text || '');
  if (!s) return null;
  for (const [key, re] of RULES) if (re.test(s)) return key;
  return null;
}
