import express from 'express';
import http from 'http';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createAuthRouter, getSession, claimGuestHistory } from './auth.js';
import { classify, sanitizeAmount } from './tiers.js';
import { detectEgg } from './eggs.js';
import { setupWallet } from './wallet.js';
import { setupPay, safeEqual } from './np.js';
import { setupCryptomus } from './cryptomus.js';
import { setupPlisio } from './plisio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 4000);
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 5);
// shared clips: a 15s 4 Mbps recording is ~8 MB, leave the headroom here
const CLIP_MAX_MB = Number(process.env.CLIP_MAX_MB || 24);
const PREMIUM_THRESHOLD = Number(process.env.PREMIUM_THRESHOLD || 5);
// one dollar of sacrifice = 0.01 M☉ — with millions of players the counter
// still visibly ticks (always shown with two decimals)
const MASS_PER_DOLLAR = Number(process.env.MASS_PER_DOLLAR || 0.01);

// global "big bang" milestones, expressed in whole dollars of sacrifice
const BIG_BANG_MILESTONES = [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];
// how far ahead of "now" the event is scheduled so every client can align
const BANG_LEAD_MS = 600;
const ENABLE_TEST_HOOKS = process.env.ENABLE_TEST_HOOKS === '1';
// QA harness: the panel unlocks with ?qa=<QA_TOKEN>, and every QA endpoint —
// including a free test=1 throw — needs the same token on the request. An
// empty token keeps the whole QA surface dark even with the hooks enabled.
const QA_TOKEN = String(process.env.QA_TOKEN || '').trim();

const qaTokenOk = (req) => {
  if (!ENABLE_TEST_HOOKS || !QA_TOKEN) return false;
  const got = String(
    req.get('x-qa-token') || req.query.qa || (req.body && req.body.qa) || ''
  ).trim();
  return Boolean(got) && safeEqual(got, QA_TOKEN);
};

const requireQa = (req, res, next) => {
  if (!ENABLE_TEST_HOOKS || !QA_TOKEN) return res.status(404).json({ error: 'disabled' });
  if (!qaTokenOk(req)) return res.status(401).json({ error: 'qa_token' });
  next();
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
redis.on('error', (e) => console.error('[redis]', e.message));

const KEYS = {
  mass: 'void:mass',
  events: 'void:events',
  leaderboard: 'void:leaderboard',
  lbLower: 'void:lb_lower',
  piggy: 'void:piggy',
  // dynamic piggy target: { amount, target, level, lastDonationAt, lastDecayAt, day }
  piggyState: 'void:piggy:v2',
  combo: 'void:combo',
  // three public boards: all-time mass, mass of the current UTC day and the
  // biggest single sacrifice ever recorded
  day: 'void:leaderboard:day',
  dayMarker: 'void:leaderboard:day:key',
  single: 'void:leaderboard:single',
};

// every board is capped for delivery (top 100 over the socket) and trimmed
// much higher up so a runaway name flood can never grow Redis without bound
const BOARD_LIMIT = 100;
const BOARD_TRIM = 500;

const profileKey = (nameLower) => 'void:profile:' + nameLower;
const sacKey = (nameLower) => 'void:name_sac:' + nameLower;

// gamification: small donations (<$10) fill a piggy bank whose target is
// dynamic — progressive levels (base $20, ×2.0 per burst, wiped at 00:00
// UTC) plus a FOMO decay: −2% per every 10 idle minutes, floor $10
const PIGGY_BASE = 20;
const PIGGY_MULT = 2;
const PIGGY_FLOOR = 10;
const PIGGY_DECAY_MS = 10 * 60 * 1000;
const PIGGY_DECAY_RATE = 0.02;
// a single sacrifice of $1000 detonates the void on the spot
const WHALE_BANG = 1000;
// combo: any donations summing to $10 within 30s trigger a combo burst
const COMBO_CAP = 10;
const COMBO_WINDOW_MS = 30000;

const userKey = (id) => 'void:user:' + id;

const app = express();
app.locals.redis = redis;
app.use(cors());
// Cryptomus webhooks sign the RAW body (md5 of base64(body)+key): the shared
// webhook path must stay unparsed text so the signature is recomputed over
// the exact bytes; NOWPayments HMAC rides the re-serialized JSON and copes
// with a string body (np.js parses it back itself)
app.use('/api/pay/webhook', express.text({ type: '*/*', limit: '1mb' }));
// NOWPayments IPN is verified over the canonically re-sorted JSON payload,
// so the webhook works fine through the regular express.json() below
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));

// ARG: X-Void-Echo — one riddle slips into ~1.5% of API responses, rare
// enough to read as a server glitch, not a feature. Hunting ground: the
// Network tab. Three hard walls so nobody can farm it:
//   1. the drop needs the void_sid cookie (no cookie jar — no riddles);
//   2. no repeats inside one sid until the whole pool has been seen;
//   3. at most 20 drops per sid AND per IP per hour (minting fresh sids
//      does not help — the IP counter is shared).
// English + ASCII only (headers break on anything above 0x7F).
const VOID_ECHO = [
  'Open the Abyss with the mark the prophet John scratched on the rocks of the island of Patmos...',
  'Pay for the answer of 7.5 million years of supercomputer thinking, while you look for your towel...',
  'Whisper the name of the one they left a gravity code of dust on the bedroom floor for...',
];
const ECHO_SID_LIMIT = 20;
const ECHO_IP_LIMIT = 20;
const ECHO_WIN_MS = 60 * 60 * 1000;
const echoSid = new Map(); // sid -> { shown:Set, hits:[] }
const echoIp = new Map(); // ip -> [drop timestamps]
const parseSid = (req) => {
  const raw = String(req.headers.cookie || '');
  const hit = raw.split(/;\s*/).find((c) => c.startsWith('void_sid='));
  return hit ? hit.slice('void_sid='.length) : null;
};
const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress ||
  '?';
const pruneDrops = (arr, now) => arr.filter((t) => now - t < ECHO_WIN_MS);
app.use((req, res, next) => {
  try {
    const now = Date.now();
    let sid = parseSid(req);
    if (!sid || sid.length > 64 || !/^[A-Za-z0-9-]+$/.test(sid)) {
      sid = randomUUID();
      res.setHeader('Set-Cookie', `void_sid=${sid}; Path=/; Max-Age=7200; SameSite=Lax`);
      sid = null; // first contact: hand out the cookie, drop only next round
    }
    if (sid && Math.random() < 0.015) {
      const ip = clientIp(req);
      const ipHits = pruneDrops(echoIp.get(ip) || [], now);
      if (ipHits.length < ECHO_IP_LIMIT) {
        let st = echoSid.get(sid);
        if (!st) {
          st = { shown: new Set(), hits: [] };
          echoSid.set(sid, st);
        }
        st.hits = pruneDrops(st.hits, now);
        if (st.shown.size >= VOID_ECHO.length) st.shown.clear();
        if (st.hits.length < ECHO_SID_LIMIT) {
          const un = VOID_ECHO.map((_, i) => i).filter((i) => !st.shown.has(i));
          const pick = un[(Math.random() * un.length) | 0];
          st.shown.add(pick);
          st.hits.push(now);
          ipHits.push(now);
          echoIp.set(ip, ipHits);
          if (echoSid.size > 5000) echoSid.clear(); // memory guard
          res.setHeader('X-Void-Echo', VOID_ECHO[pick]);
        }
      }
    }
  } catch {
    // a broken header chain never breaks the API
  }
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e6,
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});
const clipUpload = multer({
  storage,
  limits: { fileSize: CLIP_MAX_MB * 1024 * 1024 },
});

// internal wallet: /api/v1/wallet/* + the socket `effect` spend command
const wallet = setupWallet({ redis, io });
app.use('/api/v1/wallet', wallet.router);

// crypto payment gateways under neutral /api/pay/* paths (the provider never
// shows up in a URL). Plisio is the primary; Cryptomus and NOWPayments stay
// wired as fallbacks for whenever their APIs are (re)enabled — a failed
// upstream transparently falls through to the next live gateway.
// Both/all callbacks share one URL, demultiplexed by signature scheme.
const pl = setupPlisio({ redis, io, wallet });
const cm = setupCryptomus({ redis, io, wallet });
const np = setupPay({ redis, io, wallet });

// circuit breakers: after an upstream failure stop touching that gateway for
// a minute instead of paying the dead round-trip on every invoice
let plDownUntil = 0;
let cmDownUntil = 0;

// feature flag for the deposit modal — served by the primary live gateway
// so min/max always reflect what its invoices actually accept
app.get('/api/pay/config', (req, res) => {
  if (pl.live()) return pl.handlers.config(req, res);
  if (cm.live()) return cm.handlers.config(req, res);
  if (np.live()) return np.handlers.config(req, res);
  return res.json({ live: false, min: 100, max: 1000000, currency: 'USD' });
});

// invoice: run the chain of live gateways in order; an upstream failure
// (502/500 or a disabled gateway) opens that gateway's circuit breaker and
// falls through to the next one. Each gateway records its own orderId +
// pending top-up, never two at once.
const runInvoiceChain = (gws, req, res) => {
  const gw = gws[0];
  if (!gw) return res.status(503).json({ error: 'gateway_disabled' });
  const rest = gws.slice(1);
  const origStatus = res.status.bind(res);
  const origJson = res.json.bind(res);
  let code = 200;
  res.status = (c) => {
    code = c;
    return res;
  };
  res.json = (payload) => {
    res.status = origStatus;
    res.json = origJson;
    const failed =
      code >= 500 ||
      (payload && (payload.error === 'upstream_failed' || payload.error === 'server_error' || payload.error === 'gateway_disabled'));
    if (failed && rest.length) {
      if (gw.markDown) gw.markDown();
      console.warn(
        '[pay] ' + gw.id + ' failed (code=' + code + ' err=' + ((payload && payload.error) || '') + '), falling back'
      );
      return runInvoiceChain(rest, req, res);
    }
    return origJson(payload);
  };
  gw.handlers.invoice(req, res);
};

app.post('/api/pay/invoice', (req, res) => {
  const chain = [];
  if (pl.live() && Date.now() >= plDownUntil) {
    chain.push({ id: 'plisio', handlers: pl.handlers, markDown: () => (plDownUntil = Date.now() + 60000) });
  }
  if (cm.live() && Date.now() >= cmDownUntil) {
    chain.push({ id: 'cryptomus', handlers: cm.handlers, markDown: () => (cmDownUntil = Date.now() + 60000) });
  }
  if (np.live()) chain.push({ id: 'nowpayments', handlers: np.handlers });
  // nothing live: np still serves the QA mock invoice and the 503 flag
  runInvoiceChain(chain.length ? chain : [np], req, res);
});

// status: the order's redis hash tells which gateway owns it (void:<gw>:inv:*)
// ids unknown to every gateway land on the np handler and 404 there
app.get('/api/pay/status', async (req, res) => {
  try {
    const id = String(req.query.orderId || '');
    if (/^[A-Za-z0-9_-]{10,64}$/.test(id)) {
      if (await redis.exists('void:plisio:inv:' + id)) return pl.handlers.status(req, res);
      if (await redis.exists('void:cm:inv:' + id)) return cm.handlers.status(req, res);
    }
  } catch {
    // fall through to the np status handler
  }
  return np.handlers.status(req, res);
});

// one webhook URL for every provider, demultiplexed by signature scheme:
// NOWPayments signs a header, Plisio a verify_hash inside the JSON body,
// Cryptomus the raw body — all three bodies stay intact under the
// express.text() parser installed above
app.post('/api/pay/webhook', (req, res) => {
  if (req.get('x-nowpayments-sig')) return np.handlers.webhook(req, res);
  let probe = req.body;
  if (typeof probe === 'string') {
    try {
      probe = JSON.parse(probe);
    } catch {
      probe = null;
    }
  }
  if (probe && typeof probe === 'object' && typeof probe.verify_hash === 'string') return pl.handlers.webhook(req, res);
  return cm.handlers.webhook(req, res);
});

// admin crypto payouts (ADMIN_TOKEN), Cryptomus only
app.post('/api/pay/payout', cm.handlers.payout);

function sanitizeText(value, max = 280) {
  const s = String(value == null ? '' : value);
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code < 32 && ch !== '\n') continue;
    out += ch;
  }
  return out.trim().slice(0, max);
}

async function getMass() {
  const v = await redis.get(KEYS.mass);
  return v ? Number(v) : 0;
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// one-time conversion of legacy data (stored in raw dollars) to MASS_PER_DOLLAR units
async function migrateMassScale() {
  const marker = 'void:mass_scale';
  try {
    const cur = await redis.get(marker);
    if (cur === String(MASS_PER_DOLLAR)) return;

    const raw = await redis.get(KEYS.mass);
    const v = raw ? Number(raw) : 0;
    if (v) await redis.set(KEYS.mass, String(round2(v * MASS_PER_DOLLAR)));

    const rows = await redis.zrange(KEYS.leaderboard, 0, -1, 'WITHSCORES');
    if (rows.length) {
      const pipe = redis.pipeline();
      for (let i = 0; i < rows.length; i += 2) {
        pipe.zadd(KEYS.leaderboard, round2(Number(rows[i + 1]) * MASS_PER_DOLLAR), rows[i]);
      }
      await pipe.exec();
    }
    await redis.set(marker, String(MASS_PER_DOLLAR));
    console.log('[void] mass scale migrated to', MASS_PER_DOLLAR, 'M☉ per $');
  } catch (e) {
    console.error('[void] mass migration', e.message);
  }
}

async function readBoard(key, limit = BOARD_LIMIT) {
  const raw = await redis.zrevrange(key, 0, limit - 1, 'WITHSCORES');
  const out = [];
  for (let i = 0; i < raw.length; i += 2) {
    out.push({ name: raw[i], mass: Number(raw[i + 1]) });
  }
  return out;
}

// the daily board is wiped on the first touch of a new UTC day
const utcDay = () => new Date().toISOString().slice(0, 10);

async function rollDay() {
  try {
    const key = utcDay();
    const cur = await redis.get(KEYS.dayMarker);
    if (cur === key) return false;
    await redis.del(KEYS.day);
    await redis.set(KEYS.dayMarker, key, 'EX', 60 * 60 * 24 * 3);
    return true;
  } catch (e) {
    console.error('[boards] day roll', e.message);
    return false;
  }
}

async function getBoards() {
  await rollDay();
  const [all, day, single] = await Promise.all([
    readBoard(KEYS.leaderboard),
    readBoard(KEYS.day),
    readBoard(KEYS.single),
  ]);
  return { all, day, single };
}

// boards are re-sent after a sacrifice, but coalesced so a burst of events
// (test runs, live spammers) cannot flood every connected client
let boardsTimer = null;
function scheduleBoards() {
  if (boardsTimer) return;
  boardsTimer = setTimeout(() => {
    boardsTimer = null;
    getBoards()
      .then((boards) => io.emit('boards_update', boards))
      .catch((e) => console.error('[boards]', e.message));
  }, 1500);
}

// one-time backfill of the case-insensitive board used by public profiles
async function migrateLowerBoard() {
  const marker = 'void:lb_lower_migrated';
  try {
    if (await redis.exists(marker)) return;
    const rows = await redis.zrange(KEYS.leaderboard, 0, -1, 'WITHSCORES');
    if (rows.length) {
      const pipe = redis.pipeline();
      for (let i = 0; i < rows.length; i += 2) {
        const name = rows[i];
        if (name) pipe.zincrby(KEYS.lbLower, Number(rows[i + 1]) || 0, name.toLowerCase());
      }
      await pipe.exec();
    }
    await redis.set(marker, '1');
    console.log('[void] lower leaderboard migrated', rows.length / 2, 'rows');
  } catch (e) {
    console.error('[void] lb_lower migration', e.message);
  }
}

// one-time backfill of the "biggest single sacrifice" board from the per-name
// sacrifice history, so the record board is meaningful from the first deploy
async function migrateSingleBoard() {
  const marker = 'void:single_migrated';
  try {
    if (await redis.exists(marker)) return;
    const names = await redis.zrevrange(KEYS.leaderboard, 0, 299);
    let done = 0;
    for (const name of names) {
      const raw = await redis.lrange(sacKey(String(name).toLowerCase()), 0, 99);
      let best = 0;
      for (const s of raw) {
        try {
          const e = JSON.parse(s);
          if (!e || e.name !== name) continue; // shared list: case variants
          const a = Number(e.amount) || 0;
          if (a > best) best = a;
        } catch { /* skip broken entry */ }
      }
      if (best > 0) {
        await redis.zadd(KEYS.single, 'GT', round2(best * MASS_PER_DOLLAR), name);
        done++;
      }
    }
    await redis.set(marker, '1');
    console.log('[void] single-sacrifice board backfilled', done, 'rows');
  } catch (e) {
    console.error('[void] single board migration', e.message);
  }
}

async function getRecentEvents(limit = 30) {
  const raw = await redis.lrange(KEYS.events, 0, limit - 1);
  return raw
    .map((s) => {
      try { return JSON.parse(s); } catch { return null; }
    })
    .filter(Boolean);
}

async function emitBigBang(milestone, mass = null) {
  // one event at a time, with a minute of cooling off
  const lock = await redis.set('void:bang_lock', '1', 'EX', 60, 'NX');
  if (!lock) return null;

  const now = Date.now();
  const payload = { at: now + BANG_LEAD_MS, now, milestone, mass };
  io.emit('big_bang', payload);
  console.log('[void] big bang at', milestone, '$');
  return payload;
}

async function maybeBigBang(prevMass, mass) {
  const prev$ = Number(prevMass) / MASS_PER_DOLLAR;
  const now$ = Number(mass) / MASS_PER_DOLLAR;
  const crossed = BIG_BANG_MILESTONES.find((m) => prev$ < m && now$ >= m);
  if (!crossed) return null;
  return emitBigBang(crossed, mass);
}

// --- piggy bank: dynamic target -------------------------------------------
// The hash void:piggy:v2 holds { amount, target, level, lastDonationAt,
// lastDecayAt, day }. The legacy void:piggy string balance migrates into it
// on first read (the old key is left behind as dead data). Day rolls and the
// FOMO decay are applied lazily on every read — the minute tick below keeps
// sleeping clients in sync as well.
async function readPiggyRaw() {
  let h = await redis.hgetall(KEYS.piggyState);
  if (h && h.target) return h;
  const legacy = Number(await redis.get(KEYS.piggy)) || 0;
  const now = Date.now();
  const seed = {
    amount: String(round2(legacy)),
    target: String(PIGGY_BASE),
    level: '1',
    lastDonationAt: String(now),
    lastDecayAt: String(now),
    day: utcDay(),
  };
  await redis.hset(KEYS.piggyState, seed);
  return seed;
}

// returns { value, target, level, changed } — changed=true when this read
// rolled the day or applied decay (the caller then broadcasts the update)
async function getPiggyState() {
  let h = await readPiggyRaw();
  const now = Date.now();
  let changed = false;

  // daily wipe: level/target/amount back to level 1, lazy like rollDay()
  if (h.day !== utcDay()) {
    const seed = {
      amount: '0',
      target: String(PIGGY_BASE),
      level: '1',
      lastDonationAt: String(now),
      lastDecayAt: String(now),
      day: utcDay(),
    };
    await redis.hset(KEYS.piggyState, seed);
    h = seed;
    changed = true;
  }

  // FOMO decay: −2% per full 10 idle minutes, never below the $10 floor
  const base = Number(h.target) || PIGGY_BASE;
  const idleFrom = Math.max(Number(h.lastDonationAt) || now, Number(h.lastDecayAt) || now);
  const steps = Math.floor((now - idleFrom) / PIGGY_DECAY_MS);
  if (steps > 0) {
    const target = Math.max(PIGGY_FLOOR, base * Math.pow(1 - PIGGY_DECAY_RATE, steps));
    h = { ...h, target: String(round2(target)), lastDecayAt: String(idleFrom + steps * PIGGY_DECAY_MS) };
    await redis.hset(KEYS.piggyState, { target: h.target, lastDecayAt: h.lastDecayAt });
    changed = true;
  }

  return {
    value: round2(Number(h.amount) || 0),
    target: round2(Number(h.target) || PIGGY_BASE),
    level: Number(h.level) || 1,
    changed,
  };
}

async function feedPiggy(amt, ev) {
  const st = await getPiggyState(); // migration + day roll + decay first
  const now = Date.now();
  const next = round2(Number(await redis.hincrbyfloat(KEYS.piggyState, 'amount', amt)) || 0);
  await redis.hset(KEYS.piggyState, { lastDonationAt: String(now), lastDecayAt: String(now) });

  if (next >= st.target - 1e-9) {
    // the filled core detonates the void: reset, level up, ×2.0 next goal
    const level = st.level + 1;
    const target = round2(st.target * PIGGY_MULT);
    await redis.hset(KEYS.piggyState, { amount: '0', target: String(target), level: String(level) });
    io.emit('piggy_burst', { total: next, name: ev.name, text: ev.text, value: 0, target, level });
    await emitBigBang(st.target, await getMass());
  } else {
    io.emit('piggy_update', { value: next, target: st.target, level: st.level });
  }
}

// FOMO: when donations dry up the goal keeps falling — push the fresh target
// to everyone once a minute (day rolls ride along on the same read)
setInterval(async () => {
  try {
    const st = await getPiggyState();
    if (st.changed) io.emit('piggy_update', { value: st.value, target: st.target, level: st.level });
  } catch (e) {
    console.error('[piggy] tick', e.message);
  }
}, 60 * 1000).unref();

// piggy bank + combo window, broadcast to every connected client
async function updateGamification(ev) {
  try {
    const amt = Number(ev.amount);
    if (!(amt > 0) || amt >= 10) return; // only small donations feed the bank

    await feedPiggy(amt, ev);

    const now = Date.now();
    await redis.zadd(KEYS.combo, now, `${ev.id}:${amt}`);
    await redis.zremrangebyscore(KEYS.combo, 0, now - COMBO_WINDOW_MS);
    const rows = await redis.zrange(KEYS.combo, 0, -1);
    let sum = 0;
    for (const r of rows) sum += Number(String(r).split(':')[1]) || 0;
    sum = round2(sum);
    if (sum >= COMBO_CAP - 1e-9) {
      await redis.del(KEYS.combo);
      io.emit('combo_burst', { sum, count: rows.length, name: ev.name, text: ev.text });
    } else {
      io.emit('combo_update', { sum, count: rows.length, ts: now });
    }
  } catch (e) {
    console.error('[gamification]', e.message);
  }
}

// ARG global show cooldowns: one shared performance per anomaly type. The
// donor still gets credited and keeps the feed line, but during the lockout
// the broadcast carries `silent: true` / a nulled egg — the shared 3D scene
// never gets spammed (client-side shows are one-shot 8-15s; the lockout
// outlives them: 60-120s per type).
const SHOW_COOLDOWN = {
  pi: 60e3,
  demon: 60e3,
  jackpot: 120e3,
  leet: 60e3,
  chill: 90e3,
  rickroll: 120e3,
  interstellar: 120e3,
  bitcoin: 60e3,
  glitch: 60e3,
};
const showCooldown = new Map();
function claimShow(key) {
  const until = showCooldown.get(key) || 0;
  const now = Date.now();
  if (now < until) {
    console.log(`[Anomaly on cooldown. Energy dissipating...] ${key}`);
    return false;
  }
  showCooldown.set(key, now + (SHOW_COOLDOWN[key] || 60e3));
  return true;
}

async function createVoidEvent({ text, name, amount, imageUrl, kind, clientId, paid, phase }) {
  const cls = classify(sanitizeAmount(amount));
  const safeClient = sanitizeText(clientId, 64);
  const event = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 9),
    text: sanitizeText(text, 280),
    name: sanitizeText(name, 32) || 'Anonymous',
    amount: cls.amount,
    tier: cls.tier,
    secret: cls.secret,
    imageUrl: imageUrl || null,
    kind: kind || 'text',
    premium: cls.premium,
    clientId: safeClient || null,
    ts: Date.now(),
    // which level burned it: shared clips replay the sacrifice right there
    phase: Number(phase) === 2 ? 2 : 1,
  };
  // easter eggs ride on PAID sacrifices only (free QA throws stay silent)
  event.egg = paid ? detectEgg(event.text) : null;
  // global anti-spam: suppress THE SHOW (not the money, not the feed line)
  if (event.egg && !claimShow('e:' + event.egg)) event.egg = null;
  if (event.secret && !claimShow('s:' + event.secret)) event.silent = true;

  const before = await getMass();
  const delta = event.amount * MASS_PER_DOLLAR;
  await redis.incrbyfloat(KEYS.mass, delta);
  if (event.name) {
    await redis.zincrby(KEYS.leaderboard, delta, event.name);
    await redis.zincrby(KEYS.lbLower, delta, event.name.toLowerCase());
    // daily board (UTC day) + the biggest one-shot sacrifice on record
    await rollDay();
    await redis.zincrby(KEYS.day, delta, event.name);
    await redis.zadd(KEYS.single, 'GT', delta, event.name);
    await redis.zremrangebyrank(KEYS.day, 0, -BOARD_TRIM - 1);
    await redis.zremrangebyrank(KEYS.single, 0, -BOARD_TRIM - 1);
    // per-name sacrifice history for the public profile page
    const nk = sacKey(event.name.toLowerCase());
    await redis.lpush(
      nk,
      JSON.stringify({
        id: event.id,
        name: event.name,
        text: event.text,
        amount: event.amount,
        tier: event.tier,
        secret: event.secret,
        kind: event.kind,
        imageUrl: event.imageUrl,
        ts: event.ts,
        phase: event.phase,
      })
    );
    await redis.ltrim(nk, 0, 99);
    await redis.expire(nk, 60 * 60 * 24 * 730);
  }
  await redis.lpush(KEYS.events, JSON.stringify(event));
  await redis.ltrim(KEYS.events, 0, 199);

  if (safeClient) {
    await redis.lpush(userKey(safeClient), JSON.stringify(event));
    await redis.ltrim(userKey(safeClient), 0, 499);
    await redis.expire(userKey(safeClient), 60 * 60 * 24 * 365);
  }

  const mass = await getMass();
  event.mass = mass;

  io.emit('new_void_event', event);
  io.emit('mass_update', { mass });
  scheduleBoards();
  await updateGamification(event);
  await maybeBigBang(before, mass);
  // a single $1000 sacrifice detonates the void right away (paid only)
  if (paid && event.amount >= WHALE_BANG) await emitBigBang(event.amount, mass);
  return event;
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/state', async (_req, res) => {
  try {
    const [mass, events, boards, piggy] = await Promise.all([
      getMass(),
      getRecentEvents(),
      getBoards(),
      getPiggyState(),
    ]);
    res.json({
      mass,
      events,
      boards,
      leaderboard: boards.all,
      piggy: piggy.value,
      piggyTarget: piggy.target,
      piggyLevel: piggy.level,
      online: io.engine.clientsCount,
      premiumThreshold: PREMIUM_THRESHOLD,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/my/:clientId', async (req, res) => {
  try {
    const id = sanitizeText(req.params.clientId, 64);
    if (!id) return res.status(400).json({ error: 'bad_id' });
    const raw = await redis.lrange(userKey(id), 0, 499);
    const events = raw
      .map((s) => { try { return JSON.parse(s); } catch { return null; } })
      .filter(Boolean);
    const total = events.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    res.json({ events, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ARG phase 1 persistence: accounts resolve by session (permanent across
// browsers), guests by clientId — the client merges it with localStorage
app.get('/api/arg/state', async (req, res) => {
  try {
    const session = await getSession(req).catch(() => null);
    const cid = sanitizeText(req.query.clientId, 64);
    let raw = null;
    if (session && session.userId) raw = await redis.get(argObsKey('u:' + session.userId));
    if (!raw && cid) raw = await redis.get(argObsKey('c:' + cid));
    if (!raw) return res.json({ cleared: false });
    const rec = JSON.parse(raw);
    res.json({ cleared: true, observer: rec.n, at: rec.at });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// admin: the list of everyone who reached the truth (x-admin-token = ADMIN_TOKEN)
app.get('/api/arg/solvers', async (req, res) => {
  try {
    const tok = String(req.get('x-admin-token') || req.query.token || '');
    const need = String(process.env.ADMIN_TOKEN || '');
    if (!need || tok.length < 8 || !safeEqual(tok, need)) {
      return res.status(404).json({ error: 'not_found' });
    }
    const raw = await redis.lrange(ARG_SOLVERS_KEY, 0, 999);
    const solvers = raw
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    res.json({ total: solvers.length, solvers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Cosmic radio: Jamendo track list — proxied so the client key stays on the
// server, merged from a few tag queries and cached for 10 minutes
// ---------------------------------------------------------------------------
const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID || '';
const MUSIC_TTL_MS = 10 * 60 * 1000;
// two queues: phase 1 = cosmic ambient, phase 2 = dark industrial drone /
// cyber-ambient (the stabilized void switches to it and stays there)
const musicCache = {
  1: { at: 0, tracks: [] },
  2: { at: 0, tracks: [] },
};

// Jamendo tags are AND-ed exact matches; "space" alone matches nothing, so the
// spec's mood is covered with the combinations that actually return tracks
const MUSIC_PHASES = {
  1: [
    'tags=ambient+scifi&speed=verylow+low',
    'tags=cosmic&speed=verylow+low',
    'tags=ambient&speed=verylow',
  ],
  // Control / Deus Ex / Blade Runner 2049 / Portal 2 territory: brutalist
  // drone, industrial hum, cyber-ambient — strictly no vocals
  2: [
    'tags=drone&speed=verylow+low',
    'tags=atmospheric+drone',
    'tags=industrial&speed=low+medium',
    'tags=cyberpunk&speed=low+medium',
    'tags=cinematic+ambient&speed=verylow+low',
  ],
};

async function fetchOne(url) {
  // Jamendo intermittently answers 0 results for a query that works on retry
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const data = await r.json();
      const rows = data?.results || [];
      if (rows.length) return rows;
    } catch (e) {
      console.error('[music] jamendo query failed:', e.message);
    }
    await new Promise((res) => setTimeout(res, 250 * (attempt + 1)));
  }
  return [];
}

async function fetchJamendoTracks(phase) {
  const queries = MUSIC_PHASES[phase] || MUSIC_PHASES[1];
  // phase 2 promises "no words": keep only tracks Jamendo marks instrumental
  const instrumentalOnly = phase === 2;
  const out = [];
  const seen = new Set();
  await Promise.all(
    queries.map(async (q) => {
      const url =
        `https://api.jamendo.com/v3.0/tracks/?client_id=${JAMENDO_CLIENT_ID}` +
        `&format=json&audioformat=mp32&order=popularity_month&limit=16` +
        `&include=musicinfo&${q}`;
      const rows = await fetchOne(url);
      for (const t of rows) {
        if (!t?.audio || !t?.name || seen.has(t.id)) continue;
        const vocal = t.musicinfo && t.musicinfo.vocalinstrumental;
        if (instrumentalOnly && vocal !== 'instrumental') continue;
        seen.add(t.id);
        out.push({
          id: t.id,
          name: String(t.name),
          artist: String(t.artist_name || ''),
          album: String(t.album_name || ''),
          art: t.album_image || t.image || '',
          audio: t.audio,
          duration: Number(t.duration) || 0,
        });
      }
    })
  );
  // light shuffle so the queue is not always the same order
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, 30);
}

app.get('/api/music/tracks', async (req, res) => {
  const phase = Number(req.query && req.query.phase) === 2 ? 2 : 1;
  try {
    const cache = musicCache[phase];
    const fresh = cache.tracks.length && Date.now() - cache.at < MUSIC_TTL_MS;
    if (fresh) return res.json({ tracks: cache.tracks, phase });
    if (!JAMENDO_CLIENT_ID) return res.status(503).json({ error: 'no_key', tracks: [], phase });

    const tracks = await fetchJamendoTracks(phase);
    if (tracks.length) {
      cache.at = Date.now();
      cache.tracks = tracks;
      return res.json({ tracks, phase });
    }
    // upstream flaked: serve stale cache if we have one
    res.json({ tracks: cache.tracks, phase });
  } catch (e) {
    res.status(500).json({ error: e.message, tracks: musicCache[phase].tracks, phase });
  }
});

// every sacrifice is paid from the internal wallet: cost = the typed amount
// (exact secret sums charge exactly that sum). The fee is taken atomically
// before the event is created, so a throw never goes through unpaid.
// Exception: the TestPanel QA harness sends test=1 and runs free — honoured
// only when ENABLE_TEST_HOOKS is on.
async function chargeThrow(req, amount) {
  const cls = classify(sanitizeAmount(amount));
  // the QA panel runs free, but only with the live token on the request
  if (
    ENABLE_TEST_HOOKS &&
    String((req.body && req.body.test) || '') === '1' &&
    qaTokenOk(req)
  ) {
    return { cls, costCents: 0, balance: null, free: true };
  }
  const owner = await wallet.ownerOf(req);
  if (!owner) return { denied: { status: 401, error: 'unauthorized' } };
  const costCents = Math.round(cls.amount * 100);
  const r = await wallet.charge(owner, costCents, cls.secret ? 'secret:' + cls.secret : 'sacrifice', cls.secret || null);
  if (!r.ok) {
    return { denied: { status: 402, error: 'insufficient', cost: costCents, balance: r.balance } };
  }
  return { cls, owner, costCents, balance: r.balance };
}

// ---------------------------------------------------------------------------
// ARG phase 1: amount >= $1 and the word ENTROPY stabilizes the singularity.
// The solver gets a permanent observer number in redis (accounts keep it
// across browsers, guests are keyed by clientId) and the client runs the
// emissive-dissolve transition on this answer alone.
// ---------------------------------------------------------------------------
const ARG_WORD = 'ENTROPY';
const ARG_COUNT_KEY = 'void:arg:observers';
const ARG_SOLVERS_KEY = 'void:arg:solvers'; // who reached the truth (admin list)
const ARG_TTL = 60 * 60 * 24 * 365 * 10; // 10 years — "навсегда"
const ARG_WEBHOOK_URL = process.env.ARG_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL || '';
const argObsKey = (id) => 'void:arg:obs:' + id;

function notifyArgSolve(session, rec, amount) {
  if (!ARG_WEBHOOK_URL) return;
  const who = session
    ? `@${session.name || 'unknown'} (${session.userId})`
    : 'guest';
  const msg = [
    '🚨 ARG PHASE 1 SOLVED!',
    `User: ${who}`,
    `Amount: $${Number(amount).toFixed(2)}`,
    `Word: ${ARG_WORD}`,
    `Observer: #${String(rec.n).padStart(3, '0')}`,
    `Time: ${new Date().toISOString()}`,
    'Status: Dissolve effect triggered successfully.',
  ].join('\n');
  const isTg = ARG_WEBHOOK_URL.includes('api.telegram.org');
  const body = isTg
    ? { text: msg, chat_id: process.env.ARG_TG_CHAT_ID || undefined }
    : { content: msg, text: msg };
  fetch(ARG_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  }).catch((e) => console.log('[ARG] webhook failed:', e && e.message));
}

// one row per identity (account or guest browser), so the whole cohort of
// solvers can be pulled later with GET /api/arg/solvers — this is the record
// the project cares about: who actually dug the answer out
async function recordSolver({ rec, uid, cid, session, name, amount, paid }) {
  const row = {
    n: rec.n,
    userId: uid || null,
    name: (session && session.name) || sanitizeText(name, 32) || null,
    clientId: cid || null,
    amount: Number(amount) || 0,
    paid: !!paid,
    at: Date.now(),
  };
  try {
    await redis.lpush(ARG_SOLVERS_KEY, JSON.stringify(row));
    await redis.ltrim(ARG_SOLVERS_KEY, 0, 999);
    await redis.expire(ARG_SOLVERS_KEY, ARG_TTL);
  } catch (e) {
    console.log('[ARG] solver record failed:', e && e.message);
  }
  console.log(
    `[ARG] solver #${row.n} · ${row.userId ? 'user ' + row.userId + ' ' + (row.name || '') : 'guest ' + row.clientId} · ${row.amount}$ · ${row.paid ? 'paid' : 'test'}`
  );
}

async function argSolve(req, { amount, text, name, clientId, paid }) {
  if (!(Number(sanitizeAmount(amount)) >= 1)) return null;
  if (String(text || '').trim().toUpperCase() !== ARG_WORD) return null;
  const session = await getSession(req).catch(() => null);
  const uid = session && session.userId;
  const cid = sanitizeText(clientId, 64);
  let rec = null;
  let fromUser = false;
  if (uid) {
    const raw = await redis.get(argObsKey('u:' + uid));
    if (raw) {
      try {
        rec = JSON.parse(raw);
        fromUser = true;
      } catch {
        rec = null;
      }
    }
  }
  if (!rec && cid) {
    const raw = await redis.get(argObsKey('c:' + cid));
    if (raw) {
      try {
        rec = JSON.parse(raw);
      } catch {
        rec = null;
      }
    }
  }
  const first = !rec;
  if (!rec) {
    const n = (await redis.incr(ARG_COUNT_KEY)) || 1;
    rec = { n, at: Date.now() };
  }
  if (first) await recordSolver({ rec, uid, cid, session, name, amount, paid });
  // accounts keep the observer number across browsers; this browser does too
  if (uid && !fromUser) await redis.set(argObsKey('u:' + uid), JSON.stringify(rec), 'EX', ARG_TTL);
  if (cid) await redis.set(argObsKey('c:' + cid), JSON.stringify(rec), 'EX', ARG_TTL);
  if (paid) notifyArgSolve(session, rec, amount);
  console.log(
    `[ARG] phase 1 solved · observer #${rec.n} · ${amount}$ · ${paid ? 'paid' : 'test'}`
  );
  return rec;
}

app.post('/api/destroy', upload.single('file'), async (req, res) => {
  try {
    const { text, name, amount, clientId, phase } = req.body || {};
    const file = req.file;
    if (!file && !sanitizeText(text)) {
      return res.status(400).json({ error: 'empty_payload' });
    }
    const pay = await chargeThrow(req, amount);
    if (pay.denied) return res.status(pay.denied.status).json(pay.denied);
    const event = await createVoidEvent({
      text,
      name,
      amount: pay.cls.amount,
      imageUrl: file ? '/uploads/' + file.filename : null,
      kind: file ? 'media' : 'text',
      clientId,
      paid: !pay.free,
      phase,
    });
    const arg = await argSolve(req, { amount, text, name, clientId, paid: !pay.free });
    res.json({
      ok: true,
      event,
      balance: pay.balance,
      ...(arg ? { arg_solved: true, observer: arg.n } : {}),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gamma', async (req, res) => {
  try {
    const { text, name, amount, clientId, phase } = req.body || {};
    const pay = await chargeThrow(req, amount || PREMIUM_THRESHOLD);
    if (pay.denied) return res.status(pay.denied.status).json(pay.denied);
    const event = await createVoidEvent({
      text,
      name,
      amount: pay.cls.amount,
      kind: 'gamma',
      clientId,
      paid: !pay.free,
      phase,
    });
    const arg = await argSolve(req, { amount, text, name, clientId, paid: !pay.free });
    res.json({
      ok: true,
      event,
      balance: pay.balance,
      ...(arg ? { arg_solved: true, observer: arg.n } : {}),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// the QA panel asks this once on boot: only a live token turns it on. The
// token itself never travels in the code, only in the link the tester opens.
app.get('/api/qa/ping', (req, res) => {
  if (!ENABLE_TEST_HOOKS || !QA_TOKEN) return res.status(404).json({ error: 'disabled' });
  if (!qaTokenOk(req)) return res.status(401).json({ error: 'qa_token' });
  res.json({ ok: true });
});

// fires the global event for QA (ENABLE_TEST_HOOKS=1 + QA token)
app.post('/api/test/big_bang', requireQa, (req, res) => {
  const now = Date.now();
  const milestone = Number(req.body?.milestone) || 1000;
  io.emit('big_bang', { at: now + BANG_LEAD_MS, now, milestone, mass: null });
  res.json({ ok: true, at: now + BANG_LEAD_MS });
});

// clears the ARG phase 1 observer record for this identity (QA only) so the
// dissolve transition can be tested again from a clean state
app.post('/api/test/arg_reset', requireQa, async (req, res) => {
  try {
    const session = await getSession(req).catch(() => null);
    const cid = sanitizeText((req.body && req.body.clientId) || '', 64);
    const keys = [];
    if (session && session.userId) keys.push(argObsKey('u:' + session.userId));
    if (cid) keys.push(argObsKey('c:' + cid));
    if (keys.length) await redis.del(...keys);
    res.json({ ok: true, keys: keys.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

io.on('connection', async (socket) => {
  // first: the wallet listener must exist before the client can emit
  wallet.attachSocket(socket);
  try {
    const [mass, events, boards, piggy] = await Promise.all([
      getMass(),
      getRecentEvents(30),
      getBoards(),
      getPiggyState(),
    ]);
    socket.emit('init', {
      mass,
      events,
      boards,
      leaderboard: boards.all,
      piggy: piggy.value,
      piggyTarget: piggy.target,
      piggyLevel: piggy.level,
      online: io.engine.clientsCount,
      premiumThreshold: PREMIUM_THRESHOLD,
    });
  } catch {
    socket.emit('init', {
      mass: 0,
      events: [],
      boards: { all: [], day: [], single: [] },
      leaderboard: [],
      online: 1,
    });
  }
  io.emit('presence', { online: io.engine.clientsCount });
  socket.on('disconnect', () => {
    io.emit('presence', { online: io.engine.clientsCount });
  });
});

server.listen(PORT, () => {
  console.log('[void] backend listening on :' + PORT);
  migrateMassScale();
  migrateLowerBoard();
  migrateSingleBoard();
});

// ---------------------------------------------------------------------------
// Auth: Google OAuth 2.0 + Sign-In with Ethereum + guest claim
// ---------------------------------------------------------------------------
app.use('/api/auth', createAuthRouter({ redis }));

app.get('/api/me', async (req, res) => {
  const session = await getSession(req);
  if (!session) return res.json({ user: null });
  res.json({ user: session });
});

app.post('/api/auth/claim', async (req, res) => {
  try {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    const clientId = sanitizeText(req.body?.clientId, 64);
    const merged = clientId ? await claimGuestHistory(clientId, session) : 0;
    // the guest's wallet balance and transaction history move too
    const walletBalance = clientId ? await wallet.merge(clientId, session.userId) : 0;
    res.json({ ok: true, merged, walletBalance, user: session });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function readUserEvents(key) {
  const raw = await redis.lrange(key, 0, 499);
  const events = raw
    .map((s) => { try { return JSON.parse(s); } catch { return null; } })
    .filter(Boolean);
  const total = events.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  return { events, total };
}

// merged history for a signed-in account (guest records are moved on claim)
app.get('/api/account/events', async (req, res) => {
  try {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    const data = await readUserEvents('void:user:' + session.userId);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Shared clips: a recorded destroy uploaded by the share sheet
//
//   POST /api/share/clip   multipart: clip (video/gif) + poster (jpg) + text
//                          + eventId — indexed as the event's latest clip
//   GET  /api/share/clip/…  the clip already published for that event, so a
//                          re-share opens the sheet without recording again
//   GET  /v/<file>         the page socials scrape — og:video + og:image +
//                          og:description, so a shared link shows the clip
//                          with its caption as a preview; a clip that has been
//                          cleaned up lands on the project instead of a 404
// ---------------------------------------------------------------------------
const CLIP_RE = /^[A-Za-z0-9._-]{4,80}$/;
const EVENT_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
// clips live for 90 days — long enough for a post to matter, after that the
// link hands the visitor to the project and the sheet records a fresh clip
const CLIP_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
const CLIP_INDEX_TTL = 100 * 24 * 60 * 60; // seconds, past the keep window

const clipEventId = (name) => {
  const m = String(name || '').match(/the-internet-void-([A-Za-z0-9_-]{4,64})\.[a-z0-9]+$/i);
  return m ? m[1] : null;
};

const escapeHtml = (v) =>
  String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

app.post(
  '/api/share/clip',
  clipUpload.fields([
    { name: 'clip', maxCount: 1 },
    { name: 'poster', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const files = req.files || {};
      const clip = (files.clip || [])[0];
      if (!clip) return res.status(400).json({ error: 'no_clip' });
      const poster = (files.poster || [])[0];
      const text = sanitizeText(req.body?.text, 400);
      const int = (v, max) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), max) : 0;
      };
      const rawEventId = String(req.body?.eventId || '');
      const eventId = EVENT_ID_RE.test(rawEventId) ? rawEventId : clipEventId(clip.filename);
      const origin = `${req.protocol}://${req.get('host') || `localhost:${PORT}`}`;
      await redis.set(
        'void:clip:' + clip.filename,
        JSON.stringify({
          text,
          clip: clip.filename,
          poster: poster ? poster.filename : null,
          eventId,
          w: int(req.body?.w, 4096),
          h: int(req.body?.h, 4096),
          dur: int(req.body?.dur, 3600),
          fps: int(req.body?.fps, 240),
          bytes: int(req.body?.bytes, 1e9),
          at: Date.now(),
        }),
        'EX',
        60 * 60 * 24 * 365
      );
      // this event's latest clip — what the share sheet reopens later
      if (eventId) await redis.set('void:share:' + eventId, clip.filename, 'EX', CLIP_INDEX_TTL);
      res.json({ ok: true, id: clip.filename, url: `${origin}/v/${clip.filename}` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// the clip a previous share already published for this event — re-sharing
// reuses it instead of recording and uploading yet another copy
app.get('/api/share/clip/:eventId', async (req, res) => {
  try {
    const eventId = String(req.params.eventId || '');
    if (!EVENT_ID_RE.test(eventId)) return res.status(400).json({ error: 'bad_id' });
    let file = await redis.get('void:share:' + eventId);
    if (!file || !CLIP_RE.test(file) || !fs.existsSync(path.join(UPLOAD_DIR, file))) {
      // clips uploaded before the index existed — take the newest one on disk
      file = null;
      const matches = fs
        .readdirSync(UPLOAD_DIR)
        .filter((n) => clipEventId(n) === eventId);
      if (matches.length) {
        matches.sort(
          (a, b) =>
            fs.statSync(path.join(UPLOAD_DIR, b)).mtimeMs -
            fs.statSync(path.join(UPLOAD_DIR, a)).mtimeMs
        );
        file = matches[0];
        await redis.set('void:share:' + eventId, file, 'EX', CLIP_INDEX_TTL);
      }
    }
    if (!file || !CLIP_RE.test(file) || !fs.existsSync(path.join(UPLOAD_DIR, file))) {
      return res.status(404).json({ error: 'no_clip' });
    }
    let meta = {};
    try {
      meta = JSON.parse((await redis.get('void:clip:' + file)) || '{}');
    } catch {
      meta = {};
    }
    const origin = `${req.protocol}://${req.get('host') || `localhost:${PORT}`}`;
    res.json({
      ok: true,
      file,
      url: `${origin}/uploads/${encodeURIComponent(file)}`,
      pageUrl: `${origin}/v/${encodeURIComponent(file)}`,
      poster: meta.poster ? `${origin}/uploads/${encodeURIComponent(meta.poster)}` : null,
      text: meta.text || '',
      kind: /\.gif$/i.test(file) ? 'gif' : 'video',
      w: meta.w || 0,
      h: meta.h || 0,
      dur: meta.dur || 0,
      fps: meta.fps || 0,
      bytes: meta.bytes || 0,
      at: meta.at || 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// daily sweep: a clip past its 90 days is dropped with its poster and index
let clipCleanupRunning = false;
async function cleanupOldClips() {
  if (clipCleanupRunning) return;
  clipCleanupRunning = true;
  let removed = 0;
  try {
    const drop = async (name) => {
      if (!name) return;
      const p = path.join(UPLOAD_DIR, name);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        removed++;
      }
    };
    const ageOf = async (name, meta) => {
      let at = Number(meta && meta.at) || 0;
      if (!at) {
        try {
          at = fs.statSync(path.join(UPLOAD_DIR, name)).mtimeMs;
        } catch {
          return 0;
        }
      }
      return Date.now() - at;
    };
    const forget = async (name, meta) => {
      const eventId = (meta && meta.eventId) || clipEventId(name);
      if (eventId) {
        const indexed = await redis.get('void:share:' + eventId);
        if (indexed === name) await redis.del('void:share:' + eventId);
      }
      await redis.del('void:clip:' + name);
    };

    // every clip we have metadata for
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'void:clip:*', 'COUNT', 200);
      cursor = next;
      for (const key of keys) {
        const name = key.slice('void:clip:'.length);
        let meta = {};
        try {
          meta = JSON.parse((await redis.get(key)) || '{}');
        } catch {
          meta = {};
        }
        if ((await ageOf(name, meta)) <= CLIP_KEEP_MS) continue;
        await drop(name);
        await drop(meta.poster);
        await forget(name, meta);
      }
    } while (cursor !== '0');

    // clips whose metadata is long gone but the file still sits on disk
    for (const name of fs.readdirSync(UPLOAD_DIR)) {
      if (!/^[0-9]+-[a-z0-9]+-the-internet-void-/i.test(name)) continue;
      try {
        if (Date.now() - fs.statSync(path.join(UPLOAD_DIR, name)).mtimeMs <= CLIP_KEEP_MS) continue;
      } catch {
        continue;
      }
      await drop(name);
      await redis.del('void:clip:' + name);
    }
    if (removed) console.log(`[clips] cleanup: dropped ${removed} file(s) past 90 days`);
  } catch (e) {
    console.error('[clips] cleanup', e.message);
  } finally {
    clipCleanupRunning = false;
  }
}


app.get('/v/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const origin = `${req.protocol}://${req.get('host') || `localhost:${PORT}`}`;
    // a clip that has been cleaned up (or a name we never issued) still brings
    // the visitor to the project instead of a dead end
    if (!CLIP_RE.test(id) || !fs.existsSync(path.join(UPLOAD_DIR, id))) {
      return res.redirect(302, `${origin}/?ref=share`);
    }
    let meta = {};
    try {
      meta = JSON.parse((await redis.get('void:clip:' + id)) || '{}');
    } catch {
      meta = {};
    }
    const videoUrl = `${origin}/uploads/${encodeURIComponent(id)}`;
    const posterUrl = meta.poster ? `${origin}/uploads/${encodeURIComponent(meta.poster)}` : '';
    const type = /\.mp4$/i.test(id)
      ? 'video/mp4'
      : /\.gif$/i.test(id)
        ? 'image/gif'
        : 'video/webm';
    const caption = escapeHtml(meta.text || 'The Void accepted a sacrifice.');
    const desc = escapeHtml(
      String(meta.text || 'The Void accepted a sacrifice.')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300)
    );
    // the caption's first line is the phrase the poster picked — Facebook and
    // LinkedIn read it as the headline of the card, so that is the text of the
    // shared post; the rest of the caption becomes the description
    const headline = escapeHtml(
      String(meta.text || '')
        .split('\n')[0]
        .trim()
        .slice(0, 120) || 'THE INTERNET VOID'
    );
    const vw = meta.w || 1280;
    const vh = meta.h || 720;
    const vdur = meta.dur || 0;
    const httpsUrl = (u) => (u.startsWith('https://') ? u : '');
    const secureVideo = httpsUrl(videoUrl);
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>THE INTERNET VOID</title>
<meta property="og:site_name" content="THE INTERNET VOID">
<meta property="og:title" content="${headline}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${origin}/v/${encodeURIComponent(id)}">
<meta property="og:type" content="video.other">
${posterUrl ? `<meta property="og:image" content="${posterUrl}">
<meta property="og:image:width" content="${vw}">
<meta property="og:image:height" content="${vh}">
<meta property="og:image:alt" content="THE INTERNET VOID">
<meta property="og:image:type" content="image/jpeg">` : ''}
<meta property="og:video" content="${videoUrl}">
${secureVideo ? `<meta property="og:video:secure_url" content="${secureVideo}">\n` : ''}<meta property="og:video:type" content="${type}">
<meta property="og:video:width" content="${vw}">
<meta property="og:video:height" content="${vh}">
<meta property="og:video:duration" content="${vdur}">
<meta property="og:video:alt" content="THE INTERNET VOID">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${headline}">
<meta name="twitter:description" content="${desc}">
${posterUrl ? `<meta name="twitter:image" content="${posterUrl}">
<meta name="twitter:image:alt" content="THE INTERNET VOID">` : ''}
<style>
  html,body{margin:0;background:#000;color:#fff;font:600 14px Inter,system-ui,sans-serif}
  main{max-width:860px;margin:0 auto;padding:16px}
  video{width:100%;border-radius:14px;background:#000}
  p{white-space:pre-wrap;line-height:1.45;color:#d7d3e0}
  a{color:#fbbf24}
</style>
</head>
<body>
<main>
<video controls autoplay loop muted playsInline ${posterUrl ? `poster="${posterUrl}"` : ''} src="${videoUrl}" type="${type}"></video>
<p>${caption}</p>
<p><a href="${origin}/?ref=share">Enter THE INTERNET VOID</a></p>
</main>
</body>
</html>`;
    res.type('html').send(html);
  } catch (e) {
    res.status(500).type('text/plain').send('error');
  }
});

// ---------------------------------------------------------------------------
// Public profiles: totals, title, top sacrifice, gallery, social link
// ---------------------------------------------------------------------------
const TITLE_USD = [10, 100, 1000, 5000, 25000];
const titleIndex = (usd) => {
  for (let i = 0; i < TITLE_USD.length; i++) if (usd < TITLE_USD[i]) return i;
  return 5;
};

// Public profile links are restricted to this allow-list (host or subdomain)
const ALLOWED_DOMAINS = [
  // X / Twitter
  'x.com', 'twitter.com', 't.co',
  // Telegram
  't.me', 'telegram.me',
  // Discord
  'discord.gg', 'discord.com',
  // Video & Streaming
  'youtube.com', 'youtu.be', 'tiktok.com', 'twitch.tv', 'kick.com',
  // Social & Communities
  'instagram.com', 'reddit.com', 'linkedin.com', 'facebook.com',
  // Web3 & Crypto
  'dexscreener.com', 'pump.fun', 'opensea.io', 'etherscan.io', 'solscan.io',
  // Link Aggregators
  'linktr.ee', 'beacons.ai', 'taplink.cc',
  // Dev & Creative
  'github.com', 'gitlab.com', 'behance.net', 'artstation.com',
];
const LINK2_UNLOCK_USD = 100;

const cleanLink = (v) => {
  const link = String(v || '').trim().slice(0, 220);
  return /^https?:\/\/[^\s]+$/i.test(link) ? link : '';
};
const linkAllowed = (url) => {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
};
// mass recorded under one board name (the sacrifice name wins over exact case)
const massOf = async (name) => {
  const n = String(name || '').trim();
  if (!n) return 0;
  const [exact, lower] = await Promise.all([
    redis.zscore(KEYS.leaderboard, n),
    redis.zscore(KEYS.lbLower, n.toLowerCase()),
  ]);
  return Number(lower ?? exact ?? 0) || 0;
};

// a donor signs their sacrifices with the PROFILE NICK (the form prefills it),
// while the session carries the OAuth name — the total has to add both up,
// otherwise a $100+ sponsor looks broke the moment they open the edit form
const userNames = async (session) => {
  const names = new Set();
  const add = (v) => {
    const n = String(v || '').trim();
    if (n) names.add(n);
  };
  add(session.name);
  add(session.nick);
  try {
    const raw = await redis.get(profileKey(String(session.name || '').trim().toLowerCase()));
    if (raw) add(JSON.parse(raw).nick);
  } catch {
    /* no mirror record */
  }
  return [...names];
};

const userTotalUsd = async (session) => {
  const names = await userNames(session);
  let mass = 0;
  for (const n of names) mass += await massOf(n);
  return mass / MASS_PER_DOLLAR;
};

app.get('/api/profile/:name', async (req, res) => {
  try {
    const name = sanitizeText(req.params.name, 32);
    if (!name) return res.status(400).json({ error: 'bad_name' });
    const lower = name.toLowerCase();

    const [profRaw, total, count, sacRaw, lowerScore, exactScore] = await Promise.all([
      redis.get(profileKey(lower)),
      getMass(),
      redis.llen(sacKey(lower)),
      redis.lrange(sacKey(lower), 0, 79),
      redis.zscore(KEYS.lbLower, lower),
      redis.zscore(KEYS.leaderboard, name),
    ]);

    const mass = Number(lowerScore ?? exactScore ?? 0) || 0;
    const usd = Math.round((mass / MASS_PER_DOLLAR) * 100) / 100;
    const pct = total > 0 ? Math.min(100, (mass / total) * 100) : 0;

    const sacs = sacRaw
      .map((s) => { try { return JSON.parse(s); } catch { return null; } })
      .filter(Boolean);
    let top = null;
    const badges = { rocket: false, divine: false, gamma: false, secret: false };
    for (const s of sacs) {
      const a = Number(s.amount) || 0;
      if (!top || a > (Number(top.amount) || 0)) top = s;
      if (Number(s.tier) === 6) badges.rocket = true;
      if (Number(s.tier) === 7) badges.divine = true;
      if (a >= 10) badges.gamma = true;
      if (s.secret) badges.secret = true;
    }

    let profile = null;
    if (profRaw) {
      try { profile = JSON.parse(profRaw); } catch { profile = null; }
    }

    // lifetime of the PERSON (name + their profile nick), what the edit form
    // checks against the $100 second-link perk
    let lifetime = usd;
    try {
      if (profile && profile.nick && String(profile.nick).toLowerCase() !== lower) {
        lifetime = Math.round(((mass + (await massOf(profile.nick))) / MASS_PER_DOLLAR) * 100) / 100;
      }
    } catch {
      /* keep the single-name figure */
    }

    res.json({
      name,
      mass,
      usd,
      lifetime,
      pct,
      count: Number(count) || 0,
      titleIdx: titleIndex(usd),
      top,
      recent: sacs.slice(0, 8),
      badges,
      profile: profile
        ? {
            nick: profile.nick,
            link: profile.link || '',
            link2: profile.link2 || '',
            avatar: profile.avatar || null,
          }
        : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/profile', async (req, res) => {
  try {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });

    const nick = sanitizeText(req.body?.nick, 32);
    if (!nick) return res.status(400).json({ error: 'bad_nick' });

    let link = cleanLink(req.body?.link);
    if (link && !linkAllowed(link)) return res.status(400).json({ error: 'link_denied' });

    let link2 = cleanLink(req.body?.link2);
    if (link2 && !linkAllowed(link2)) return res.status(400).json({ error: 'link_denied' });
    // the second link is a perk for sponsors with $100+ lifetime
    if (link2) {
      const total = await userTotalUsd(session);
      if (total < LINK2_UNLOCK_USD) link2 = '';
    }

    const lower = nick.toLowerCase();
    const key = profileKey(lower);
    const existing = await redis.get(key);
    if (existing) {
      try {
        const p = JSON.parse(existing);
        if (p.userId && p.userId !== session.userId) {
          return res.status(409).json({ error: 'nick_taken' });
        }
      } catch { /* broken record: overwrite */ }
    }

    const profile = {
      nick,
      link,
      link2,
      avatar: session.avatar || null,
      userId: session.userId,
      provider: session.provider || null,
      ts: Date.now(),
    };
    await redis.set(key, JSON.stringify(profile));

    // Mirror under the OAuth name: the edit form and the sacrifice prefill both
    // read /api/profile/<session name>, so without this the saved nick, links
    // and the unlocked second field look empty after every reload.
    const sessionLower = String(session.name || '').trim().toLowerCase();
    let prevNick = null;
    if (sessionLower) {
      const mirrorKey = profileKey(sessionLower);
      const mirrorRaw = await redis.get(mirrorKey);
      if (mirrorRaw && mirrorRaw !== JSON.stringify(profile)) {
        try {
          const m = JSON.parse(mirrorRaw);
          if (m.userId === session.userId && m.nick) prevNick = String(m.nick).toLowerCase();
        } catch {
          /* broken mirror: overwrite */
        }
      }
      if (sessionLower !== lower) await redis.set(mirrorKey, JSON.stringify(profile));
      // the nick moved: drop our record under the old key so nobody else hits 409
      if (prevNick && prevNick !== lower) {
        const staleKey = profileKey(prevNick);
        const stale = await redis.get(staleKey);
        if (stale) {
          try {
            if (JSON.parse(stale).userId === session.userId) await redis.del(staleKey);
          } catch {
            /* leave it */
          }
        }
      }
    }

    res.json({
      ok: true,
      profile: { nick: profile.nick, link: profile.link, link2: profile.link2, avatar: profile.avatar },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/auth/status', (_req, res) => {
  res.json({ google: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET), ethereum: true });
});

// clip retention: a sweep on boot and one every day after that
cleanupOldClips();
setInterval(cleanupOldClips, 24 * 60 * 60 * 1000).unref();
