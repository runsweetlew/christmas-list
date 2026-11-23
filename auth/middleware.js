// auth/middleware.js
'use strict';
const { unsignValue } = require('./tokens');

const COOKIE = 'cl_session';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch (e) { out[k] = v; }
  }
  return out;
}

function setSessionCookie(res, signedToken, secure) {
  const attrs = [`${COOKIE}=${encodeURIComponent(signedToken)}`, 'Path=/', 'HttpOnly',
    'SameSite=Lax', `Max-Age=${60 * 86400}`];
  if (secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Factory: given the sessions helper, users helper, and secret, returns middleware.
function makeAuth({ sessions, users, secret }) {
  function attachUser(req, res, next) {
    req.user = null;
    const cookies = parseCookies(req.headers.cookie);
    const signed = cookies[COOKIE];
    const token = signed ? unsignValue(signed, secret) : null;
    if (token) {
      const s = sessions.resolve(token);
      if (s) req.user = users.findById(s.user_id) || null;
    }
    next();
  }
  function requireUser(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'not signed in' });
    next();
  }
  return { attachUser, requireUser };
}

module.exports = { parseCookies, setSessionCookie, clearSessionCookie, makeAuth, COOKIE };
