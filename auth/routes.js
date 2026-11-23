// auth/routes.js
'use strict';
const express = require('express');
const { verifyPassword } = require('./password');
const { signValue, unsignValue } = require('./tokens');
const { setSessionCookie, clearSessionCookie, COOKIE, parseCookies } = require('./middleware');
const google = require('./google');
const { magicEnabled, makeMagic, sendMagicEmail } = require('./magic');

const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function mountAuth(app, { db, users, sessions, secret }) {
  const r = express.Router();
  const magic = makeMagic(db);
  const secure = (process.env.APP_ORIGIN || '').startsWith('https');

  const startSession = (res, userId) => setSessionCookie(res, signValue(sessions.create(userId), secret), secure);
  const safeUser = (u) => u && { id: u.id, email: u.email, name: u.name };

  r.get('/config', (req, res) => res.json({
    password: true, google: google.googleEnabled(), magic: magicEnabled()
  }));

  r.get('/me', (req, res) => res.json({ user: safeUser(req.user) }));

  r.post('/signup', (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const password = String((req.body || {}).password || '');
    const name = String((req.body || {}).name || '').trim();
    if (!EMAIL_RX.test(email)) return res.status(400).json({ error: 'valid email required' });
    if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
    if (users.findByEmail(email)) return res.status(409).json({ error: 'an account with that email already exists' });
    const u = users.createWithPassword(email, password, name);
    startSession(res, u.id);
    res.json({ user: safeUser(u) });
  });

  r.post('/login', (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const password = String((req.body || {}).password || '');
    const u = users.findByEmail(email);
    if (!u || !u.password_hash || !verifyPassword(password, u.password_hash)) {
      return res.status(401).json({ error: 'wrong email or password' });
    }
    startSession(res, u.id);
    res.json({ user: safeUser(u) });
  });

  r.post('/logout', (req, res) => {
    const signed = parseCookies(req.headers.cookie)[COOKIE];
    const token = signed ? unsignValue(signed, secret) : null;
    if (token) sessions.destroy(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // ---- magic link ----
  r.post('/magic/request', async (req, res) => {
    if (!magicEnabled()) return res.status(400).json({ error: 'email sign-in is not configured' });
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!EMAIL_RX.test(email)) return res.status(400).json({ error: 'valid email required' });
    const token = magic.create(email);
    const origin = (process.env.APP_ORIGIN || 'http://localhost:3101').replace(/\/$/, '');
    try { await sendMagicEmail(email, `${origin}/api/auth/magic/verify?token=${token}`); }
    catch (e) { return res.status(500).json({ error: 'could not send email' }); }
    res.json({ ok: true }); // do not reveal whether the email exists
  });

  r.get('/magic/verify', (req, res) => {
    const email = magic.consume(String(req.query.token || ''));
    if (!email) return res.status(400).send('This sign-in link is invalid or expired.');
    const u = users.createForMagic(email, '');
    startSession(res, u.id);
    res.redirect('/');
  });

  // ---- google ----
  r.get('/google', (req, res) => {
    if (!google.googleEnabled()) return res.status(400).send('Google sign-in is not configured.');
    const state = google.newState();
    res.append('Set-Cookie', `g_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
    res.redirect(google.buildAuthUrl(state));
  });

  r.get('/google/callback', async (req, res) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      if (!req.query.state || req.query.state !== cookies.g_state) return res.status(400).send('Bad OAuth state.');
      const profile = await google.exchangeCode(String(req.query.code || ''));
      const u = users.upsertGoogle(profile.sub, profile.email, profile.name);
      startSession(res, u.id);
      res.redirect('/');
    } catch (e) {
      console.error('[google callback] failed:', e && e.message);
      res.status(500).send('Google sign-in failed.');
    }
  });

  app.use('/api/auth', r);
}

module.exports = { mountAuth };
