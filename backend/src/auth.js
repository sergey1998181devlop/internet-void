import express from 'express';
import crypto from 'crypto';
import { verifyMessage } from 'ethers';

const SESSION_SECRET = process.env.SESSION_SECRET || 'void-dev-secret-change-me';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:8080').replace(/\/+$/, '');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

const sessionKey = (t) => 'void:session:' + t;
const userKey = (id) => 'void:user:' + id;
const metaKey = (id) => 'void:usermeta:' + id;
const nonceKey = (a) => 'void:ethnonce:' + String(a).toLowerCase();

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export { parseCookies };

// Google rejects redirect_uri unless it exactly matches the URL the user is
// browsing from (registered origin), so derive it from the request itself and
// only fall back to PUBLIC_URL for non-HTTP contexts.
function redirectUri(req) {
  const fwdProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = fwdProto || req.protocol;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (proto && host) return `${proto}://${host}/api/auth/google/callback`;
  return PUBLIC_URL + '/api/auth/google/callback';
}

export async function sessionFromToken(token, redis) {
  const payload = verifyToken(token);
  if (!payload) return null;
  const raw = await redis.get(sessionKey(token));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getSession(req) {
  const token = parseCookies(req).void_session;
  if (!token) return null;
  return sessionFromToken(token, req.app.locals.redis);
}

function sessionCookie(token) {
  const secure = PUBLIC_URL.startsWith('https') ? '; Secure' : '';
  return `void_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}${secure}`;
}

function slugId(provider, sub) {
  return 'u_' + crypto.createHash('sha1').update(provider + ':' + sub).digest('hex').slice(0, 20);
}

// ---------------------------------------------------------------------------
// guest history -> account (called after the user signs in)
// ---------------------------------------------------------------------------
export async function claimGuestHistory(clientId, session) {
  const redis = globalRedis;
  if (!redis || !clientId || clientId === session.userId) return 0;

  const gk = userKey(clientId);
  const uk = userKey(session.userId);
  const raw = await redis.lrange(gk, 0, 499);
  if (!raw.length) return 0;

  // preserve order: oldest first, then push the whole block to the head
  const items = raw.slice().reverse();
  await redis.rpush(uk, ...items);
  await redis.ltrim(uk, 0, 499);
  await redis.del(gk);
  return raw.length;
}

let globalRedis = null;
export function setRedis(redis) {
  globalRedis = redis;
}

// ---------------------------------------------------------------------------
export function createAuthRouter({ redis }) {
  setRedis(redis);
  const router = express.Router();

  const startSession = async (res, profile) => {
    const userId = slugId(profile.provider, profile.providerId);
    const session = {
      userId,
      provider: profile.provider,
      providerId: profile.providerId,
      name: profile.name,
      email: profile.email || null,
      avatar: profile.avatar || null,
      ts: Date.now(),
    };
    const token = signToken({ userId });
    await redis.set(sessionKey(token), JSON.stringify(session), 'EX', SESSION_TTL);
    await redis.set(metaKey(userId), JSON.stringify(session), 'EX', 60 * 60 * 24 * 365);
    res.setHeader('Set-Cookie', sessionCookie(token));
    return session;
  };

  // ---- status ------------------------------------------------------------
  router.get('/status', (_req, res) => {
    res.json({ google: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET), ethereum: true });
  });

  // ---- Google OAuth 2.0 --------------------------------------------------
  router.get('/google', (req, res) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(501).json({ error: 'google_not_configured' });
    }
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(req),
      response_type: 'code',
      scope: 'openid email profile',
      prompt: 'select_account',
    });
    res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
  });

  router.get('/google/callback', async (req, res) => {
    try {
      const code = req.query.code;
      if (!code) return res.redirect('/?auth=fail');

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri(req),
          grant_type: 'authorization_code',
        }),
      });
      const tokens = await tokenRes.json();
      if (!tokens.access_token) return res.redirect('/?auth=fail');

      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: 'Bearer ' + tokens.access_token },
      });
      const info = await infoRes.json();
      if (!info.sub) return res.redirect('/?auth=fail');

      await startSession(res, {
        provider: 'google',
        providerId: String(info.sub),
        name: info.name || info.email || 'Google user',
        email: info.email || null,
        avatar: info.picture || null,
      });

      res.redirect('/?auth=ok');
    } catch (e) {
      console.error('[auth] google callback', e.message);
      res.redirect('/?auth=fail');
    }
  });

  // ---- Sign-In with Ethereum --------------------------------------------
  const ethMessage = (address, nonce) =>
    [
      'The Internet Void wants you to sign in with your Ethereum account:',
      address,
      '',
      'Sign in to keep your sacrifices in the personal cabinet.',
      '',
      'URI: ' + PUBLIC_URL,
      'Nonce: ' + nonce,
    ].join('\n');

  router.get('/ethereum/nonce', async (req, res) => {
    const address = String(req.query.address || '');
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return res.status(400).json({ error: 'bad_address' });
    }
    const nonce = crypto.randomBytes(8).toString('hex');
    await redis.set(nonceKey(address), nonce, 'EX', 300);
    res.json({ message: ethMessage(address, nonce) });
  });

  router.post('/ethereum', async (req, res) => {
    try {
      const { address, signature } = req.body || {};
      if (!/^0x[0-9a-fA-F]{40}$/.test(String(address || ''))) {
        return res.status(400).json({ error: 'bad_address' });
      }
      const nonce = await redis.get(nonceKey(address));
      if (!nonce) return res.status(401).json({ error: 'nonce_expired' });

      let recovered;
      try {
        recovered = verifyMessage(ethMessage(address, nonce), signature);
      } catch {
        return res.status(401).json({ error: 'bad_signature' });
      }
      if (recovered.toLowerCase() !== String(address).toLowerCase()) {
        return res.status(401).json({ error: 'address_mismatch' });
      }
      await redis.del(nonceKey(address));

      const short = address.slice(0, 6) + '…' + address.slice(-4);
      const session = await startSession(res, {
        provider: 'ethereum',
        providerId: address.toLowerCase(),
        name: short,
        email: null,
        avatar: null,
      });
      res.json({ ok: true, user: session });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- logout ------------------------------------------------------------
  router.post('/logout', async (req, res) => {
    const token = parseCookies(req).void_session;
    if (token) await redis.del(sessionKey(token));
    res.setHeader('Set-Cookie', 'void_session=; Path=/; HttpOnly; Max-Age=0');
    res.json({ ok: true });
  });

  return router;
}
