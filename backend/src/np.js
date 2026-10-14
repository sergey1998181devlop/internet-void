import crypto from 'crypto';
import express from 'express';
import { nanoid } from 'nanoid';

// ---------------------------------------------------------------------------
// NOWPayments gateway
//   (https://documenter.getpostman.com/view/7907941/2s93JusNJt)
//
//   POST /v1/invoice     create a hosted invoice (x-api-key header)
//   GET  /v1/invoice/:id pull the invoice status server-side
//   IPN webhook          x-nowpayments-sig =
//                        HMAC-SHA512(ipn_secret, JSON.stringify(sortDeep(body)))
//
// Security model (against forged/boosted transactions):
//   * every IPN signature is verified (timing-safe) over the canonically
//     re-serialized payload — key order / whitespace never matter
//   * optional IP allowlist ('*' disables it; NOWPayments egress ips are
//     handed out on request to partners@nowpayments.io)
//   * per-source rate limits on webhook / invoice / status routes
//   * per-event idempotency (payment_id+status SETNX) on top of the wallet's
//     own seen-marker Lua, so replays can never credit twice
//   * the credited amount is ALWAYS the amount WE stored when creating the
//     order — webhook amounts are cross-checked and only logged on mismatch
//   * order_id <-> owner binding lives server-side; a foreign or unknown
//     order_id credits nothing
//   * refunded after a credit triggers a best-effort one-shot clawback
//
// Config (env): NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET,
//   NOWPAYMENTS_LIVE=1, NOWPAYMENTS_API_BASE, NOWPAYMENTS_WEBHOOK_IPS
//   (comma list, '*' disables), PUBLIC_URL, ENABLE_TEST_HOOKS, QA_TOKEN
// ---------------------------------------------------------------------------

const API_BASE = (process.env.NOWPAYMENTS_API_BASE || 'https://api.nowpayments.io/v1').replace(/\/$/, '');
const API_KEY = String(process.env.NOWPAYMENTS_API_KEY || '').trim();
const IPN_SECRET = String(process.env.NOWPAYMENTS_IPN_SECRET || '').trim();
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const LIVE = process.env.NOWPAYMENTS_LIVE === '1';
// mock invoices are a QA harness: ENABLE_TEST_HOOKS + the QA token are both
// required, so the stub path is dark in production even with hooks on
const ENABLE_TEST_HOOKS = process.env.ENABLE_TEST_HOOKS === '1';
const QA_TOKEN = String(process.env.QA_TOKEN || '').trim();
const WEBHOOK_IPS = process.env.NOWPAYMENTS_WEBHOOK_IPS ?? '*';

const DEPOSIT_MIN = 100; // $1
const DEPOSIT_MAX = 1000000; // $10 000
const INVOICE_LIFETIME = 3600; // seconds
const INV_TTL = 60 * 60 * 24 * 30; // audit record lives 30 days
const ORDER_RE = /^[A-Za-z0-9_-]{10,64}$/;
const CLIENT_ID_RE = /^v_[a-z0-9]{4,48}$/i;

const invKey = (id) => 'void:np:inv:' + id;
const seenKey = (id) => 'void:np:wh:' + id;

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// recursive alphabetical key sort — exactly what NOWPayments signs over
export function sortDeep(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  return Object.keys(obj)
    .sort()
    .reduce((acc, k) => {
      acc[k] = obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k]) ? sortDeep(obj[k]) : obj[k];
      return acc;
    }, {});
}

// verify x-nowpayments-sig: HMAC-SHA512 over the sorted canonical JSON
export function verifyIpn(data, sig, secret) {
  if (!secret || !sig || !data || typeof data !== 'object') return false;
  let canonical;
  try {
    canonical = JSON.stringify(sortDeep(data));
  } catch {
    return false;
  }
  const mac = crypto.createHmac('sha512', secret).update(canonical, 'utf8').digest('hex');
  return safeEqual(mac, String(sig).trim().toLowerCase());
}

// private/docker ranges are allowed on top of the configured egress ips —
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

async function api(method, path, payload) {
  const opts = { method, headers: { 'x-api-key': API_KEY } };
  if (payload !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(payload);
  }
  const res = await fetch(API_BASE + path, opts);
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* upstream returned garbage */
  }
  return { http: res.status, json };
}

export function setupPay({ redis, io, wallet }) {
  const broadcast = wallet.broadcast;

  const configured = Boolean(API_KEY && IPN_SECRET);
  const live = LIVE && configured;

  const rateLimit = async (bucket, limit, windowSec) => {
    try {
      const k = 'void:np:rl:' + bucket;
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

  // ---- payment event -> wallet credit / cancel / clawback ----------------
  // NOWPayments payment_status: waiting, confirming, confirmed, sending,
  // finished, failed, partially_paid, refunded, expired
  const processEvent = async (d) => {
    const orderId = String(d.order_id || '');
    if (!ORDER_RE.test(orderId)) return { ok: false, reason: 'bad_order' };
    const inv = await redis.hgetall(invKey(orderId));
    if (!inv || !inv.owner) return { ok: false, reason: 'unknown_order' };

    const st = String(d.payment_status || d.status || '').toLowerCase();
    await redis.hset(invKey(orderId), 'status', st, 'updated', String(Date.now()));

    // defence in depth: the stored amount is what gets credited, a webhook
    // claiming a different amount only produces an alert
    const expected = Math.round(Number(inv.cents) || 0);
    const got = Math.round((parseFloat(d.price_amount) || 0) * 100);
    if (got && expected && got !== expected) {
      console.error('[np] AMOUNT MISMATCH order=' + orderId + ' stored=' + expected + ' webhook=' + got);
    }

    if (st === 'finished') {
      const r = await wallet.confirmTx(orderId, 'deposit:crypto');
      if (r.status === 'completed') {
        await redis.hset(invKey(orderId), 'credited', '1');
        broadcast(inv.owner, r.balance);
        console.log('[np] credited order=' + orderId + ' owner=' + inv.owner + ' cents=' + expected);
      }
      return { ok: true, credit: r.status, balance: r.balance || null };
    }

    if (st === 'failed' || st === 'expired') {
      // cancelPending is a no-op once the top-up is credited
      if (inv.credited !== '1') await wallet.cancelPending(orderId);
      return { ok: true, credit: 'failed' };
    }

    if (st === 'refunded' || st === 'refunded_partial') {
      // the invoice was already credited: take the money back
      if (inv.credited === '1') {
        const claimed = await redis.set('void:np:cb:' + orderId, '1', 'EX', 604800, 'NX');
        if (claimed === 'OK') {
          const r = await wallet.charge(inv.owner, expected, 'refund:' + orderId.slice(0, 24));
          if (!r.ok) {
            await redis.set('void:np:debt:' + orderId, String(expected), 'EX', 604800);
            console.error('[np] CHARGEBACK FAILED order=' + orderId + ' owner=' + inv.owner + ' cents=' + expected);
          } else {
            console.warn('[np] clawed back order=' + orderId);
          }
        }
      }
      return { ok: true, credit: 'refunded' };
    }

    // waiting / confirming / confirmed / sending / partially_paid: status only
    return { ok: true, credit: 'pending' };
  };

  // the shape the frontend polls for: 'paid' / 'fail' / the raw waiting state
  const reportStatus = (inv) => {
    if (inv.credited === '1') return 'paid';
    const st = String(inv.status || 'waiting');
    if (st === 'failed' || st === 'expired' || st === 'fail' || st === 'cancel') return 'fail';
    return st;
  };

  // ---- REST ---------------------------------------------------------------
  const router = express.Router();

  // public feature flag for the deposit modal
  router.get('/config', (_req, res) => {
    res.json({ live, min: DEPOSIT_MIN, max: DEPOSIT_MAX, currency: 'USD' });
  });

  // create a hosted invoice; the pending top-up exists BEFORE the invoice so
  // an IPN can never arrive for an order we did not record
  router.post('/invoice', async (req, res) => {
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
          status: 'waiting',
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

      const { http, json } = await api('POST', '/invoice', {
        price_amount: Number((amount / 100).toFixed(2)),
        price_currency: 'usd',
        order_id: orderId,
        ipn_callback_url: PUBLIC_URL + '/api/pay/webhook',
        order_description: 'InternetVoid balance top-up ' + orderId,
        success_url: PUBLIC_URL + '/?topup=success',
        cancel_url: PUBLIC_URL + '/',
        is_fee_paid_by_user: true,
      });
      if (http < 200 || http >= 300 || !json || !json.invoice_url) {
        await wallet.cancelPending(orderId);
        await redis.del(invKey(orderId));
        console.error('[np] invoice failed http=' + http + ' msg=' + ((json && json.message) || JSON.stringify(json) || ''));
        return res.status(502).json({ error: 'upstream_failed', message: (json && json.message) || null });
      }
      await redis.hset(invKey(orderId), 'npId', String(json.id || ''), 'status', 'waiting');
      res.json({
        ok: true,
        orderId,
        uuid: String(json.id || ''),
        url: json.invoice_url,
        expiresAt: json.expires_at || null,
        bonus: q.bonus || 0,
      });
    } catch (e) {
      console.error('[np] invoice', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // pull the invoice status server-side (signed request) and process it
  // through the exact same logic as the webhook — recovers missed IPNs
  router.get('/status', async (req, res) => {
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
      const gate = await redis.set('void:np:sync:' + orderId, '1', 'EX', 3, 'NX');
      if (gate === 'OK' && live && inv.npId) {
        const { http, json } = await api('GET', '/invoice/' + encodeURIComponent(inv.npId));
        if (http === 200 && json && json.id) {
          await processEvent({ order_id: orderId, status: json.status, price_amount: json.price_amount });
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
      console.error('[np] status', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ---- IPN webhook --------------------------------------------------------
  // body arrives through express.json(); the signature is computed over the
  // canonically re-serialized payload, so raw-byte formatting never matters
  router.post('/webhook', async (req, res) => {
    try {
      const ip = clientIp(req);
      if (!ipAllowed(ip)) {
        console.error('[np] webhook rejected: ip ' + ip);
        return res.status(403).json({ error: 'ip_not_allowed' });
      }
      const rl = await rateLimit('wh:' + ip, 120, 60);
      if (!rl) return res.status(429).json({ error: 'rate_limited' });

      let data = req.body;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return res.status(400).json({ error: 'bad_json' });
        }
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'bad_json' });

      const sig = req.get('x-nowpayments-sig') || '';
      if (!verifyIpn(data, sig, IPN_SECRET)) {
        console.error('[np] webhook rejected: bad signature ip=' + ip);
        return res.status(401).json({ error: 'bad_signature' });
      }

      // replay guard per event (payment_id+status); the credit itself is
      // separately idempotent inside the wallet Lua
      const eventKey =
        String(data.payment_id || data.invoice_id || data.order_id || '') + ':' + String(data.payment_status || data.status || '');
      const fresh = await claimEvent(eventKey);
      if (!fresh) return res.json({ ok: true, dup: true });

      const out = await processEvent(data);
      res.json(out && out.ok ? { ok: true, ...out } : { ok: false, reason: out && out.reason });
    } catch (e) {
      console.error('[np] webhook', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  return { router, processEvent, live: () => live };
}
