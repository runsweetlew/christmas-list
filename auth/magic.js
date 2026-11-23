// auth/magic.js
'use strict';
const { randomToken } = require('./tokens');

const TTL_MIN = 15;
const nowIso = () => new Date().toISOString();
function plusMin(n) { return new Date(Date.now() + n * 60000).toISOString(); }

function magicEnabled() { return !!process.env.SMTP_HOST; }

function makeMagic(db) {
  const ins = db.prepare('INSERT INTO login_tokens (token, email, expires, used, created) VALUES (?,?,?,0,?)');
  const get = db.prepare('SELECT * FROM login_tokens WHERE token = ?');
  const markUsed = db.prepare('UPDATE login_tokens SET used = 1 WHERE token = ?');

  return {
    create(email) {
      const token = randomToken(24);
      ins.run(token, String(email).trim().toLowerCase(), plusMin(TTL_MIN), nowIso());
      return token;
    },
    consume(token) {
      const t = get.get(token);
      if (!t || t.used || t.expires < nowIso()) return null;
      markUsed.run(token);
      return t.email;
    }
  };
}

async function sendMagicEmail(email, link) {
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Your sign-in link for The Christmas List',
    text: `Click to sign in (valid ${TTL_MIN} minutes):\n\n${link}\n\nIf you did not request this, ignore it.`
  });
}

module.exports = { magicEnabled, makeMagic, sendMagicEmail };
