// auth/tokens.js
'use strict';
const crypto = require('crypto');

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function signValue(value, secret) {
  const v = String(value);
  const mac = crypto.createHmac('sha256', String(secret)).update(v).digest('base64url');
  return `${v}.${mac}`;
}

function unsignValue(signed, secret) {
  if (typeof signed !== 'string') return null;
  const i = signed.lastIndexOf('.');
  if (i <= 0) return null;
  const v = signed.slice(0, i);
  const mac = signed.slice(i + 1);
  const expected = crypto.createHmac('sha256', String(secret)).update(v).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return v;
}

module.exports = { randomToken, signValue, unsignValue };
