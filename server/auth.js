// Who may call what:
//   - the desktop pet: sends a device token (Authorization: Bearer …) when DEVICE_TOKEN is set
//   - the parent: logs in with email + password and gets a signed, HttpOnly session cookie
// One parent account only (set in environment variables). No passwords are stored anywhere else.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'sb_parent';
const SESSION_DAYS = 7;
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function createAuth({ parentEmail, parentPassword, deviceToken, sessionSecret, cloud }) {
  const secret = sessionSecret || randomBytes(32).toString('hex'); // random = sessions reset on restart
  const email = (parentEmail || '').trim().toLowerCase();
  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');

  // In the cloud the parent password must be a real password, not the local demo PIN.
  const loginEnabled = Boolean(parentPassword) && (!cloud || parentPassword.length >= 8);

  function newSession() {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  function hasSession(req) {
    const value = readCookie(req, COOKIE);
    if (!value) return false;
    const [payload, sig] = value.split('.');
    if (!payload || !sig || !safeEqual(sign(payload), sig)) return false;
    try {
      return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
    } catch {
      return false;
    }
  }

  function setCookie(req, res, value, maxAgeSeconds) {
    const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
    if (req.secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  // Slow down password guessing: 8 wrong tries locks that address out for 15 minutes.
  const attempts = new Map();
  function lockedOut(ip) {
    const a = attempts.get(ip);
    return Boolean(a && a.count >= MAX_ATTEMPTS && a.until > Date.now());
  }
  function recordFailure(ip) {
    const a = attempts.get(ip);
    if (!a || a.until < Date.now()) attempts.set(ip, { count: 1, until: Date.now() + LOCKOUT_MS });
    else a.count += 1;
    if (attempts.size > 5000) attempts.clear();
  }

  return {
    emailRequired: Boolean(email),
    loginEnabled,

    login(req, res) {
      if (!loginEnabled) return res.status(503).json({ error: 'login_disabled' });
      if (lockedOut(req.ip)) return res.status(429).json({ error: 'too_many_attempts' });
      const given = req.body ?? {};
      const emailOk = !email || safeEqual(String(given.email ?? '').trim().toLowerCase(), email);
      const passwordOk = safeEqual(String(given.password ?? ''), parentPassword);
      if (!emailOk || !passwordOk) {
        recordFailure(req.ip);
        return res.status(401).json({ error: 'bad_login' });
      }
      attempts.delete(req.ip);
      setCookie(req, res, newSession(), SESSION_DAYS * 86400);
      res.json({ ok: true });
    },

    logout(req, res) {
      setCookie(req, res, '', 0);
      res.json({ ok: true });
    },

    requireParent(req, res, next) {
      if (hasSession(req)) return next();
      res.status(401).json({ error: 'login_required' });
    },

    requireDevice(req, res, next) {
      if (!deviceToken) return next(); // local mode: the server only listens on this computer
      const header = req.get('authorization') || '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (token && safeEqual(token, deviceToken)) return next();
      res.status(401).json({ error: 'bad_device_token' });
    },

    // Changes to parent data must come from the parent page itself (blocks cross-site requests).
    sameOrigin(req, res, next) {
      if (req.method === 'GET' || req.method === 'HEAD') return next();
      const origin = req.get('origin');
      if (!origin) return next();
      try {
        if (new URL(origin).host === req.get('host')) return next();
      } catch {
        /* fall through */
      }
      res.status(403).json({ error: 'bad_origin' });
    },
  };
}
