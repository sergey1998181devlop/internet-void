import crypto from 'crypto';
import express from 'express';
import { nanoid } from 'nanoid';

// ---------------------------------------------------------------------------
// Plisio gateway (https://plisio.net/documentation)
//
//   GET  /api/v1/invoices/new   create a hosted invoice (api_key query param)
//   GET  /api/v1/operations/<id>  pull operation status server-side
//   POST callback_url?json=true   signed with verify_hash =
//                                 HMAC-SHA1(compact JSON of the body with
//                                 verify_hash removed, key order preserved)
//
// Security model (against forged/boosted transactions):
//   * every callback signature is verified (timing-safe); the compact-JSON
//     form from the official docs is tried first, then the slash-escaped
//     (PHP json_encode) and key-sorted (official node SDK) variants, so a
//     serialization quirk can never fail open
//   * optional IP allowlist ('*' disables it) + per-source rate limits
//   * per-event idempotency (order_number+status SETNX) on top of the wallet's
//     own seen-marker Lua, so replays can never credit twice
//   * the credited amount is ALWAYS the amount WE stored when creating the
//     order — callback amounts only produce alerts
//   * order_number <-> owner binding lives server-side; a foreign or unknown
//     order_number credits nothing
//   * completed credits; mismatch goes to manual review (hold kept);
//     expired/cancelled/error cancel the pending top-up (once)
//
// Config (env): PLISIO_API_KEY, PLISIO_LIVE=1, PLISIO_API_BASE,
//   PLISIO_WEBHOOK_IPS (comma list, '*' disables), PLISIO_PAY_CURRENCY,
//   PLISIO_CARD_BUFFER, PLISIO_DEPOSIT_MIN, PUBLIC_URL,
//   ENABLE_TEST_HOOKS, QA_TOKEN
// ---------------------------------------------------------------------------

const API_BASE = (process.env.PLISIO_API_BASE || 'https://api.plisio.net/api/v1').replace(/\/$/, '');
const API_KEY = String(process.env.PLISIO_API_KEY || '').trim();
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const LIVE = process.env.PLISIO_LIVE === '1';
// mock invoices are a QA harness: ENABLE_TEST_HOOKS + the QA token are both
// required, so the stub path is dark in production even with hooks on
const ENABLE_TEST_HOOKS = process.env.ENABLE_TEST_HOOKS === '1';
const QA_TOKEN = String(process.env.QA_TOKEN || '').trim();
const WEBHOOK_IPS = process.env.PLISIO_WEBHOOK_IPS ?? '*';
// coin the invoice is created in (psys_cid); USDT on Tron keeps fees pennies
const PAY_CURRENCY = String(process.env.PLISIO_PAY_CURRENCY || 'USDT_TRX');
// the card widget (ChangeNOW) takes its own fee out of the fiat amount — the
// widget is pre-filled with a buffered sum so the crypto covers the invoice
const CARD_BUFFER = (() => {
  const n = parseFloat(process.env.PLISIO_CARD_BUFFER || '');
  return Number.isFinite(n) && n >= 1 && n <= 2 ? n : 1.08;
})();

const DEPOSIT_MIN = (() => {
  const n = parseInt(process.env.PLISIO_DEPOSIT_MIN || '', 10);
  // Plisio floor for USDT_TRX invoices is exactly $5.00 (probed live: $5.00
  // is accepted, $4.99 returns 422 "must be greater than: 5.000000")
  return Number.isFinite(n) && n >= 100 && n <= 1000000 ? n : 500;
})();
const DEPOSIT_MAX = 1000000; // $10 000
const INVOICE_LIFETIME = 3600; // seconds (expire_min=60)
const INV_TTL = 60 * 60 * 24 * 30; // audit record lives 30 days
const ORDER_RE = /^[A-Za-z0-9_-]{10,64}$/;
const CLIENT_ID_RE = /^v_[a-z0-9]{4,48}$/i;

const invKey = (id) => 'void:plisio:inv:' + id;
const seenKey = (id) => 'void:plisio:wh:' + id;

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const hmacSha1 = (msg, key) => crypto.createHmac('sha1', key).update(msg, 'utf8').digest('hex');

// verify_hash over the compact JSON of the callback body without the
// signature field itself. Both officially documented serialisations are
// accepted: key order preserved as received (docs/integration.md) and the
// key-sorted form the official node SDK recomputes; each is tried plain and
// with PHP-style escaped slashes. Any match = authentic.
export function verifyCallback(data, key) {
  const received = String((data && data.verify_hash) || '');
  if (!received || !key || !data || typeof data !== 'object') return false;

  const rest = { ...data };
  delete rest.verify_hash;

  const candidates = [];
  const plain = JSON.stringify(rest);
  candidates.push(plain, plain.replace(/\//g, '\\/'));

  const sorted = {};
  Object.keys(rest)
    .sort()
    .forEach((k) => {
      sorted[k] = rest[k];
    });
  if ('expire_utc' in sorted) sorted.expire_utc = String(sorted.expire_utc);
  if ('tx_urls' in sorted) {
    try {
      sorted.tx_urls = decodeURIComponent(sorted.tx_urls);
    } catch {
      /* malformed percent-encoding: keep as received */
    }
  }
  const sortedJson = JSON.stringify(sorted);
  candidates.push(sortedJson, sortedJson.replace(/\//g, '\\/'));

  for (const msg of candidates) {
    if (safeEqual(hmacSha1(msg, key), received)) return true;
  }
  return false;
}

// ChangeNOW widget ticker for a Plisio psys_cid — the widget uses its own
// names (usdttrc20), not 'USDT_TRX'
const widgetCurrency = (code) => {
  const c = String(code || '').toUpperCase();
  if (c === 'USDT_TRX') return 'usdttrc20';
  if (c === 'USDT') return 'usdterc20';
  if (c === 'USDT_BSC') return 'usdtbsc';
  if (c === 'USDT_SOL') return 'usdtsol';
  if (c === 'USDT_TON') return 'usdtton';
  return c.toLowerCase();
};

// private/docker ranges are allowed on top of a configured allowlist —
// signature verification remains the primary gate either way
const PRIVATE_IP_RE =
  /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|fc|fd|fe80:|fde4:|172\.1[6-9]\.|172\.2[0-9]\.|172\.3[01]\.)/i;

function ipAllowed(ip) {
  if (WEBHOOK_IPS === '*') return true;
  if (!ip) return false;
  if (PRIVATE_IP_RE.test(ip)) return true;
  return WEBHOOK_IPS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((allowed) => ip === allowed || ip.replace(/^::ffff:/, '') === allowed);
}

function clientIp(req) {
  return String(req.get('x-real-ip') || req.get('x-forwarded-for')?.split(',')[0]?.trim() || req.socket.remoteAddress || '').replace(
    /^::ffff:/,
    ''
  );
}

// Plisio speaks GET only: every call carries api_key as a query parameter
async function api(path, params = {}) {
  const qs = new URLSearchParams({ api_key: API_KEY });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const res = await fetch(API_BASE + path + '?' + qs.toString(), { signal: AbortSignal.timeout(15000) });
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* upstream returned garbage */
  }
  return { http: res.status, json };
}

export function setupPlisio({ redis, io, wallet }) {
  const broadcast = wallet.broadcast;

  const configured = Boolean(API_KEY);
  const live = LIVE && configured;

  const rateLimit = async (bucket, limit, windowSec) => {
    try {
      const k = 'void:plisio:rl:' + bucket;
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, windowSec);
      return n <= limit;
    } catch {
      return true; // limiter never blocks payments on redis hiccups
    }
  };

  // one webhook event processed at most once (the wallet's seen marker is
  // the second, deeper line of defence for the credit itself)
  const claimEvent = async (id) => {
    try {
      const ok = await redis.set(seenKey(id), '1', 'EX', 86400, 'NX');
      return ok === 'OK';
    } catch {
      return true;
    }
  };

  // ---- payment event -> wallet credit / cancel / manual review ------------
  // Plisio operation status: new, pending, completed, expired, mismatch,
  // error, cancelled, cancelled_duplicate ("cancelled duplicate")
  const processEvent = async (d) => {
    const orderId = String(d.order_number || '');
    if (!ORDER_RE.test(orderId)) return { ok: false, reason: 'bad_order' };
    const inv = await redis.hgetall(invKey(orderId));
    if (!inv || !inv.owner) return { ok: false, reason: 'unknown_order' };

    const st = String(d.status || '')
      .toLowerCase()
      .replace(/\s+/g, '_');
    await redis.hset(invKey(orderId), 'status', st, 'updated', String(Date.now()));

    // amount is cross-checked against the stored price for the record; the
    // credit itself ALWAYS uses the stored cents (never the callback's sum)
    const expected = Math.round(Number(inv.cents) || 0);
    const paidCrypto = parseFloat(d.actual_amount || d.amount || 0) || 0;
    if (paidCrypto && d.invoice_total_sum && paidCrypto !== parseFloat(d.invoice_total_sum)) {
      console.error('[plisio] AMOUNT DRIFT order=' + orderId + ' paid=' + paidCrypto + ' expected=' + d.invoice_total_sum);
    }

    if (st === 'completed') {
      const r = await wallet.confirmTx(orderId, 'deposit:crypto');
      if (r.status === 'completed') {
        await redis.hset(invKey(orderId), 'credited', '1');
        broadcast(inv.owner, r.balance);
        console.log('[plisio] credited order=' + orderId + ' owner=' + inv.owner + ' cents=' + expected);
      }
      return { ok: true, credit: r.status, balance: r.balance || null };
    }

    if (st === 'mismatch') {
      // under/over payment: hold kept, money recorded — support resolves it
      console.error('[plisio] MISMATCH order=' + orderId + ' owner=' + inv.owner + ' cents=' + expected + ' — MANUAL REVIEW');
      return { ok: true, credit: 'mismatch' };
    }

    if (st === 'expired') {
      // expired WITH money on it is not an ordinary expiry (docs: check the
      // amount field) — keep the hold for manual review instead of cancelling
      if (paidCrypto > 0) {
        console.error('[plisio] EXPIRED WITH PAYMENT order=' + orderId + ' amount=' + paidCrypto + ' — MANUAL REVIEW');
        await redis.hset(invKey(orderId), 'status', 'mismatch');
        return { ok: true, credit: 'mismatch' };
      }
      if (inv.credited !== '1') await wallet.cancelPending(orderId);
      return { ok: true, credit: 'failed' };
    }

    if (st === 'error' || st === 'cancelled' || st === 'cancelled_duplicate') {
      if (inv.credited !== '1') await wallet.cancelPending(orderId);
      return { ok: true, credit: 'failed' };
    }

    // new / pending: status only — credit lands on `completed`
    return { ok: true, credit: 'pending' };
  };

  // the shape the frontend polls for: 'paid' / 'fail' / the raw plisio state
  const reportStatus = (inv) => {
    if (inv.credited === '1') return 'paid';
    const st = String(inv.status || 'new');
    // mismatch resolves the modal as failed; the hold stays for support
    if (st === 'expired' || st === 'error' || st === 'cancelled' || st === 'cancelled_duplicate' || st === 'mismatch') return 'fail';
    return st;
  };

  // ---- REST ---------------------------------------------------------------
  // the /api/pay/* contract the facade in index.js dispatches
  const handlers = {};

  // public feature flag for the deposit modal
  handlers.config = (_req, res) => {
    res.json({ live, min: DEPOSIT_MIN, max: DEPOSIT_MAX, currency: 'USD' });
  };

  // create an invoice; the pending top-up exists BEFORE the invoice so a
  // callback can never arrive for an order we did not record
  handlers.invoice = async (req, res) => {
    try {
      const owner = await wallet.ownerOf(req);
      if (!owner) return res.status(401).json({ error: 'unauthorized' });
      const rl = await rateLimit('inv:' + owner, 6, 600);
      if (!rl) return res.status(429).json({ error: 'rate_limited' });

      const amount = Math.floor(Number(req.body && req.body.amountCents));
      if (!Number.isFinite(amount) || amount < DEPOSIT_MIN || amount > DEPOSIT_MAX) {
        return res.status(400).json({ error: 'bad_amount', min: DEPOSIT_MIN, max: DEPOSIT_MAX });
      }

      // stub invoice: QA-only (hooks + token), never reachable in production
      const qaTok = String((req.body && req.body.qa) || req.get('x-qa-token') || '').trim();
      const mock =
        ENABLE_TEST_HOOKS &&
        QA_TOKEN &&
        req.body &&
        req.body.mock === 1 &&
        Boolean(qaTok) &&
        safeEqual(qaTok, QA_TOKEN);
      if (!live && !mock) return res.status(503).json({ error: 'gateway_disabled' });

      const orderId = nanoid(21); // alpha_dash, unique, 21 chars
      const q = await wallet.queueDeposit(owner, amount, { id: orderId });
      await redis
        .multi()
        .hset(invKey(orderId), {
          owner: String(owner),
          cents: String(amount),
          bonus: String(q.bonus || 0),
          status: 'new',
          ts: String(Date.now()),
        })
        .expire(invKey(orderId), INV_TTL)
        .exec();

      if (mock) {
        return res.json({
          ok: true,
          orderId,
          uuid: orderId,
          url: PUBLIC_URL + '/?mock_invoice=' + orderId,
          expiresAt: Math.floor(Date.now() / 1000) + INVOICE_LIFETIME,
          bonus: q.bonus || 0,
          mock: true,
        });
      }

      const { http, json } = await api('/invoices/new', {
        currency: PAY_CURRENCY,
        order_name: 'InternetVoid ' + orderId,
        order_number: orderId,
        source_currency: 'USD',
        source_amount: (amount / 100).toFixed(2),
        // ?json=true is mandatory: it makes Plisio POST a verifiable JSON body
        callback_url: PUBLIC_URL + '/api/pay/webhook?json=true',
        success_url: PUBLIC_URL + '/?topup=success',
        cancel_url: PUBLIC_URL + '/?topup=failed',
        description: 'InternetVoid balance top-up ' + orderId,
        expire_min: Math.round(INVOICE_LIFETIME / 60),
        plugin: 'internet-void',
        version: '1.0',
      });
      if (http !== 200 || !json || json.status !== 'success' || !json.data || !json.data.invoice_url) {
        await wallet.cancelPending(orderId);
        await redis.del(invKey(orderId));
        const msg = (json && json.data && (json.data.message || json.data.name)) || JSON.stringify(json) || '';
        console.error('[plisio] invoice failed http=' + http + ' msg=' + msg);
        return res.status(502).json({ error: 'upstream_failed', message: msg || null });
      }
      const r = json.data;
      await redis.hset(invKey(orderId), 'txnId', String(r.txn_id || ''), 'status', String(r.status || 'new'));

      // a regular (non white-label) shop returns the pay-to address up front —
      // the same contract np.js/cryptomus expose: the card widget sends
      // crypto straight there while the hosted page handles everything else
      let payin = null;
      if (r.wallet_hash) {
        payin = {
          address: String(r.wallet_hash),
          network: String(r.psys_cid || PAY_CURRENCY),
          currency: widgetCurrency(r.psys_cid || PAY_CURRENCY),
          amount: r.amount || null,
          paymentId: String(r.txn_id || ''),
        };
        await redis.hset(
          invKey(orderId),
          'payAddress',
          payin.address,
          'payCurrency',
          payin.currency,
          'paymentId',
          payin.paymentId
        );
      }

      res.json({
        ok: true,
        orderId,
        uuid: String(r.txn_id || ''),
        url: r.invoice_url,
        expiresAt: Math.floor(Date.now() / 1000) + INVOICE_LIFETIME,
        bonus: q.bonus || 0,
        payin,
        // fiat sum the card widget is pre-filled with (invoice + buffer)
        cardFiat: Math.ceil((amount / 100) * CARD_BUFFER),
      });
    } catch (e) {
      console.error('[plisio] invoice', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  };

  // pull the operation status server-side and process it through the exact
  // same logic as the callback — recovers missed IPNs
  handlers.status = async (req, res) => {
    try {
      const owner = await wallet.ownerOf(req);
      if (!owner) return res.status(401).json({ error: 'unauthorized' });
      const orderId = String(req.query.orderId || '');
      if (!ORDER_RE.test(orderId)) return res.status(400).json({ error: 'bad_order' });
      const inv = await redis.hgetall(invKey(orderId));
      if (!inv || inv.owner !== owner) return res.status(404).json({ error: 'unknown_order' });

      if (inv.credited === '1') {
        return res.json({ ok: true, status: 'paid', credited: true, balance: await wallet.getBalance(owner) });
      }

      // at most one upstream pull per order per 3 seconds
      const gate = await redis.set('void:plisio:sync:' + orderId, '1', 'EX', 3, 'NX');
      if (gate === 'OK' && live && inv.txnId) {
        const { http, json } = await api('/operations/' + encodeURIComponent(inv.txnId));
        if (http === 200 && json && json.status === 'success' && json.data && json.data.status) {
          await processEvent({ order_number: orderId, status: json.data.status, actual_amount: json.data.amount });
          const fresh = await redis.hgetall(invKey(orderId));
          return res.json({
            ok: true,
            status: reportStatus(fresh),
            credited: fresh.credited === '1',
            balance: await wallet.getBalance(owner),
          });
        }
      }
      res.json({ ok: true, status: reportStatus(inv), credited: false, balance: await wallet.getBalance(owner) });
    } catch (e) {
      console.error('[plisio] status', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  };

  // ---- callback (POST JSON, signed) ---------------------------------------
  // behind the express.text() parser in index.js: req.body is the RAW string
  // the HMAC must be recomputed over
  handlers.webhook = async (req, res) => {
    try {
      const ip = clientIp(req);
      if (!ipAllowed(ip)) {
        console.error('[plisio] callback rejected: ip ' + ip);
        return res.status(403).json({ error: 'ip_not_allowed' });
      }
      const rl = await rateLimit('wh:' + ip, 120, 60);
      if (!rl) return res.status(429).json({ error: 'rate_limited' });

      const raw = typeof req.body === 'string' ? req.body : '';
      if (!raw) return res.status(400).json({ error: 'empty_body' });

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return res.status(400).json({ error: 'bad_json' });
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'bad_json' });

      if (!verifyCallback(data, API_KEY)) {
        console.error('[plisio] callback rejected: bad signature ip=' + ip);
        return res.status(401).json({ error: 'bad_signature' });
      }

      // replay guard per event (order_number+status); the credit itself is
      // separately idempotent inside the wallet Lua
      const eventKey = String(data.order_number || '') + ':' + String(data.status || '');
      const fresh = await claimEvent(eventKey);
      if (!fresh) return res.json({ ok: true, dup: true });

      const out = await processEvent(data);
      res.json(out && out.ok ? { ok: true, ...out } : { ok: false, reason: out && out.reason });
    } catch (e) {
      console.error('[plisio] callback', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  };

  // standalone router for the rare direct mount; the facade in index.js
  // prefers the handlers above so a second gateway can take over per-request
  const router = express.Router();
  router.get('/config', handlers.config);
  router.post('/invoice', handlers.invoice);
  router.get('/status', handlers.status);
  router.post('/webhook', handlers.webhook);

  return { router, handlers, processEvent, live: () => live };
}
