import crypto from 'crypto';
import express from 'express';
import { nanoid } from 'nanoid';

// ---------------------------------------------------------------------------
// Cryptomus gateway (https://doc.cryptomus.com/)
//
//   POST /v1/payment   create an invoice (signed: merchant + md5(base64(body)+key))
//   POST /v1/payment/info  pull invoice status server-side (same signing)
//   POST /v1/payout    send crypto out (signed with the PAYOUT key)
//   webhook            raw body, sign = md5(base64(json without sign) + key)
//
// Security model (against forged/boosted transactions):
//   * every webhook signature is verified (timing-safe) against the raw body;
//     both PHP-style slash escaping and plain JSON are accepted as the
//     canonical form, exactly as documented by Cryptomus
//   * optional IP allowlist (Cryptomus egress 91.227.144.54 + private ranges)
//   * per-source rate limits on webhook / invoice / status / payout routes
//   * per-event idempotency (uuid+status SETNX) on top of the wallet's own
//     seen-marker Lua, so replays can never credit twice
//   * the credited amount is ALWAYS the amount WE stored when creating the
//     order — webhook amounts are cross-checked and only logged on mismatch
//   * order_id <-> owner binding lives server-side; a foreign or unknown
//     order_id credits nothing
//   * refund_paid after a credit triggers a best-effort clawback
//   * payout holds are debited before the payout request and refunded
//     exactly once on failure (HSETNX + wallet seen marker)
//
// Config (env): CRYPTOMUS_MERCHANT_ID, CRYPTOMUS_PAYMENT_KEY,
//   CRYPTOMUS_PAYOUT_KEY, CRYPTOMUS_LIVE=1, CRYPTOMUS_API_BASE,
//   CRYPTOMUS_WEBHOOK_IPS (comma list, '*' disables), PUBLIC_URL, ADMIN_TOKEN
// ---------------------------------------------------------------------------

const API_BASE = (process.env.CRYPTOMUS_API_BASE || 'https://api.cryptomus.com').replace(/\/$/, '');
const MERCHANT_ID = process.env.CRYPTOMUS_MERCHANT_ID || '';
const PAYMENT_KEY = process.env.CRYPTOMUS_PAYMENT_KEY || '';
const PAYOUT_KEY = process.env.CRYPTOMUS_PAYOUT_KEY || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const LIVE = process.env.CRYPTOMUS_LIVE === '1';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
// mock invoices are a QA harness: ENABLE_TEST_HOOKS + the QA token are both
// required, so the stub path is dark in production even with hooks on
const ENABLE_TEST_HOOKS = process.env.ENABLE_TEST_HOOKS === '1';
const QA_TOKEN = String(process.env.QA_TOKEN || '').trim();
const WEBHOOK_IPS = process.env.CRYPTOMUS_WEBHOOK_IPS ?? '91.227.144.54';

const DEPOSIT_MIN = 100; // $1
const DEPOSIT_MAX = 1000000; // $10 000
const INVOICE_LIFETIME = 3600; // seconds
const INV_TTL = 60 * 60 * 24 * 30; // audit record lives 30 days
const ORDER_RE = /^[A-Za-z0-9_-]{10,64}$/;
const CLIENT_ID_RE = /^v_[a-z0-9]{4,48}$/i;
const ADDRESS_RE = /^[A-Za-z0-9:_-]{8,128}$/;
const CUR_RE = /^[A-Za-z0-9]{2,12}$/;
const NET_RE = /^[A-Za-z0-9-]{2,20}$/;

const invKey = (id) => 'void:cm:inv:' + id;
const poKey = (id) => 'void:cm:po:' + id;
const seenKey = (id) => 'void:cm:wh:' + id;

// md5(base64(body) + key) — one algorithm for outbound requests and webhooks
export function signBody(bodyStr, key) {
  return crypto.createHash('md5').update(Buffer.from(bodyStr, 'utf8').toString('base64') + key).digest('hex');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Verify a webhook: parse the raw body, pull `sign` out and re-sign the rest.
// Cryptomus (PHP) escapes slashes when it encodes, so we accept both the
// escaped and the plain canonical form.
export function verifyWebhook(raw, keys) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data.sign !== 'string' || !data.sign) return null;
  const rest = { ...data };
  delete rest.sign;
  const forms = [JSON.stringify(rest).replace(/\//g, '\\/'), JSON.stringify(rest)];
  for (const key of keys) {
    if (!key) continue;
    for (const form of forms) {
      if (safeEqual(signBody(form, key), data.sign)) return data;
    }
  }
  return null;
}

// private/docker ranges are allowed on top of the documented egress ip —
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

async function api(path, payload, key) {
  const body = JSON.stringify(payload);
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: {
      merchant: MERCHANT_ID,
      sign: signBody(body, key),
      'content-type': 'application/json',
    },
    body,
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* upstream returned garbage */
  }
  return { http: res.status, json };
}

export function setupCryptomus({ redis, io, wallet }) {
  const broadcast = wallet.broadcast;

  const configured = Boolean(MERCHANT_ID && PAYMENT_KEY);
  const live = LIVE && configured;

  const rateLimit = async (bucket, limit, windowSec) => {
    try {
      const k = 'void:cm:rl:' + bucket;
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
  const processPayment = async (d) => {
    const orderId = String(d.order_id || '');
    if (!ORDER_RE.test(orderId)) return { ok: false, reason: 'bad_order' };
    const inv = await redis.hgetall(invKey(orderId));
    if (!inv || !inv.owner) return { ok: false, reason: 'unknown_order' };

    const st = String(d.status || '');
    await redis.hset(invKey(orderId), 'status', st, 'updated', String(Date.now()));

    // defence in depth: the stored amount is what gets credited, a webhook
    // claiming a different amount only produces an alert
    const expected = Math.round(Number(inv.cents) || 0);
    const got = Math.round((parseFloat(d.amount) || 0) * 100);
    if (got && expected && got !== expected) {
      console.error('[cryptomus] AMOUNT MISMATCH order=' + orderId + ' stored=' + expected + ' webhook=' + got);
    }

    if (st === 'paid' || st === 'paid_over') {
      const r = await wallet.confirmTx(orderId, 'deposit:crypto');
      if (r.status === 'completed') {
        await redis.hset(invKey(orderId), 'credited', '1');
        broadcast(inv.owner, r.balance);
        console.log('[cryptomus] credited order=' + orderId + ' owner=' + inv.owner + ' cents=' + expected);
      }
      return { ok: true, credit: r.status, balance: r.balance || null };
    }

    if (st === 'fail' || st === 'cancel' || st === 'system_fail') {
      await wallet.cancelPending(orderId);
      return { ok: true, credit: 'failed' };
    }

    if (st === 'refund_paid') {
      // the invoice was already credited: take the money back
      if (inv.credited === '1') {
        const claimed = await redis.set('void:cm:cb:' + orderId, '1', 'EX', 604800, 'NX');
        if (claimed === 'OK') {
          const r = await wallet.charge(inv.owner, expected, 'refund:' + orderId.slice(0, 24));
          if (!r.ok) {
            await redis.set('void:cm:debt:' + orderId, String(expected), 'EX', 604800);
            console.error('[cryptomus] CHARGEBACK FAILED order=' + orderId + ' owner=' + inv.owner + ' cents=' + expected);
          } else {
            console.warn('[cryptomus] clawed back order=' + orderId);
          }
        }
      }
      return { ok: true, credit: 'refunded' };
    }

    // check / process / confirm_check / wrong_amount* / locked / refund_*: status only
    return { ok: true, credit: 'pending' };
  };

  // ---- payout event -> close the hold or refund it exactly once ----------
  const processPayout = async (d) => {
    const orderId = String(d.order_id || '');
    if (!ORDER_RE.test(orderId)) return { ok: false, reason: 'bad_order' };
    const po = await redis.hgetall(poKey(orderId));
    if (!po || !po.owner) return { ok: false, reason: 'unknown_order' };

    const st = String(d.status || '');
    await redis.hset(poKey(orderId), 'status', st, 'updated', String(Date.now()));

    if (st === 'paid') {
      await redis.hset(poKey(orderId), 'completed', String(Date.now()));
      console.log('[cryptomus] payout paid order=' + orderId + ' owner=' + po.owner);
      return { ok: true, payout: 'paid' };
    }
      if (st === 'fail' || st === 'cancel' || st === 'system_fail') {
        // return the held amount exactly once: HSETNX is the first gate,
        // the wallet seen marker (via the -rf refund id) is the second
        const first = await redis.hsetnx(poKey(orderId), 'refunded', String(Date.now()));
        if (first === 1) {
          const cents = Math.round(Number(po.cents) || 0);
          const refundId = orderId + '-rf';
          await wallet.queueDeposit(po.owner, cents, { id: refundId, bonus: 0 });
          const r = await wallet.confirmTx(refundId, 'withdraw:refund');
          if (r.status === 'completed') broadcast(po.owner, r.balance);
          console.warn('[cryptomus] payout failed, refunded order=' + orderId + ' cents=' + cents);
        }
        return { ok: true, payout: 'refunded' };
      }
    return { ok: true, payout: 'pending' };
  };

  // ---- REST ---------------------------------------------------------------
  const router = express.Router();

  // public feature flag for the deposit modal
  router.get('/config', (_req, res) => {
    res.json({ live, min: DEPOSIT_MIN, max: DEPOSIT_MAX, currency: 'USD' });
  });

  // create a crypto invoice; the pending top-up exists BEFORE the invoice so
  // a webhook can never arrive for an order we did not record
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
          status: 'created',
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

      const { http, json } = await api(
        '/v1/payment',
        {
          amount: (amount / 100).toFixed(2),
          currency: 'USD',
          order_id: orderId,
          url_callback: PUBLIC_URL + '/api/cryptomus/webhook',
          url_return: PUBLIC_URL + '/',
          url_success: PUBLIC_URL + '/?topup=success',
          lifetime: INVOICE_LIFETIME,
          additional_data: String(owner),
        },
        PAYMENT_KEY
      );
      if (http !== 200 || !json || json.state !== 0 || !json.result || !json.result.url) {
        await wallet.cancelPending(orderId);
        await redis.del(invKey(orderId));
        console.error('[cryptomus] invoice failed http=' + http + ' msg=' + ((json && json.message) || ''));
        return res.status(502).json({ error: 'upstream_failed', message: (json && json.message) || null });
      }
      await redis.hset(invKey(orderId), 'uuid', String(json.result.uuid || ''), 'status', String(json.result.payment_status || 'check'));
      res.json({
        ok: true,
        orderId,
        uuid: json.result.uuid,
        url: json.result.url,
        expiresAt: json.result.expired_at || null,
        bonus: q.bonus || 0,
      });
    } catch (e) {
      console.error('[cryptomus] invoice', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // pull the invoice status server-side (signed request) and process it
  // through the exact same logic as the webhook — recovers missed webhooks
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
      const gate = await redis.set('void:cm:sync:' + orderId, '1', 'EX', 3, 'NX');
      if (gate === 'OK' && live) {
        const { http, json } = await api('/v1/payment/info', { order_id: orderId }, PAYMENT_KEY);
        if (http === 200 && json && json.state === 0 && json.result) {
          await processPayment(json.result);
          const fresh = await redis.hgetall(invKey(orderId));
          return res.json({
            ok: true,
            status: fresh.status || 'check',
            credited: fresh.credited === '1',
            balance: await wallet.getBalance(owner),
          });
        }
      }
      res.json({ ok: true, status: inv.status || 'check', credited: false, balance: await wallet.getBalance(owner) });
    } catch (e) {
      console.error('[cryptomus] status', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // payout: hold the user's balance first, then ask Cryptomus to send crypto.
  // disabled unless ADMIN_TOKEN is configured (real money moves here)
  router.post('/payout', async (req, res) => {
    try {
      if (!ADMIN_TOKEN) return res.status(403).json({ error: 'payout_disabled' });
      const tok = String(req.get('x-admin-token') || '');
      if (!safeEqual(tok, ADMIN_TOKEN)) return res.status(403).json({ error: 'forbidden' });
      if (!live) return res.status(503).json({ error: 'gateway_disabled' });
      const rl = await rateLimit('po', 10, 86400);
      if (!rl) return res.status(429).json({ error: 'rate_limited' });

      const owner = await wallet.ownerOf(req);
      if (!owner) return res.status(401).json({ error: 'unauthorized' });
      const cents = Math.floor(Number(req.body && req.body.amountCents));
      const toCurrency = String((req.body && req.body.toCurrency) || '');
      const network = String((req.body && req.body.network) || '');
      const address = String((req.body && req.body.address) || '');
      if (!Number.isFinite(cents) || cents < DEPOSIT_MIN || cents > DEPOSIT_MAX) {
        return res.status(400).json({ error: 'bad_amount' });
      }
      if (!CUR_RE.test(toCurrency)) return res.status(400).json({ error: 'bad_currency' });
      if (network && !NET_RE.test(network)) return res.status(400).json({ error: 'bad_network' });
      if (!ADDRESS_RE.test(address)) return res.status(400).json({ error: 'bad_address' });

      // daily outflow cap (cents) — hard stop against a hijacked admin token
      const day = new Date().toISOString().slice(0, 10);
      const spent = await redis.incrby('void:cm:po:day:' + day, cents);
      if (spent === cents) await redis.expire('void:cm:po:day:' + day, 172800);
      if (spent > 500000) return res.status(429).json({ error: 'daily_cap' });

      const hold = await wallet.charge(owner, cents, 'withdraw:hold');
      if (!hold.ok) return res.status(402).json({ error: 'insufficient', balance: hold.balance });

      const orderId = nanoid(21);
      await redis
        .multi()
        .hset(poKey(orderId), {
          owner: String(owner),
          cents: String(cents),
          status: 'process',
          ts: String(Date.now()),
        })
        .expire(poKey(orderId), INV_TTL)
        .exec();

      const { http, json } = await api(
        '/v1/payout',
        {
          amount: (cents / 100).toFixed(2),
          currency: 'USD',
          to_currency: toCurrency,
          order_id: orderId,
          address,
          ...(network ? { network } : {}),
          url_callback: PUBLIC_URL + '/api/cryptomus/webhook',
          is_subtract: false, // network fee comes out of the payout, not the hold
        },
        PAYOUT_KEY || PAYMENT_KEY
      );
      if (http !== 200 || !json || json.state !== 0 || !json.result) {
        // upstream refused: give the hold back exactly once
        await redis.hsetnx(poKey(orderId), 'refunded', String(Date.now()));
        const refundId = orderId + '-rf';
        await wallet.queueDeposit(owner, cents, { id: refundId, bonus: 0 });
        const r = await wallet.confirmTx(refundId, 'withdraw:refund');
        if (r.status === 'completed') broadcast(owner, r.balance);
        await redis.hset(poKey(orderId), 'status', 'fail');
        console.error('[cryptomus] payout failed http=' + http + ' msg=' + ((json && json.message) || ''));
        return res.status(502).json({ error: 'upstream_failed', message: (json && json.message) || null });
      }
      await redis.hset(poKey(orderId), 'uuid', String(json.result.uuid || ''));
      res.json({ ok: true, orderId, uuid: json.result.uuid, status: json.result.status || 'process' });
    } catch (e) {
      console.error('[cryptomus] payout', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ---- webhook (raw body) -------------------------------------------------
  // registered behind the express.text() parser installed in index.js before
  // express.json, so req.body is the RAW string we must sign over
  router.post('/webhook', async (req, res) => {
    try {
      const ip = clientIp(req);
      if (!ipAllowed(ip)) {
        console.error('[cryptomus] webhook rejected: ip ' + ip);
        return res.status(403).json({ error: 'ip_not_allowed' });
      }
      const rl = await rateLimit('wh:' + ip, 120, 60);
      if (!rl) return res.status(429).json({ error: 'rate_limited' });

      const raw = typeof req.body === 'string' ? req.body : '';
      if (!raw) return res.status(400).json({ error: 'empty_body' });

      let probe = null;
      try {
        probe = JSON.parse(raw);
      } catch {
        return res.status(400).json({ error: 'bad_json' });
      }
      const isPayout = String(probe.type || '') === 'payout';
      const keys = isPayout ? [PAYOUT_KEY, PAYMENT_KEY] : [PAYMENT_KEY, PAYOUT_KEY];
      const data = verifyWebhook(raw, keys);
      if (!data) {
        console.error('[cryptomus] webhook rejected: bad signature ip=' + ip);
        return res.status(401).json({ error: 'bad_signature' });
      }

      // replay guard per event (uuid+status); the credit itself is separately
      // idempotent inside the wallet Lua, this just skips the whole path
      const eventKey = String(data.uuid || data.order_id || '') + ':' + String(data.status || '');
      const fresh = await claimEvent(eventKey);
      if (!fresh) return res.json({ ok: true, dup: true });

      let out;
      if (isPayout) out = await processPayout(data);
      else out = await processPayment(data);
      res.json(out && out.ok ? { ok: true, ...out } : { ok: false, reason: out && out.reason });
    } catch (e) {
      console.error('[cryptomus] webhook', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  return { router, processPayment, processPayout, live: () => live };
}
