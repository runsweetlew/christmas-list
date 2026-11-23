// auth/password.js
'use strict';
const crypto = require('crypto');

const N = 16384, r = 8, p = 1, KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, { N, r, p });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length, { N, r, p });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (e) {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
