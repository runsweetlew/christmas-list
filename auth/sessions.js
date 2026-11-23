// auth/sessions.js
'use strict';
const { randomToken } = require('./tokens');

const DAYS = 60;
const nowIso = () => new Date().toISOString();
function plusDays(n) { return new Date(Date.now() + n * 86400000).toISOString(); }

function makeSessions(db) {
  const ins = db.prepare('INSERT INTO sessions (token, user_id, expires, created) VALUES (?,?,?,?)');
  const get = db.prepare('SELECT * FROM sessions WHERE token = ?');
  const del = db.prepare('DELETE FROM sessions WHERE token = ?');
  const touch = db.prepare('UPDATE sessions SET expires = ? WHERE token = ?');
  const purge = db.prepare("DELETE FROM sessions WHERE expires < ?");

  return {
    create(userId) {
      const token = randomToken(32);
      ins.run(token, userId, plusDays(DAYS), nowIso());
      return token;
    },
    resolve(token) {
      if (!token) return null;
      const s = get.get(token);
      if (!s) return null;
      if (s.expires < nowIso()) { del.run(token); return null; }
      touch.run(plusDays(DAYS), token); // sliding refresh
      return s;
    },
    destroy(token) { if (token) del.run(token); },
    purgeExpired() { purge.run(nowIso()); }
  };
}

module.exports = { makeSessions, DAYS };
