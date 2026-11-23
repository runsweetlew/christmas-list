// auth/google.js
'use strict';
const crypto = require('crypto');

function googleEnabled() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
function redirectUri() {
  const origin = process.env.APP_ORIGIN || 'http://localhost:3101';
  return origin.replace(/\/$/, '') + '/api/auth/google/callback';
}
function buildAuthUrl(state) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account'
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
}
function newState() { return crypto.randomBytes(16).toString('base64url'); }

async function exchangeCode(code) {
  const body = new URLSearchParams({
    code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(), grant_type: 'authorization_code'
  });
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error('google token exchange failed');
  const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: 'Bearer ' + tok.access_token }
  }).then((r) => r.json());
  if (!info.sub) throw new Error('google userinfo failed');
  return { sub: info.sub, email: info.email, name: info.name || info.given_name || '' };
}

module.exports = { googleEnabled, buildAuthUrl, newState, exchangeCode };
