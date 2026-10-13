import crypto from 'crypto';
import express from 'express';
import { nanoid } from 'nanoid';
import { getSession, parseCookies, sessionFromToken } from './auth.js';
import { sanitizeAmount } from './tiers.js';

// ---------------------------------------------------------------------------
// Internal wallet: balance in integer cents, everything atomic inside Redis.
//   void:wallet:<owner>       hash  { balance }
//   void:wallet:tx:<owner>    list  newest-first JSON transactions (trimmed)
//   void:wallet:pending:<id>  hash  an unconfirmed top-up (TTL 24h)
//   void:wallet:seen:<id>     key   idempotency marker for confirmed top-ups
// ---------------------------------------------------------------------------

const walletKey = (id) => 'void:wallet:' + id;
const txKey = (id) => 'void:wallet:tx:' + id;
const pendingKey = (id) => 'void:wallet:pending:' + id;
const seenKey = (id) => 'void:wallet:seen:' + id;
const roomOf = (owner) => 'wallet:' + owner;

// what each server-verified effect command costs, in cents
export const EFFECT_COSTS = {
  overload: 25,
  white: 25,
  gargantua: 20,
  glitch: 10,
  bitcoin: 10,
};

const DEPOSIT_MIN = 100; // $1
const DEPOSIT_MAX = 1000000; // $10 000
const BONUS_THRESHOLD = 5000; // $50
const BONUS_RATE = 0.1;
const TX_TRIM = 1000;
const PENDING_TTL = 60 * 60 * 24;
const TX_ID_RE = /^[A-Za-z0-9_-]{10,32}$/;
const CLIENT_ID_RE = /^v_[a-z0-9]{4,48}$/i;
const WEBHOOK_SECRET = process.env.WALLET_WEBHOOK_SECRET || 'void-webhook-dev-secret';

// balance can never drop below zero: the check and the decrement happen in a
// single Lua script, so ten concurrent spends of $0.25 against $1.00 can
// credit exactly four of them no matter how the requests interleave
const SPEND_LUA = `
local bal = tonumber(redis.call('HGET', KEYS[1], 'balance') or '0') or 0
local cost = tonumber(ARGV[1]) or 0
if cost <= 0 or bal < cost then return {0, bal} end
local nb = bal - cost
redis.call('HSET', KEYS[1], 'balance', tostring(nb))
redis.call('LPUSH', KEYS[2], ARGV[2])
redis.call('LTRIM', KEYS[2], 0, 999)
return {1, nb}
`;

// confirm a pending top-up exactly once: the pending key is consumed inside
// the same script, a second webhook for the same tx hits the `seen` marker
const CREDIT_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  if redis.call('EXISTS', KEYS[4]) == 1 then return {-1, 0} end
  return {0, 0}
end
local bal = tonumber(redis.call('HGET', KEYS[2], 'balance') or '0') or 0
local amount = tonumber(ARGV[1]) or 0
local bonus = tonumber(ARGV[2]) or 0
local nb = bal + amount + bonus
redis.call('HSET', KEYS[2], 'balance', tostring(nb))
redis.call('LPUSH', KEYS[3], ARGV[3])
if bonus > 0 then redis.call('LPUSH', KEYS[3], ARGV[4]) end
redis.call('LTRIM', KEYS[3], 0, 999)
redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[4], '1', 'EX', 86400)
return {1, nb}
`;

// guest wallet -> account on claim: sums the balances and moves the history
const MERGE_LUA = `
local gb = tonumber(redis.call('HGET', KEYS[1], 'balance') or '0') or 0
if gb > 0 then
  local ub = tonumber(redis.call('HGET', KEYS[2], 'balance') or '0') or 0
  redis.call('HSET', KEYS[2], 'balance', tostring(ub + gb))
  redis.call('DEL', KEYS[1])
end
local gtx = redis.call('LRANGE', KEYS[3], 0, 999)
if #gtx > 0 then
  for i = 1, #gtx do redis.call('LPUSH', KEYS[4], gtx[i]) end
  redis.call('LTRIM', KEYS[4], 0, 999)
  redis.call('DEL', KEYS[3])
end
return tonumber(redis.call('HGET', KEYS[2], 'balance') or '0') or 0
`;

function txJson(uid, amount, type, desc, name) {
  const tx = { id: nanoid(14), uid, amount, type, status: 'completed', desc, ts: Date.now() };
  if (name) tx.name = name;
  return JSON.stringify(tx);
}

function hmacFor(txId, status) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(txId + '.' + status).digest('hex');
}

export function setupWallet({ redis, io }) {
  redis.defineCommand('walletSpend', { numberOfKeys: 2, lua: SPEND_LUA });
  redis.defineCommand('walletCredit', { numberOfKeys: 4, lua: CREDIT_LUA });
  redis.defineCommand('walletMerge', { numberOfKeys: 4, lua: MERGE_LUA });

  const broadcast = (owner, balance) => {
    if (owner) io.to(roomOf(owner)).emit('balance_update', { balance });
  };

  const getBalance = async (owner) => {
    const v = await redis.hget(walletKey(owner), 'balance');
    const n = Math.round(Number(v) || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const spend = async (owner, cost, desc, name) => {
    const tx = txJson(owner, -cost, 'spend', desc, name);
    const [ok, balance] = await redis.walletSpend(walletKey(owner), txKey(owner), cost, tx);
    return { ok: ok === 1, balance };
  };

  // spend + tell every tab of this owner the new balance (sacrifices,
  // gamma bursts and other paid actions go through here)
  const charge = async (owner, cost, desc, name) => {
    const r = await spend(owner, cost, desc, name);
    if (r.ok) broadcast(owner, r.balance);
    return r;
  };

  const listTx = async (owner) => {
    const raw = await redis.lrange(txKey(owner), 0, TX_TRIM - 1);
    const items = [];
    for (const s of raw) {
      try {
        items.push(JSON.parse(s));
      } catch {
        /* skip garbage */
      }
    }
    items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return items;
  };

  // confirm a pending top-up exactly once: the pending key is consumed inside
  // the same script, a second webhook for the same tx hits the `seen` marker.
  // `desc` lets callers label the credit (topup / deposit:crypto / refund)
  const confirmTx = async (txId, desc = 'topup') => {
    const id = String(txId || '');
    if (!TX_ID_RE.test(id)) return { status: 'unknown' };
    const p = await redis.hgetall(pendingKey(id));
    if (!p || !p.owner) {
      const seen = await redis.get(seenKey(id));
      return { status: seen ? 'already_processed' : 'unknown', owner: p && p.owner };
    }
    const owner = p.owner;
    const amount = Math.round(Number(p.amount) || 0);
    const bonus = Math.round(Number(p.bonus) || 0);
    const dep = txJson(owner, amount, 'deposit', desc);
    const bon = bonus > 0 ? txJson(owner, bonus, 'bonus', 'bonus:10%') : '';
    const [ok, balance] = await redis.walletCredit(
      pendingKey(id),
      walletKey(owner),
      txKey(owner),
      seenKey(id),
      amount,
      bonus,
      dep,
      bon
    );
    if (ok !== 1) return { status: ok === -1 ? 'already_processed' : 'unknown', owner };
    return { status: 'completed', owner, balance, amount, bonus };
  };

  // park a pending top-up WITHOUT confirming it (real gateways confirm it
  // later from a signed webhook). opts: { id } fixes the id (gateway order_id),
  // { bonus } forces the bonus (0 for refunds)
  const queueDeposit = async (owner, amount, opts = {}) => {
    const bonus =
      'bonus' in opts
        ? Math.max(0, Math.floor(Number(opts.bonus) || 0))
        : amount >= BONUS_THRESHOLD
          ? Math.floor(amount * BONUS_RATE)
          : 0;
    const txId = opts.id || nanoid(21);
    await redis
      .multi()
      .hset(pendingKey(txId), {
        owner,
        amount: String(amount),
        bonus: String(bonus),
        ts: String(Date.now()),
      })
      .expire(pendingKey(txId), PENDING_TTL)
      .exec();
    return { txId, bonus };
  };

  const cancelPending = async (id) => {
    const key = String(id || '');
    if (!key) return 0;
    return redis.del(pendingKey(key));
  };

  const createDeposit = async (owner, amount) => {
    const { txId, bonus } = await queueDeposit(owner, amount);
    const r = await confirmTx(txId);
    return { txId, bonus, ...r };
  };

  // REST: session user first, anonymous clientId otherwise (same trust model
  // as /api/my/:clientId)
  const resolveRestOwner = async (req) => {
    const session = await getSession(req);
    if (session && session.userId) return session.userId;
    const raw = String((req.body && req.body.clientId) || req.query.clientId || '');
    if (CLIENT_ID_RE.test(raw)) return raw;
    return null;
  };

  const resolveSocketOwner = async (socket) => {
    try {
      const token = parseCookies(socket.request.headers).void_session;
      if (token) {
        const s = await sessionFromToken(token, redis);
        if (s && s.userId) return s.userId;
      }
    } catch {
      /* fall through to the guest id */
    }
    const cid = String((socket.handshake.auth && socket.handshake.auth.clientId) || '');
    if (CLIENT_ID_RE.test(cid)) return cid;
    return null;
  };

  // ---- REST ---------------------------------------------------------------
  const router = express.Router();

  router.get('/balance', async (req, res) => {
    try {
      const owner = await resolveRestOwner(req);
      if (!owner) return res.status(401).json({ error: 'unauthorized' });
      res.json({ balance: await getBalance(owner), currency: 'usd', costs: EFFECT_COSTS });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/transactions', async (req, res) => {
    try {
      const owner = await resolveRestOwner(req);
      if (!owner) return res.status(401).json({ error: 'unauthorized' });
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const type = String(req.query.type || 'all');
      const status = String(req.query.status || 'all');
      let items = await listTx(owner);
      if (type !== 'all') items = items.filter((t) => t.type === type);
      if (status !== 'all') items = items.filter((t) => t.status === status);
      res.json({ total: items.length, offset, limit, items: items.slice(offset, offset + limit) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // simulated gateway: creates the pending top-up and confirms it through the
  // very same function a real payment webhook would call
  router.post('/deposit', async (req, res) => {
    try {
      const owner = await resolveRestOwner(req);
      if (!owner) return res.status(401).json({ error: 'unauthorized' });
      const amount = Math.floor(Number(req.body && req.body.amountCents));
      if (!Number.isFinite(amount) || amount < DEPOSIT_MIN || amount > DEPOSIT_MAX) {
        return res.status(400).json({ error: 'bad_amount', min: DEPOSIT_MIN, max: DEPOSIT_MAX });
      }
      const r = await createDeposit(owner, amount);
      if (r.status !== 'completed') return res.status(500).json({ error: 'deposit_failed' });
      broadcast(owner, r.balance);
      res.json({ ok: true, txId: r.txId, amount, bonus: r.bonus, balance: r.balance });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // real gateway path: HMAC-signed, idempotent
  router.post('/webhook', async (req, res) => {
    try {
      const { txId, status, signature } = req.body || {};
      const id = String(txId || '');
      const st = String(status || '');
      const sig = String(signature || '');
      const expect = hmacFor(id, st);
      const a = Buffer.from(sig);
      const b = Buffer.from(expect);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ error: 'bad_signature' });
      }
      if (st !== 'completed') {
        await redis.del(pendingKey(id));
        return res.json({ ok: true, status: 'failed' });
      }
      const r = await confirmTx(id);
      if (r.status === 'unknown') return res.status(404).json({ error: 'unknown_tx' });
      if (r.status === 'completed') broadcast(r.owner, r.balance);
      res.json({ ok: true, status: r.status, balance: r.balance || null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- socket -------------------------------------------------------------
  // The `effect` listener must exist the instant the socket connects: the
  // client may emit before the init payload finishes loading, and an event
  // with no listener is dropped silently. Owner resolution continues in the
  // background and the handler simply awaits it.
  const attachSocket = (socket) => {
    socket.data.walletOwner = null;
    const ready = resolveSocketOwner(socket)
      .then(async (owner) => {
        socket.data.walletOwner = owner;
        if (owner) {
          socket.join(roomOf(owner));
          socket.emit('wallet_state', { balance: await getBalance(owner), costs: EFFECT_COSTS });
        }
        return owner;
      })
      .catch((e) => {
        console.error('[wallet] attach', e.message);
        return null;
      });

    // The only server-verified effect command: check cost, spend atomically,
    // write the transaction, tell every tab of this owner the new balance.
    // Fixed costs live in EFFECT_COSTS; rickroll costs whatever amount the
    // user typed (any sum works — the keyword is what triggers the show).
    socket.on('effect', async (payload, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      try {
        const name = String((payload && payload.name) || '');
        let cost = EFFECT_COSTS[name];
        if (!cost && name === 'rickroll') {
          cost = Math.round(sanitizeAmount(payload && payload.amount) * 100);
        }
        if (!cost) return reply({ ok: false, reason: 'unknown_effect' });
        const owner = await ready;
        if (!owner) return reply({ ok: false, reason: 'unauthorized' });
        const r = await spend(owner, cost, 'effect:' + name, name);
        if (r.ok) broadcast(owner, r.balance);
        reply(
          r.ok
            ? { ok: true, balance: r.balance, cost }
            : { ok: false, reason: 'insufficient', balance: r.balance, cost }
        );
      } catch (e) {
        console.error('[wallet] effect', e.message);
        reply({ ok: false, reason: 'error' });
      }
    });
  };

  // guest -> account: called next to the historical claim
  const merge = async (guestId, userId) => {
    if (!guestId || guestId === userId) return 0;
    const balance = await redis.walletMerge(
      walletKey(guestId),
      walletKey(userId),
      txKey(guestId),
      txKey(userId)
    );
    return balance;
  };

  return {
    router,
    attachSocket,
    merge,
    getBalance,
    charge,
    ownerOf: resolveRestOwner,
    EFFECT_COSTS,
    // gateway hooks (cryptomus.js): park / confirm / cancel pending top-ups
    queueDeposit,
    confirmTx,
    cancelPending,
    broadcast,
  };
}
