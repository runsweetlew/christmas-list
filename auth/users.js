// auth/users.js
'use strict';
const { hashPassword } = require('./password');

const nowIso = () => new Date().toISOString();
const normEmail = (e) => String(e || '').trim().toLowerCase();

function makeUsers(db) {
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const byGoogle = db.prepare('SELECT * FROM users WHERE google_sub = ?');
  const ins = db.prepare(`INSERT INTO users (email, name, password_hash, google_sub, created, updated)
    VALUES (@email,@name,@password_hash,@google_sub,@created,@updated)`);
  const setGoogle = db.prepare('UPDATE users SET google_sub=?, updated=? WHERE id=?');

  return {
    findById: (id) => byId.get(id),
    findByEmail: (email) => byEmail.get(normEmail(email)),
    findByGoogle: (sub) => byGoogle.get(String(sub)),
    createWithPassword(email, password, name) {
      const ts = nowIso();
      const r = ins.run({ email: normEmail(email), name: String(name || '').slice(0, 80),
        password_hash: hashPassword(password), google_sub: null, created: ts, updated: ts });
      return byId.get(r.lastInsertRowid);
    },
    upsertGoogle(sub, email, name) {
      const existingBySub = byGoogle.get(String(sub));
      if (existingBySub) return existingBySub;
      const existingByEmail = email ? byEmail.get(normEmail(email)) : null;
      if (existingByEmail) { setGoogle.run(String(sub), nowIso(), existingByEmail.id); return byId.get(existingByEmail.id); }
      const ts = nowIso();
      const r = ins.run({ email: email ? normEmail(email) : null, name: String(name || '').slice(0, 80),
        password_hash: null, google_sub: String(sub), created: ts, updated: ts });
      return byId.get(r.lastInsertRowid);
    },
    createForMagic(email, name) {
      const existing = byEmail.get(normEmail(email));
      if (existing) return existing;
      const ts = nowIso();
      const r = ins.run({ email: normEmail(email), name: String(name || '').slice(0, 80),
        password_hash: null, google_sub: null, created: ts, updated: ts });
      return byId.get(r.lastInsertRowid);
    }
  };
}

module.exports = { makeUsers, normEmail };
