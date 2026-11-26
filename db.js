'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'christmas.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS recipients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT '',
  emoji       TEXT NOT NULL DEFAULT '🎁',
  age         TEXT NOT NULL DEFAULT '',
  gender      TEXT NOT NULL DEFAULT '',
  keywords    TEXT NOT NULL DEFAULT '',
  wishlist    TEXT NOT NULL DEFAULT '',
  feedback    TEXT NOT NULL DEFAULT '',
  budget_min  INTEGER NOT NULL DEFAULT 0,
  budget_max  INTEGER NOT NULL DEFAULT 20000,
  sort        INTEGER NOT NULL DEFAULT 0,
  created     TEXT NOT NULL DEFAULT '',
  updated     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ideas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_id INTEGER NOT NULL,
  title       TEXT NOT NULL,
  descr       TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  est_price   INTEGER NOT NULL DEFAULT 0,       -- cents, estimate from source
  retailer    TEXT NOT NULL DEFAULT '',
  search_url  TEXT NOT NULL DEFAULT '',          -- where to shop for it
  product_url TEXT NOT NULL DEFAULT '',          -- concrete product (set when favorited)
  image       TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'pool',      -- pool | ai | web | custom
  rating      REAL NOT NULL DEFAULT 1500,        -- elo
  battles     INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active',    -- active | hidden | listed | purchased
  target_price INTEGER,                          -- cents, user target for price watch
  last_price  INTEGER,                           -- cents, most recent scraped/known
  purchased_price INTEGER,
  notes       TEXT NOT NULL DEFAULT '',
  why         TEXT NOT NULL DEFAULT '',          -- why it fits this person
  created     TEXT NOT NULL DEFAULT '',
  updated     TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (recipient_id) REFERENCES recipients(id)
);

CREATE INDEX IF NOT EXISTS idx_ideas_recipient ON ideas(recipient_id);
CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);

CREATE TABLE IF NOT EXISTS price_history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id   INTEGER NOT NULL,
  ts        TEXT NOT NULL,
  price     INTEGER NOT NULL,     -- cents
  ok        INTEGER NOT NULL DEFAULT 1,
  source    TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (idea_id) REFERENCES ideas(id)
);
CREATE INDEX IF NOT EXISTS idx_price_idea ON price_history(idea_id);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  google_sub    TEXT UNIQUE,
  created        TEXT NOT NULL DEFAULT '',
  updated        TEXT NOT NULL DEFAULT ''
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

// lightweight migrations for pre-existing databases
function ensureColumn(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}
ensureColumn('recipients', 'feedback', "TEXT NOT NULL DEFAULT ''");
ensureColumn('recipients', 'avoid', "TEXT NOT NULL DEFAULT ''");
ensureColumn('recipients', 'user_id', 'INTEGER');
ensureColumn('recipients', 'share_token', 'TEXT');
ensureColumn('recipients', 'share_hide_claims', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('ideas', 'amazon_url', "TEXT NOT NULL DEFAULT ''");
db.exec('CREATE INDEX IF NOT EXISTS idx_recipients_user ON recipients(user_id)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_recipients_share ON recipients(share_token) WHERE share_token IS NOT NULL');

module.exports = { db, DATA_DIR };
