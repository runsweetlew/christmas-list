# Accounts & Shareable Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user accounts (email+password now; Google + magic-link wired for later), scope all data per user, and let a user share one recipient's list via an unlisted link where visitors can claim items.

**Architecture:** Keep the existing Node/Express + better-sqlite3 single-file server, but factor auth and sharing into small focused modules (`auth/*`, `catalog_match.js`, `share.js`). Add `users`/`sessions`/`login_tokens`/`claims` tables and `user_id`/`share_token` columns on `recipients`. Gate `/api/*` with a `requireUser` middleware; add unauthenticated `/api/share/*` + a standalone public `/share/:token` page. Start fresh (wipe existing data).

**Tech Stack:** Node 20, Express 4, better-sqlite3, Node built-in `crypto` (scrypt + random tokens), Node built-in `node --test`, global `fetch` for Google OAuth, lazy `nodemailer` for magic-link email. Vanilla JS frontend.

---

## File Structure

- Create `auth/password.js` — scrypt hash + constant-time verify (pure).
- Create `auth/tokens.js` — random token gen + HMAC cookie signing/verify (pure).
- Create `auth/users.js` — user create/find DB helpers.
- Create `auth/sessions.js` — session create/lookup/delete DB helpers.
- Create `auth/middleware.js` — cookie parse, `attachUser`, `requireUser`.
- Create `auth/google.js` — OAuth URL build + code exchange (fetch).
- Create `auth/magic.js` — magic-link token create/consume + email send.
- Create `auth/routes.js` — mounts all `/api/auth/*` routes.
- Create `catalog_match.js` — `matchCatalog(recipient, catalog)` pure matcher.
- Create `share.js` — share token lifecycle + claims DB helpers.
- Create `public/share.html`, `public/share.js` — standalone public read-only list page.
- Modify `db.js` — new tables/columns + fresh-start reset.
- Modify `seed/seed.js` — export `seedPersonasFor(db, userId)` for "add sample people".
- Modify `server.js` — middleware, scoping, recipient auto-match, share + claim routes, static-serve guards.
- Modify `public/index.html`, `public/app.js`, `public/styles.css` — auth gate, user menu, share UI.
- Modify `package.json` — `test` script + `nodemailer` dep.
- Modify `.llm-env.example` -> add new env to a new `.env.example`.
- Create `test/*.test.js` — unit tests for the pure modules.
- Create `scripts/smoke.js` — end-to-end smoke run (in container).

---

## Task 0: Test harness

**Files:**
- Modify: `package.json`
- Create: `test/.gitkeep`

- [ ] **Step 1: Add test script and nodemailer dep to `package.json`**

```json
{
  "name": "christmas-gift-headtohead",
  "version": "1.0.0",
  "private": true,
  "description": "Elf x Christmas Vacation head-to-head gift finder + shopping list + price watch",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "scrape": "node scripts/price_scrape.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "express": "^4.21.0",
    "nodemailer": "^6.9.15"
  }
}
```

- [ ] **Step 2: Create the test dir**

```bash
mkdir -p test && touch test/.gitkeep
```

- [ ] **Step 3: Verify the runner works**

Run: `node --test test/`
Expected: `tests 0 ... pass 0` (no tests yet, exits 0).

- [ ] **Step 4: Commit**

```bash
git add package.json test/.gitkeep
git commit -m "test: add node --test harness and nodemailer dep"
```

---

## Task 1: Password hashing (`auth/password.js`)

**Files:**
- Create: `auth/password.js`
- Test: `test/password.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/password.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword } = require('../auth/password');

test('hash round-trips with the correct password', () => {
  const h = hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.strictEqual(verifyPassword('correct horse battery', h), true);
});

test('wrong password fails', () => {
  const h = hashPassword('correct horse battery');
  assert.strictEqual(verifyPassword('wrong', h), false);
});

test('tampered / malformed hash fails safely', () => {
  assert.strictEqual(verifyPassword('x', 'not-a-hash'), false);
  assert.strictEqual(verifyPassword('x', ''), false);
  assert.strictEqual(verifyPassword('x', null), false);
});

test('two hashes of the same password differ (random salt)', () => {
  assert.notStrictEqual(hashPassword('same'), hashPassword('same'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/password.test.js`
Expected: FAIL — cannot find module `../auth/password`.

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/password.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/password.js test/password.test.js
git commit -m "feat(auth): scrypt password hashing"
```

---

## Task 2: Token generation + cookie signing (`auth/tokens.js`)

**Files:**
- Create: `auth/tokens.js`
- Test: `test/tokens.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/tokens.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { randomToken, signValue, unsignValue } = require('../auth/tokens');

test('randomToken is urlsafe and the requested byte length', () => {
  const t = randomToken(24);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
  assert.notStrictEqual(randomToken(24), randomToken(24));
});

test('sign then unsign returns the original value', () => {
  const secret = 'test-secret';
  const signed = signValue('sess-abc', secret);
  assert.strictEqual(unsignValue(signed, secret), 'sess-abc');
});

test('tampered or wrong-secret signatures reject', () => {
  const signed = signValue('sess-abc', 'secret-a');
  assert.strictEqual(unsignValue(signed, 'secret-b'), null);
  assert.strictEqual(unsignValue(signed + 'x', 'secret-a'), null);
  assert.strictEqual(unsignValue('garbage', 'secret-a'), null);
  assert.strictEqual(unsignValue('', 'secret-a'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tokens.test.js`
Expected: FAIL — cannot find module `../auth/tokens`.

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tokens.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/tokens.js test/tokens.test.js
git commit -m "feat(auth): random tokens and HMAC-signed cookie values"
```

---

## Task 3: Catalog matcher (`catalog_match.js`)

**Files:**
- Create: `catalog_match.js`
- Test: `test/catalog_match.test.js`

This generalizes the `fits()` idea from `seed/seed.js` for arbitrary (non-persona)
recipients: score catalog items by keyword/wishlist overlap within a budget ceiling,
with the dog special case.

- [ ] **Step 1: Write the failing test**

```js
// test/catalog_match.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { matchCatalog } = require('../catalog_match');

const CAT = [
  { title: 'Fly Fishing Rod', descr: 'river rod', category: 'fishing', tags: ['anyone'], price_cents: 12000 },
  { title: 'Chew Toy', descr: 'durable', category: 'pets', tags: ['dogs'], price_cents: 2000 },
  { title: 'Gold Watch', descr: 'luxury', category: 'jewelry', tags: ['anyone'], price_cents: 500000 },
  { title: 'Camp Stove', descr: 'camping gear', category: 'outdoors', tags: ['anyone'], price_cents: 9000 },
];

test('matches by keyword overlap within budget', () => {
  const r = { keywords: 'fishing, camping', wishlist: '', budget_max: 20000 };
  const got = matchCatalog(r, CAT).map((i) => i.title);
  assert.ok(got.includes('Fly Fishing Rod'));
  assert.ok(got.includes('Camp Stove'));
  assert.ok(!got.includes('Gold Watch')); // over 1.4x budget
  assert.ok(!got.includes('Chew Toy'));   // dog-only item, non-dog recipient
});

test('dog recipients only get dog items', () => {
  const r = { keywords: 'dog toys treats', wishlist: '', budget_max: 12000, relationship: 'Dogs' };
  const got = matchCatalog(r, CAT).map((i) => i.title);
  assert.deepStrictEqual(got, ['Chew Toy']);
});

test('wishlist words also match', () => {
  const r = { keywords: '', wishlist: 'wants a nice watch', budget_max: 600000 };
  const got = matchCatalog(r, CAT).map((i) => i.title);
  assert.ok(got.includes('Gold Watch'));
});

test('respects the cap', () => {
  const big = Array.from({ length: 200 }, (_, i) => ({ title: 'Camp ' + i, descr: 'camping', category: 'outdoors', tags: ['anyone'], price_cents: 1000 }));
  const r = { keywords: 'camping', wishlist: '', budget_max: 20000 };
  assert.ok(matchCatalog(r, big, 80).length <= 80);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/catalog_match.test.js`
Expected: FAIL — cannot find module `../catalog_match`.

- [ ] **Step 3: Write minimal implementation**

```js
// catalog_match.js
'use strict';

function isDogRecipient(r) {
  const s = ((r.relationship || '') + ' ' + (r.keywords || '') + ' ' + (r.name || '')).toLowerCase();
  return /\bdogs?\b|\bpuppy\b|\bpup\b/.test(s);
}

function words(s) {
  return String(s || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
}

// Return catalog items that genuinely fit this recipient, best (most keyword
// overlap) first, capped. Dogs get only dog-tagged items; everyone else is
// matched by keyword/wishlist overlap within ~1.4x their max budget.
function matchCatalog(recipient, catalog, cap = 80) {
  const dog = isDogRecipient(recipient);
  const kws = [...new Set([...words(recipient.keywords), ...words(recipient.wishlist)])];
  const ceiling = Math.max(1, Number(recipient.budget_max) || 20000) * 1.4;
  const scored = [];
  for (const item of catalog) {
    const tags = item.tags || [];
    if (dog) { if (tags.includes('dogs')) scored.push({ item, score: 1 }); continue; }
    if (tags.includes('dogs')) continue; // dog gifts only for dogs
    const price = item.price_cents || 0;
    if (price > 0 && price > ceiling) continue;
    const hay = (item.category + ' ' + item.title + ' ' + item.descr).toLowerCase();
    const score = kws.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, cap).map((s) => s.item);
}

module.exports = { matchCatalog };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/catalog_match.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add catalog_match.js test/catalog_match.test.js
git commit -m "feat: catalog matcher for new recipients"
```

---

## Task 4: DB schema — new tables, ownership columns, fresh-start reset

**Files:**
- Modify: `db.js`

Start-fresh: because the owner chose to discard existing data, the deploy wipes the
volume (Task 17). In code we additively create the new tables/columns so a dev DB
also upgrades cleanly.

- [ ] **Step 1: Add the new tables after the existing `meta` table block (`db.js:69-73`)**

Insert before the `lightweight migrations` comment:

```js
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  google_sub    TEXT UNIQUE,
  created       TEXT NOT NULL DEFAULT '',
  updated       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessions (
  token    TEXT PRIMARY KEY,
  user_id  INTEGER NOT NULL,
  expires  TEXT NOT NULL,
  created  TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_tokens (
  token   TEXT PRIMARY KEY,
  email   TEXT NOT NULL,
  expires TEXT NOT NULL,
  used    INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS claims (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id      INTEGER NOT NULL,
  claimer_name TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  created      TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (idea_id) REFERENCES ideas(id)
);
CREATE INDEX IF NOT EXISTS idx_claims_idea ON claims(idea_id);
`);
```

- [ ] **Step 2: Add the ownership columns via the existing `ensureColumn` helper (after `db.js:80`)**

```js
ensureColumn('recipients', 'user_id', 'INTEGER');
ensureColumn('recipients', 'share_token', 'TEXT');
ensureColumn('recipients', 'share_hide_claims', 'INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE INDEX IF NOT EXISTS idx_recipients_user ON recipients(user_id)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_recipients_share ON recipients(share_token) WHERE share_token IS NOT NULL');
```

- [ ] **Step 3: Verify it loads (in the node:20 container, since better-sqlite3 cannot build on local node 25)**

Run:
```bash
docker run --rm -v "$PWD":/app -w /app node:20-bookworm-slim \
  sh -c "npm install --omit=dev >/dev/null 2>&1 && node -e \"require('./db'); console.log('db ok')\""
```
Expected: `db ok`.

- [ ] **Step 4: Commit**

```bash
git add db.js
git commit -m "feat(db): users, sessions, login_tokens, claims, recipient ownership"
```

---

## Task 5: User + session DB helpers (`auth/users.js`, `auth/sessions.js`)

**Files:**
- Create: `auth/users.js`
- Create: `auth/sessions.js`

These wrap the DB; they are exercised by the smoke test (Task 17) rather than unit
tests (better-sqlite3 needs the container).

- [ ] **Step 1: Write `auth/users.js`**

```js
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
```

- [ ] **Step 2: Write `auth/sessions.js`**

```js
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
```

- [ ] **Step 3: Verify both modules load (container)**

Run:
```bash
docker run --rm -v "$PWD":/app -w /app node:20-bookworm-slim \
  sh -c "node -e \"const {db}=require('./db'); require('./auth/users').makeUsers(db); require('./auth/sessions').makeSessions(db); console.log('helpers ok')\""
```
Expected: `helpers ok`.

- [ ] **Step 4: Commit**

```bash
git add auth/users.js auth/sessions.js
git commit -m "feat(auth): user and session DB helpers"
```

---

## Task 6: Auth middleware (`auth/middleware.js`)

**Files:**
- Create: `auth/middleware.js`
- Test: `test/cookie.test.js` (the pure cookie parser)

- [ ] **Step 1: Write the failing test for the cookie parser**

```js
// test/cookie.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseCookies } = require('../auth/middleware');

test('parses a cookie header into a map', () => {
  assert.deepStrictEqual(parseCookies('a=1; cl_session=abc.def; b=2'),
    { a: '1', cl_session: 'abc.def', b: '2' });
});

test('handles missing / empty header', () => {
  assert.deepStrictEqual(parseCookies(undefined), {});
  assert.deepStrictEqual(parseCookies(''), {});
});

test('url-decodes values', () => {
  assert.deepStrictEqual(parseCookies('x=a%20b'), { x: 'a b' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cookie.test.js`
Expected: FAIL — cannot find module `../auth/middleware`.

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/cookie.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/middleware.js test/cookie.test.js
git commit -m "feat(auth): cookie parsing and session middleware"
```

---

## Task 7: Google OAuth helper (`auth/google.js`)

**Files:**
- Create: `auth/google.js`

Uses global `fetch` (Node 20). Dark until `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
are set.

- [ ] **Step 1: Write `auth/google.js`**

```js
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
```

- [ ] **Step 2: Verify it loads (any node)**

Run: `node -e "require('./auth/google'); console.log('google ok')"`
Expected: `google ok`.

- [ ] **Step 3: Commit**

```bash
git add auth/google.js
git commit -m "feat(auth): Google OAuth helper (activates when configured)"
```

---

## Task 8: Magic-link helper (`auth/magic.js`)

**Files:**
- Create: `auth/magic.js`

Lazy-requires `nodemailer`; dark until `SMTP_HOST` is set.

- [ ] **Step 1: Write `auth/magic.js`**

```js
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
```

- [ ] **Step 2: Verify it loads (container, so nodemailer is installed)**

Run:
```bash
docker run --rm -v "$PWD":/app -w /app node:20-bookworm-slim \
  sh -c "npm install --omit=dev >/dev/null 2>&1 && node -e \"require('./auth/magic'); console.log('magic ok')\""
```
Expected: `magic ok`.

- [ ] **Step 3: Commit**

```bash
git add auth/magic.js
git commit -m "feat(auth): magic-link helper (activates when SMTP configured)"
```

---

## Task 9: Auth routes (`auth/routes.js`)

**Files:**
- Create: `auth/routes.js`

Mounts `/api/auth/*`. Depends on helpers from Tasks 1-8.

- [ ] **Step 1: Write `auth/routes.js`**

```js
// auth/routes.js
'use strict';
const express = require('express');
const { verifyPassword } = require('./password');
const { signValue } = require('./tokens');
const { setSessionCookie, clearSessionCookie, COOKIE, parseCookies } = require('./middleware');
const { unsignValue } = require('./tokens');
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
      res.status(500).send('Google sign-in failed.');
    }
  });

  app.use('/api/auth', r);
}

module.exports = { mountAuth };
```

- [ ] **Step 2: Verify it loads (any node)**

Run: `node -e "require('./auth/routes'); console.log('routes ok')"`
Expected: `routes ok`.

- [ ] **Step 3: Commit**

```bash
git add auth/routes.js
git commit -m "feat(auth): signup/login/logout, magic-link, Google routes"
```

---

## Task 10: Wire auth into `server.js` + scope all data by user

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add requires + session secret + auth setup near the top (after `server.js:16`)**

```js
const fs = require('fs');
const crypto = require('crypto');
const { makeUsers } = require('./auth/users');
const { makeSessions } = require('./auth/sessions');
const { makeAuth } = require('./auth/middleware');
const { mountAuth } = require('./auth/routes');
const { matchCatalog } = require('./catalog_match');
const { DATA_DIR } = require('./db');

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const p = path.join(DATA_DIR, '.session-secret');
  try { return fs.readFileSync(p, 'utf8'); }
  catch (e) { const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(p, s, { mode: 0o600 }); return s; }
}
const SECRET = getSessionSecret();
const users = makeUsers(db);
const sessions = makeSessions(db);
sessions.purgeExpired();
const { attachUser, requireUser } = makeAuth({ sessions, users, secret: SECRET });
```

- [ ] **Step 2: Register middleware + auth routes immediately after `app.use(express.static(...))` (`server.js:16`)**

```js
app.use(attachUser);
mountAuth(app, { db, users, sessions, secret: SECRET });
app.get('/api/health', (req, res) => res.json({ ok: true })); // keep health public (move from bottom)
// everything below /api (except /api/auth and /api/share) requires a signed-in user:
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/share') || req.path === '/health') return next();
  return requireUser(req, res, next);
});
```

Remove the old `app.get('/api/health', ...)` line near the bottom (`server.js:439`).

- [ ] **Step 3: Scope recipient queries by user. Replace the prepared statements block for recipients (`server.js:24-25`, `insRecipient`, and the recipient list/get routes).**

Change `Q.recipients` and `Q.recipient` to be user-scoped by adding parameterized helpers. Replace lines `server.js:24-25`:

```js
  recipients: db.prepare('SELECT * FROM recipients WHERE user_id = ? ORDER BY sort, id'),
  recipient: db.prepare('SELECT * FROM recipients WHERE id = ? AND user_id = ?'),
```

Add `user_id` to the insert statement (`server.js:26-28`):

```js
  insRecipient: db.prepare(`INSERT INTO recipients
    (user_id, name, relationship, emoji, age, gender, keywords, wishlist, feedback, budget_min, budget_max, sort, created, updated)
    VALUES (@user_id,@name,@relationship,@emoji,@age,@gender,@keywords,@wishlist,@feedback,@budget_min,@budget_max,@sort,@created,@updated)`),
```

- [ ] **Step 4: Update every recipient fetch to pass `req.user.id`.**

- `/api/state` (`server.js:79-82`):

```js
app.get('/api/state', (req, res) => {
  const recipients = Q.recipients.all(req.user.id).map(recipientPayload);
  res.json({ recipients });
});
```

- `/api/recipients/:id` GET (`server.js:84-89`):

```js
app.get('/api/recipients/:id', (req, res) => {
  const r = Q.recipient.get(num(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const ideas = Q.ideasFor.all(r.id);
  res.json({ recipient: recipientPayload(r), ideas });
});
```

- `maxSort` query and insert in POST `/api/recipients` (`server.js:106-112`):

```js
app.post('/api/recipients', async (req, res) => {
  const c = cleanRecipient(req.body || {});
  const ts = nowIso();
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS s FROM recipients WHERE user_id = ?').get(req.user.id).s;
  const ins = Q.insRecipient.run({ ...c, user_id: req.user.id, sort: maxSort, created: ts, updated: ts });
  const r = Q.recipient.get(ins.lastInsertRowid, req.user.id);
  await populatePool(r); // Task 11
  res.json({ recipient: recipientPayload(r) });
});
```

- PUT `/api/recipients/:id` (`server.js:114-128`): change `Q.recipient.get(num(req.params.id))` to `Q.recipient.get(num(req.params.id), req.user.id)`.

- DELETE `/api/recipients/:id` (`server.js:130-139`): first verify ownership:

```js
app.delete('/api/recipients/:id', (req, res) => {
  const id = num(req.params.id);
  const owned = Q.recipient.get(id, req.user.id);
  if (!owned) return res.status(404).json({ error: 'not found' });
  const tx = db.transaction(() => {
    Q.delRecipientPrices.run(id);
    Q.delRecipientIdeas.run(id);
    Q.delRecipient.run(id);
  });
  tx();
  res.json({ ok: true });
});
```

- `generate`, `refine`, `feedback` routes: change their `Q.recipient.get(num(req.params.id))` to `Q.recipient.get(num(req.params.id), req.user.id)`.

- [ ] **Step 5: Scope idea-level routes by ownership. Add a guard helper after `recipientPayload` (`server.js:76`):**

```js
// Return the idea only if it belongs to one of this user's recipients.
const ideaOwnedBy = db.prepare(`SELECT ideas.* FROM ideas
  JOIN recipients ON recipients.id = ideas.recipient_id
  WHERE ideas.id = ? AND recipients.user_id = ?`);
function ownedIdea(ideaId, userId) { return ideaOwnedBy.get(ideaId, userId); }
```

Apply it in: `/api/ideas/:id/status`, `PUT /api/ideas/:id`, `DELETE /api/ideas/:id`,
`/api/ideas/:id/prices`, `/api/ideas/:id/price`, custom idea POST
`/api/recipients/:id/ideas`, and `/api/battle` (both ids), replacing the
`Q.idea.get(...)` lookups. Example for status (`server.js:346-348`):

```js
app.post('/api/ideas/:id/status', (req, res) => {
  const it = ownedIdea(num(req.params.id), req.user.id);
  if (!it) return res.status(404).json({ error: 'not found' });
```

For `/api/battle` (`server.js:307-327`) resolve each id with `ownedIdea(id, req.user.id)` instead of `Q.idea.get(id)`; return `400`/`404` if either is not owned. For `/api/battle/undo`, filter items to owned ideas before applying.

- [ ] **Step 6: Scope the shopping list (`server.js:422-437`):**

```js
app.get('/api/shopping-list', (req, res) => {
  const recipients = Q.recipients.all(req.user.id);
  // ...rest unchanged...
```

- [ ] **Step 7: Verify boot + scoping with the smoke test stub (container)**

Run:
```bash
docker run --rm -v "$PWD":/app -w /app -e DATA_DIR=/tmp/d node:20-bookworm-slim \
  sh -c "npm install --omit=dev >/dev/null 2>&1 && node -e \"require('./server'); setTimeout(()=>process.exit(0), 800)\""
```
Expected: logs the startup line with no throw.

- [ ] **Step 8: Commit**

```bash
git add server.js
git commit -m "feat: require auth and scope all data per user"
```

---

## Task 11: Auto-populate a new recipient's pool + sample personas

**Files:**
- Modify: `server.js`
- Modify: `seed/seed.js`

- [ ] **Step 1: Add `populatePool` to `server.js` (near `runGeneration`, after `server.js:140`):**

```js
const catalog = (() => { try { return require('./seed/catalog.json'); } catch (e) { return []; } })();

// Fill a brand-new recipient's head-to-head pool from the shared catalog so it is
// not empty before the user runs AI generation.
async function populatePool(r) {
  if (!catalog.length) return 0;
  const matches = matchCatalog(r, catalog, 80);
  const ts = nowIso();
  const tx = db.transaction(() => {
    for (const it of matches) {
      Q.insIdea.run({
        recipient_id: r.id, title: it.title, descr: it.descr || '', category: it.category || '',
        est_price: it.price_cents || 0, retailer: it.retailer || 'Amazon',
        search_url: it.url || amazonSearch(it.title), product_url: it.url || '',
        image: it.image || '', source: 'pool', why: it.why || '', created: ts, updated: ts
      });
    }
  });
  tx();
  return matches.length;
}
```

Note: `seed/catalog.json` uses `price_cents`, `url`, `image`, `tags` (confirmed in
`seed/seed.js:79-81`). `amazonSearch` is already imported from `./llm` (`server.js:6`).

- [ ] **Step 2: Add `seedPersonasFor` to `seed/seed.js` (export a per-user version).**

After `seedIfEmpty` (`seed/seed.js:87`), add:

```js
// Seed the 7 demo personas into one user's account (the "Add sample people" button).
function seedPersonasFor(db, userId) {
  const catalog = loadCatalog();
  const ts = nowIso();
  const insR = db.prepare(`INSERT INTO recipients
    (user_id, name, relationship, emoji, age, gender, keywords, wishlist, budget_min, budget_max, sort, created, updated)
    VALUES (@user_id,@name,@relationship,@emoji,@age,@gender,@keywords,@wishlist,@budget_min,@budget_max,@sort,@created,@updated)`);
  const insI = db.prepare(`INSERT INTO ideas
    (recipient_id, title, descr, category, est_price, retailer, search_url, product_url, image, source, why, created, updated)
    VALUES (@recipient_id,@title,@descr,@category,@est_price,@retailer,@search_url,@product_url,@image,'pool',@why,@created,@updated)`);
  const tx = db.transaction(() => {
    DEFAULTS.forEach((d, i) => {
      const r = insR.run({ ...d, user_id: userId, sort: i, created: ts, updated: ts });
      const rid = r.lastInsertRowid;
      for (const it of itemsFor(d.key, catalog)) {
        const url = it.url || amz(it.title);
        insI.run({ recipient_id: rid, title: it.title, descr: it.descr, category: it.category,
          est_price: it.price_cents, retailer: it.retailer, search_url: url, product_url: it.url || '',
          image: it.image || '', why: it.why, created: ts, updated: ts });
      }
    });
  });
  tx();
  return DEFAULTS.length;
}

module.exports = { seedIfEmpty, seedPersonasFor, DEFAULTS };
```

Also change the existing `module.exports` line (`seed/seed.js:89`) — it is replaced by the one above.

- [ ] **Step 3: Remove the global auto-seed (start-fresh = no global personas).**

In `server.js`, delete the `seedIfEmpty(db);` call (`server.js:12`) and its require
(`server.js:5`); instead require `seedPersonasFor`:

```js
const { seedPersonasFor } = require('./seed/seed');
```

- [ ] **Step 4: Add the "add sample people" route (near the other recipient routes):**

```js
app.post('/api/sample-people', async (req, res) => {
  const existing = Q.recipients.all(req.user.id).length;
  if (existing > 0) return res.status(400).json({ error: 'you already have people added' });
  const n = seedPersonasFor(db, req.user.id);
  res.json({ added: n, recipients: Q.recipients.all(req.user.id).map(recipientPayload) });
});
```

- [ ] **Step 5: Verify (container): a fresh DB has zero recipients at boot.**

Run:
```bash
docker run --rm -v "$PWD":/app -w /app -e DATA_DIR=/tmp/fresh node:20-bookworm-slim \
  sh -c "npm install --omit=dev >/dev/null 2>&1 && node -e \"const {db}=require('./db'); console.log('recipients:', db.prepare('SELECT COUNT(*) n FROM recipients').get().n)\""
```
Expected: `recipients: 0`.

- [ ] **Step 6: Commit**

```bash
git add server.js seed/seed.js
git commit -m "feat: populate new recipient pools from catalog; add sample-people seeding"
```

---

## Task 12: Share token lifecycle (`share.js` + owner routes)

**Files:**
- Create: `share.js`
- Modify: `server.js`

- [ ] **Step 1: Write `share.js`**

```js
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
```

- [ ] **Step 2: Wire owner share routes in `server.js` (after the recipient routes). Add `const { makeShare } = require('./share'); const share = makeShare(db);` near the other setup, and:**

```js
function shareUrl(req, token) {
  const origin = process.env.APP_ORIGIN || (req.protocol + '://' + req.get('host'));
  return origin.replace(/\/$/, '') + '/share/' + token;
}

app.post('/api/recipients/:id/share', (req, res) => {
  const r = Q.recipient.get(num(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const token = r.share_token || share.enable(r.id);
  res.json({ url: shareUrl(req, token), token, hideClaims: !!r.share_hide_claims });
});

app.post('/api/recipients/:id/share/rotate', (req, res) => {
  const r = Q.recipient.get(num(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const token = share.enable(r.id);
  res.json({ url: shareUrl(req, token), token });
});

app.delete('/api/recipients/:id/share', (req, res) => {
  const r = Q.recipient.get(num(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  share.disable(r.id);
  res.json({ ok: true });
});

app.put('/api/recipients/:id/share', (req, res) => {
  const r = Q.recipient.get(num(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  share.setHideClaims(r.id, !!(req.body && req.body.hideClaims));
  res.json({ ok: true, hideClaims: !!(req.body && req.body.hideClaims) });
});
```

- [ ] **Step 3: Include `share_token`/`share_hide_claims` state in the owner's recipient payload so the UI can show share status. Extend `recipientPayload` (`server.js:70-76`):**

```js
function recipientPayload(r) {
  const c = Q.counts.get(r.id) || {};
  return { ...r, shared: !!r.share_token, hideClaims: !!r.share_hide_claims, counts: {
    ideas: c.ideas || 0, active: c.active || 0, listed: c.listed || 0,
    purchased: c.purchased || 0, listed_total: c.listed_total || 0, spent: c.spent || 0
  } };
}
```

- [ ] **Step 4: Verify boot (container, same stub as Task 10 Step 7).** Expected: no throw.

- [ ] **Step 5: Commit**

```bash
git add share.js server.js
git commit -m "feat(share): owner share-link lifecycle (enable/rotate/disable/surprise)"
```

---

## Task 13: Public share + claim routes

**Files:**
- Modify: `server.js`

These are unauthenticated (allowed through by the Task 10 Step 2 guard, which skips
`/api/share`).

- [ ] **Step 1: Add claim statements + a simple per-IP rate limiter near the top-level setup:**

```js
const Qclaims = {
  forIdea: db.prepare('SELECT id, claimer_name, note, created FROM claims WHERE idea_id = ? ORDER BY created'),
  ins: db.prepare('INSERT INTO claims (idea_id, claimer_name, note, created) VALUES (?,?,?,?)'),
  del: db.prepare('DELETE FROM claims WHERE idea_id = ? AND claimer_name = ?')
};

const rl = new Map(); // ip -> [timestamps]
function rateLimited(req, max = 30, windowMs = 60000) {
  const ip = req.ip || 'x';
  const now = Date.now();
  const arr = (rl.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  rl.set(ip, arr);
  return arr.length > max;
}
```

- [ ] **Step 2: Add the public JSON + claim endpoints:**

```js
// Public read-only view of one shared list (no auth).
app.get('/api/share/:token', (req, res) => {
  res.set('X-Robots-Tag', 'noindex');
  const r = share.byToken(req.params.token);
  if (!r) return res.status(404).json({ error: 'not found' });
  const items = Q.ideasFor.all(r.id)
    .filter((i) => i.status === 'listed' || i.status === 'purchased')
    .map((i) => ({
      id: i.id, title: i.title, why: i.why, category: i.category, image: i.image,
      est_price: i.est_price, last_price: i.last_price, target_price: i.target_price,
      product_url: i.product_url, search_url: i.search_url, status: i.status,
      claims: Qclaims.forIdea.all(i.id)
    }));
  res.json({
    recipient: { name: r.name, emoji: r.emoji, relationship: r.relationship },
    items
  });
});

app.post('/api/share/:token/claim', (req, res) => {
  if (rateLimited(req)) return res.status(429).json({ error: 'slow down' });
  const r = share.byToken(req.params.token);
  if (!r) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const ideaId = num(b.ideaId);
  const name = str(b.name, 60).trim();
  if (!name) return res.status(400).json({ error: 'your name is required' });
  const it = Q.idea.get(ideaId);
  if (!it || it.recipient_id !== r.id) return res.status(400).json({ error: 'bad item' });
  Qclaims.ins.run(ideaId, name, str(b.note, 200), nowIso());
  res.json({ ok: true, claims: Qclaims.forIdea.all(ideaId) });
});

app.post('/api/share/:token/unclaim', (req, res) => {
  if (rateLimited(req)) return res.status(429).json({ error: 'slow down' });
  const r = share.byToken(req.params.token);
  if (!r) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const ideaId = num(b.ideaId);
  const name = str(b.name, 60).trim();
  const it = Q.idea.get(ideaId);
  if (!it || it.recipient_id !== r.id) return res.status(400).json({ error: 'bad item' });
  Qclaims.del.run(ideaId, name);
  res.json({ ok: true, claims: Qclaims.forIdea.all(ideaId) });
});
```

- [ ] **Step 3: Surface claims to the owner (unless surprise mode). Extend the owner `GET /api/recipients/:id` response to include claims per listed/purchased idea when `!r.share_hide_claims`.** In the GET route (`server.js:84-89`, already user-scoped in Task 10), map ideas:

```js
app.get('/api/recipients/:id', (req, res) => {
  const r = Q.recipient.get(num(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const showClaims = !r.share_hide_claims;
  const ideas = Q.ideasFor.all(r.id).map((i) => showClaims
    ? { ...i, claims: Qclaims.forIdea.all(i.id) }
    : i);
  res.json({ recipient: recipientPayload(r), ideas });
});
```

- [ ] **Step 4: Verify boot (container stub).** Expected: no throw.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(share): public read-only view and item claiming"
```

---

## Task 14: Public shared-list page (`public/share.html`, `public/share.js`)

**Files:**
- Create: `public/share.html`
- Create: `public/share.js`
- Modify: `server.js` (route `/share/:token` to this page; keep it out of the SPA catch-all)

- [ ] **Step 1: Add the explicit route before the SPA catch-all (`server.js:441`):**

```js
app.get('/share/:token', (req, res) => {
  res.set('X-Robots-Tag', 'noindex');
  res.sendFile(path.join(PUBLIC_DIR, 'share.html'));
});
```

The SPA catch-all `app.get('*', ...)` stays last; `/share/:token` is matched first.

- [ ] **Step 2: Create `public/share.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>A shared gift list</title>
  <link rel="stylesheet" href="/styles.css?v=11" />
</head>
<body class="share-body">
  <main id="share-root" class="share-wrap">
    <p class="share-loading">Loading…</p>
  </main>
  <script src="/share.js?v=1"></script>
</body>
</html>
```

- [ ] **Step 3: Create `public/share.js`**

```js
'use strict';
const token = location.pathname.split('/').pop();
const root = document.getElementById('share-root');
const dollars = (c) => c ? '$' + (c / 100).toFixed(2).replace(/\.00$/, '') : '';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const nameKey = 'cl_claimer_name';

async function api(path, opts) {
  const r = await fetch('/api/share/' + token + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'error');
  return r.json();
}

function claimLine(c) { return esc(c.claimer_name) + (c.note ? ' — ' + esc(c.note) : ''); }

function render(data) {
  const r = data.recipient;
  const mine = localStorage.getItem(nameKey) || '';
  const items = data.items.map((it) => {
    const claimed = it.claims && it.claims.length;
    const iHave = it.claims && it.claims.some((c) => c.claimer_name === mine && mine);
    const price = dollars(it.last_price || it.est_price);
    return `<article class="share-card${claimed ? ' is-claimed' : ''}">
      ${it.image ? `<img class="share-thumb" src="${esc(it.image)}" alt="" onerror="this.style.display='none'"/>` : ''}
      <div class="share-info">
        <h3>${esc(it.title)}</h3>
        ${it.why ? `<p class="share-why">${esc(it.why)}</p>` : ''}
        ${price ? `<p class="share-price">${price}</p>` : ''}
        ${it.product_url || it.search_url ? `<a class="share-link" target="_blank" rel="noopener" href="${esc(it.product_url || it.search_url)}">View product →</a>` : ''}
        ${claimed ? `<p class="share-claims">Claimed by: ${it.claims.map(claimLine).join(', ')}</p>` : ''}
        <button class="share-claim-btn" data-id="${it.id}" data-have="${iHave ? 1 : 0}">${iHave ? 'Release my claim' : "I'll buy this"}</button>
      </div>
    </article>`;
  }).join('');
  root.innerHTML = `<header class="share-head">
      <div class="share-emoji">${esc(r.emoji || '🎁')}</div>
      <h1>Gift list for ${esc(r.name)}</h1>
      <p class="share-sub">Claim what you plan to buy so no one doubles up.</p>
    </header>
    <section class="share-grid">${items || '<p>No items on this list yet.</p>'}</section>`;
  root.querySelectorAll('.share-claim-btn').forEach((btn) => btn.addEventListener('click', onClaim));
}

async function onClaim(e) {
  const btn = e.currentTarget;
  const id = Number(btn.dataset.id);
  const have = btn.dataset.have === '1';
  let name = localStorage.getItem(nameKey) || '';
  if (!name) { name = (prompt('Your name (so others know who claimed it):') || '').trim(); if (!name) return; localStorage.setItem(nameKey, name); }
  btn.disabled = true;
  try {
    await api('/' + (have ? 'unclaim' : 'claim'), { method: 'POST', body: JSON.stringify({ ideaId: id, name }) });
    load();
  } catch (err) { alert(err.message); btn.disabled = false; }
}

async function load() {
  try { render(await api('')); }
  catch (e) { root.innerHTML = '<p class="share-loading">This list is unavailable.</p>'; }
}
load();
```

- [ ] **Step 4: Append the shared-page styles to `public/styles.css`** (match the warm Prairie look; reuse existing CSS variables if present, else these fallbacks):

```css
/* ---- shared public list page ---- */
.share-body { margin: 0; }
.share-wrap { max-width: 820px; margin: 0 auto; padding: 32px 20px 64px; }
.share-head { text-align: center; margin-bottom: 32px; }
.share-emoji { font-size: 44px; }
.share-head h1 { margin: 8px 0 4px; }
.share-sub { color: #6b6256; }
.share-grid { display: grid; gap: 16px; }
.share-card { display: flex; gap: 16px; padding: 16px; border: 1px solid #e4ddcd; border-radius: 10px; background: #fff; }
.share-card.is-claimed { opacity: 0.78; }
.share-thumb { width: 96px; height: 96px; object-fit: contain; background: #fff; flex: 0 0 auto; }
.share-info { flex: 1; min-width: 0; }
.share-info h3 { margin: 0 0 4px; }
.share-why { color: #6b6256; margin: 0 0 6px; font-size: 14px; }
.share-price { font-weight: 600; margin: 0 0 6px; }
.share-link { display: inline-block; margin-bottom: 8px; }
.share-claims { font-size: 13px; color: #3f6b3f; margin: 6px 0; }
.share-claim-btn { padding: 8px 14px; border-radius: 6px; border: 1px solid #b1472d; background: #b1472d; color: #fff; cursor: pointer; }
.share-claim-btn:disabled { opacity: 0.6; cursor: default; }
.share-loading { text-align: center; color: #6b6256; padding: 48px 0; }
```

- [ ] **Step 5: Verify the page serves (container, run server + curl):**

Run:
```bash
docker run --rm -v "$PWD":/app -w /app -e DATA_DIR=/tmp/sv -p 3199:3101 node:20-bookworm-slim \
  sh -c "npm install --omit=dev >/dev/null 2>&1 && (node server.js & sleep 2; wget -qO- http://localhost:3101/share/nope | head -c 60; echo)"
```
Expected: HTML containing `A shared gift list` (the page loads; the token is invalid so JS shows "unavailable").

- [ ] **Step 6: Commit**

```bash
git add public/share.html public/share.js public/styles.css server.js
git commit -m "feat(share): public shared-list page with claiming"
```

---

## Task 15: Frontend auth gate + user menu

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Add an auth overlay to `public/index.html`** (immediately inside `<body>`, before the app root). Bump asset versions to `?v=11`:

```html
<div id="auth-gate" class="auth-gate" hidden>
  <div class="auth-card">
    <h1 class="auth-title">The Christmas List</h1>
    <p class="auth-tag">Sign in to keep your lists private.</p>
    <div class="auth-err" id="auth-err" hidden></div>
    <form id="auth-form">
      <label class="auth-name-row" id="auth-name-row" hidden>
        <span>Name</span><input id="auth-name" type="text" autocomplete="name" />
      </label>
      <label><span>Email</span><input id="auth-email" type="email" autocomplete="email" required /></label>
      <label><span>Password</span><input id="auth-password" type="password" autocomplete="current-password" required minlength="8" /></label>
      <button type="submit" class="auth-submit" id="auth-submit">Sign in</button>
    </form>
    <p class="auth-toggle"><a href="#" id="auth-switch">New here? Create an account</a></p>
    <div class="auth-alt" id="auth-alt"></div>
  </div>
</div>
```

Update `<script src="app.js?v=10">` and `<link ... styles.css?v=10>` to `?v=11`.

- [ ] **Step 2: Add auth bootstrapping at the top of `public/app.js`** (before the app initializes its views). This gates the app on `GET /api/auth/me`:

```js
// ---- auth gate ----
const AUTH = { user: null };
async function authFetch(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 401) { showAuthGate(); throw new Error('not signed in'); }
  return r;
}
function showAuthGate() { document.getElementById('auth-gate').hidden = false; }
function hideAuthGate() { document.getElementById('auth-gate').hidden = true; }

async function initAuth() {
  const cfg = await fetch('/api/auth/config').then((r) => r.json()).catch(() => ({ password: true }));
  const me = await fetch('/api/auth/me').then((r) => r.json()).catch(() => ({ user: null }));
  renderAuthAlt(cfg);
  if (me.user) { AUTH.user = me.user; hideAuthGate(); return true; }
  showAuthGate();
  return false;
}

function renderAuthAlt(cfg) {
  const alt = document.getElementById('auth-alt');
  let html = '';
  if (cfg.google) html += `<a class="auth-google" href="/api/auth/google">Continue with Google</a>`;
  if (cfg.magic) html += `<p class="auth-magic"><a href="#" id="auth-magic-link">Email me a sign-in link instead</a></p>`;
  alt.innerHTML = html;
  if (cfg.magic) document.getElementById('auth-magic-link').addEventListener('click', onMagic);
}

let AUTH_MODE = 'login';
function wireAuthForm() {
  const form = document.getElementById('auth-form');
  const err = document.getElementById('auth-err');
  const nameRow = document.getElementById('auth-name-row');
  document.getElementById('auth-switch').addEventListener('click', (e) => {
    e.preventDefault();
    AUTH_MODE = AUTH_MODE === 'login' ? 'signup' : 'login';
    nameRow.hidden = AUTH_MODE === 'login';
    document.getElementById('auth-submit').textContent = AUTH_MODE === 'login' ? 'Sign in' : 'Create account';
    document.getElementById('auth-switch').textContent = AUTH_MODE === 'login' ? 'New here? Create an account' : 'Have an account? Sign in';
    document.getElementById('auth-password').autocomplete = AUTH_MODE === 'login' ? 'current-password' : 'new-password';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const body = JSON.stringify({
      name: document.getElementById('auth-name').value,
      email: document.getElementById('auth-email').value,
      password: document.getElementById('auth-password').value
    });
    try {
      const r = await fetch('/api/auth/' + (AUTH_MODE === 'login' ? 'login' : 'signup'),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'could not sign in');
      AUTH.user = d.user; hideAuthGate(); location.reload();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
}

async function onMagic(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  if (!email) { document.getElementById('auth-email').focus(); return; }
  await fetch('/api/auth/magic/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const err = document.getElementById('auth-err');
  err.textContent = 'Check your email for a sign-in link.'; err.hidden = false;
}
```

- [ ] **Step 3: Call the auth bootstrap before the existing app init.** Find the app's existing entry point (the first `load`/`init`/`DOMContentLoaded` call in `app.js`) and wrap it:

```js
document.addEventListener('DOMContentLoaded', async () => {
  wireAuthForm();
  const ok = await initAuth();
  if (!ok) return;      // stay on the gate until signed in
  startApp();           // <- the app's existing init function (rename the current entry to startApp)
});
```

Rename the current top-level init to `startApp()` if it is not already a named function. Ensure the app's data fetches use `authFetch` (or handle a 401 by calling `showAuthGate()`); at minimum, wrap the initial `/api/state` load so a dropped session re-shows the gate.

- [ ] **Step 4: Add a logout control to the app header.** In the header render (find the header markup in `app.js` or `index.html`), add:

```html
<button id="logout-btn" class="logout-btn" title="Sign out">Sign out</button>
```

Wire it in `startApp()`:

```js
const lo = document.getElementById('logout-btn');
if (lo) lo.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.reload();
});
```

- [ ] **Step 5: Add auth styles to `public/styles.css`:**

```css
/* ---- auth gate ---- */
.auth-gate { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #f3ecdd; z-index: 1000; }
.auth-card { width: 360px; max-width: 92vw; background: #fff; border: 1px solid #e4ddcd; border-radius: 12px; padding: 28px; }
.auth-title { margin: 0 0 4px; text-align: center; }
.auth-tag { margin: 0 0 18px; text-align: center; color: #6b6256; }
.auth-card label { display: block; margin-bottom: 12px; }
.auth-card label span { display: block; font-size: 13px; color: #6b6256; margin-bottom: 4px; }
.auth-card input { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #cfc6b4; border-radius: 6px; }
.auth-submit { width: 100%; padding: 11px; border: 0; border-radius: 6px; background: #2f5d3a; color: #fff; cursor: pointer; font-size: 15px; }
.auth-toggle { text-align: center; margin: 14px 0 0; }
.auth-err { background: #fbe9e6; color: #92311d; border-radius: 6px; padding: 9px 12px; margin-bottom: 12px; font-size: 14px; }
.auth-alt { margin-top: 16px; text-align: center; }
.auth-google { display: block; padding: 10px; border: 1px solid #cfc6b4; border-radius: 6px; text-decoration: none; color: #333; margin-bottom: 8px; }
.logout-btn { background: transparent; border: 1px solid #cfc6b4; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
```

- [ ] **Step 6: Verify (browser, against the container).** Start the container (Task 14 Step 5 pattern on port 3199), open `http://localhost:3199`, confirm: the gate shows; create an account; the app loads; reload keeps you signed in; Sign out returns to the gate.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat(ui): auth gate, signup/login, logout"
```

---

## Task 16: Frontend share UI (owner side)

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Add a Share control to the person detail view.** In the person-detail render (find where recipient actions like Edit/Generate render in `app.js`), add a button:

```html
<button class="share-toggle-btn" id="share-btn" data-id="${r.id}">${r.shared ? '🔗 Manage share link' : '🔗 Share this list'}</button>
<div id="share-panel" class="share-panel" hidden></div>
```

- [ ] **Step 2: Wire the share panel in `app.js`:**

```js
async function openSharePanel(recipient) {
  const panel = document.getElementById('share-panel');
  const d = await fetch('/api/recipients/' + recipient.id + '/share', { method: 'POST' }).then((r) => r.json());
  panel.hidden = false;
  panel.innerHTML = `
    <p class="share-help">Anyone with this link can view ${esc(recipient.name)}'s list and claim items. It is unlisted.</p>
    <div class="share-url-row">
      <input id="share-url" readonly value="${esc(d.url)}" />
      <button id="share-copy">Copy</button>
    </div>
    <label class="share-surprise"><input type="checkbox" id="share-hide" ${d.hideClaims ? 'checked' : ''}/> Surprise mode (hide who claimed what from me)</label>
    <div class="share-actions">
      <button id="share-rotate">Reset link</button>
      <button id="share-disable">Stop sharing</button>
    </div>`;
  document.getElementById('share-copy').addEventListener('click', () => {
    const el = document.getElementById('share-url'); el.select(); navigator.clipboard.writeText(el.value); toast('Link copied');
  });
  document.getElementById('share-hide').addEventListener('change', async (e) => {
    await fetch('/api/recipients/' + recipient.id + '/share', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hideClaims: e.target.checked }) });
    toast('Updated');
  });
  document.getElementById('share-rotate').addEventListener('click', async () => {
    const r2 = await fetch('/api/recipients/' + recipient.id + '/share/rotate', { method: 'POST' }).then((x) => x.json());
    document.getElementById('share-url').value = r2.url; toast('New link created; the old one no longer works');
  });
  document.getElementById('share-disable').addEventListener('click', async () => {
    await fetch('/api/recipients/' + recipient.id + '/share', { method: 'DELETE' });
    panel.hidden = true; toast('Sharing stopped');
  });
}
```

Bind `#share-btn` click to `openSharePanel(currentRecipient)` where the person view
wires its other buttons. Use the app's existing `toast(...)` helper (present per the
v5 notes) and the `esc(...)` helper (add the same `esc` used in `share.js` if the app
does not already have one).

- [ ] **Step 3: Optionally show a small "claimed" badge on listed items in the owner's shopping-list view** when `idea.claims?.length` and not in surprise mode:

```js
// where a listed idea row is rendered:
const claimBadge = (idea.claims && idea.claims.length) ? `<span class="claim-badge">Claimed by ${esc(idea.claims.map((c) => c.claimer_name).join(', '))}</span>` : '';
```

- [ ] **Step 4: Add share-panel styles to `public/styles.css`:**

```css
.share-panel { margin-top: 12px; padding: 14px; border: 1px solid #e4ddcd; border-radius: 8px; background: #faf6ec; }
.share-url-row { display: flex; gap: 8px; margin: 8px 0; }
.share-url-row input { flex: 1; padding: 8px; border: 1px solid #cfc6b4; border-radius: 6px; }
.share-help { font-size: 14px; color: #6b6256; margin: 0 0 4px; }
.share-surprise { display: block; font-size: 14px; margin: 10px 0; }
.share-actions { display: flex; gap: 8px; }
.share-actions button { padding: 7px 12px; border: 1px solid #cfc6b4; border-radius: 6px; background: #fff; cursor: pointer; }
.claim-badge { display: inline-block; font-size: 12px; color: #3f6b3f; margin-left: 8px; }
```

- [ ] **Step 5: Bump asset versions** in `index.html` from `?v=11` to `?v=12` (app.js + styles.css changed again).

- [ ] **Step 6: Verify (browser against container):** sign in, open a person, click Share, copy the link, open it in a private window, claim an item, confirm the claim shows on the owner side (and is hidden when surprise mode is on).

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/styles.css public/index.html
git commit -m "feat(ui): owner share panel (link, copy, rotate, surprise mode)"
```

---

## Task 17: End-to-end smoke test + env docs + deploy

**Files:**
- Create: `scripts/smoke.js`
- Create: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Write `scripts/smoke.js`** (boots the server on a temp DB, exercises the full flow over HTTP):

```js
'use strict';
// End-to-end smoke test. Run inside the node:20 container (better-sqlite3).
const { spawn } = require('child_process');
const PORT = 3188;
const BASE = 'http://localhost:' + PORT;

function sh(assert, msg) { if (!assert) { console.error('FAIL:', msg); process.exit(1); } console.log('ok:', msg); }

async function main() {
  const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR: '/tmp/smoke-' + Date.now() }, stdio: 'inherit' });
  await new Promise((r) => setTimeout(r, 1500));
  let cookie = '';
  const jar = (res) => { const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; };
  const j = (res) => res.json();
  const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(b) });
  const get = (p) => fetch(BASE + p, { headers: { Cookie: cookie } });
  try {
    let r = await post('/api/auth/signup', { email: 'a@test.com', password: 'password1', name: 'A' }); jar(r);
    sh(r.status === 200, 'signup');
    r = await get('/api/auth/me'); sh((await j(r)).user.email === 'a@test.com', 'me after signup');
    r = await get('/api/state'); sh((await j(r)).recipients.length === 0, 'fresh account has no recipients');
    r = await post('/api/recipients', { name: 'Dad', keywords: 'grilling, tools, outdoors', budget_max: 20000 });
    const rec = (await j(r)).recipient; sh(rec.counts.ideas > 0, 'new recipient pool populated from catalog');
    r = await post('/api/recipients/' + rec.id + '/share', {}); const share = await j(r);
    sh(/\/share\//.test(share.url), 'share link minted');
    // second user cannot see the first user's recipient
    let r2 = await post('/api/auth/signup', { email: 'b@test.com', password: 'password1', name: 'B' });
    const cookieB = r2.headers.get('set-cookie').split(';')[0];
    const rB = await fetch(BASE + '/api/recipients/' + rec.id, { headers: { Cookie: cookieB } });
    sh(rB.status === 404, 'cross-account access is blocked');
    // public share view (no cookie) + claim
    const token = share.token;
    let rp = await fetch(BASE + '/api/share/' + token); const pub = await rp.json();
    sh(pub.recipient.name === 'Dad', 'public share view loads');
    // list an item so it appears, then claim it
    const ideasRes = await get('/api/recipients/' + rec.id); const anIdea = (await ideasRes.json()).ideas[0];
    await post('/api/ideas/' + anIdea.id + '/status', { status: 'listed' });
    rp = await fetch(BASE + '/api/share/' + token); const pub2 = await rp.json();
    sh(pub2.items.length >= 1, 'listed item appears on share page');
    const cl = await fetch(BASE + '/api/share/' + token + '/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ideaId: pub2.items[0].id, name: 'Grandma' }) });
    sh((await cl.json()).claims.length === 1, 'claim recorded');
    console.log('\nSMOKE PASSED');
    srv.kill(); process.exit(0);
  } catch (e) { console.error(e); srv.kill(); process.exit(1); }
}
main();
```

- [ ] **Step 2: Run the smoke test (container):**

```bash
docker run --rm -v "$PWD":/app -w /app node:20-bookworm-slim \
  sh -c "npm install --omit=dev >/dev/null 2>&1 && node scripts/smoke.js"
```
Expected: ends with `SMOKE PASSED`.

- [ ] **Step 3: Run the full unit suite (local node is fine for the pure tests):**

```bash
node --test test/
```
Expected: all tests pass (password, tokens, catalog_match, cookie).

- [ ] **Step 4: Create `.env.example`**

```bash
# Session signing (auto-generated to data/.session-secret if unset)
SESSION_SECRET=
# Public origin, used for share links, OAuth redirect, magic-link URLs
APP_ORIGIN=https://christmas.lewbutler.com
# Google sign-in (optional; leave blank to disable the Google button)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Magic-link email (optional; leave SMTP_HOST blank to disable)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

- [ ] **Step 5: Update `docker-compose.yml` to also load `.env`** (non-secret app env). Add under `env_file`:

```yaml
    env_file:
      - path: .llm-env
        required: false
      - path: .env
        required: false
```

Add `APP_ORIGIN=https://christmas.lewbutler.com` to the `environment:` list as a default.

- [ ] **Step 6: Document accounts + sharing in `README.md`** (add a short "Accounts & sharing" section describing signup/login, the optional Google/magic env, and the unlisted share link + claiming). Also update the "Refine from winners" line to say top 50% (currently says 25%).

- [ ] **Step 7: Commit**

```bash
git add scripts/smoke.js .env.example docker-compose.yml README.md
git commit -m "test: end-to-end smoke; docs: accounts, sharing, env"
```

- [ ] **Step 8: Deploy to BASTIAT (start-fresh wipe).**

```bash
# from the Mac
rsync -av --exclude '.git' --exclude 'node_modules' --exclude '/data' ~/christmas-app/ bastiat-cf:deploy/christmas/
ssh bastiat-cf 'cd deploy/christmas && docker compose down && docker volume rm christmas_christmas-data && docker compose up -d --build christmas'
ssh bastiat-cf 'cd deploy/christmas && docker compose logs --tail=20 christmas'
```
Expected: the container boots, logs the startup line; `curl -s -o /dev/null -w "%{http_code}" https://christmas.lewbutler.com/` returns `200` and shows the auth gate.

- [ ] **Step 9: Push to GitHub.**

```bash
cd ~/christmas-app && git push origin main
```

---

## Self-Review Notes

- **Spec coverage:** accounts/login (Tasks 1-10), three auth methods (7, 8, 9 + config gating), per-user scoping (10), fresh start (4, 11, 17 Step 8), share one recipient's list (12, 14), claims (13), surprise mode (12, 13, 16), new-user catalog pool (11), sample personas (11), frontend gate + share UI (15, 16), security/noindex/rate-limit (13, 14), tests (1-3, 6, 17). All covered.
- **Type consistency:** `matchCatalog(recipient, catalog, cap)` used consistently (Tasks 3, 11). `share.enable/disable/setHideClaims/byToken` consistent (12, 13). `ownedIdea(id, userId)` consistent (10, 13). Catalog fields `price_cents/url/image/tags/descr/why` match `seed/seed.js` usage.
- **Cross-account safety** is asserted directly in the smoke test (Task 17 Step 1).
