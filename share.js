// share.js
'use strict';
const { randomToken } = require('./auth/tokens');
const nowIso = () => new Date().toISOString();

function makeShare(db) {
  const setToken = db.prepare('UPDATE recipients SET share_token = ?, updated = ? WHERE id = ?');
  const setHide = db.prepare('UPDATE recipients SET share_hide_claims = ?, updated = ? WHERE id = ?');
  const byToken = db.prepare('SELECT * FROM recipients WHERE share_token = ?');

  return {
    enable(recipientId) {
      const token = randomToken(24);
      setToken.run(token, nowIso(), recipientId);
      return token;
    },
    disable(recipientId) { setToken.run(null, nowIso(), recipientId); },
    setHideClaims(recipientId, hide) { setHide.run(hide ? 1 : 0, nowIso(), recipientId); },
    byToken: (token) => (token ? byToken.get(token) : null)
  };
}

module.exports = { makeShare };
