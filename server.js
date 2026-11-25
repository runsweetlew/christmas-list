'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { db, DATA_DIR } = require('./db');
const { seedPersonasFor } = require('./seed/seed');
const { generateIdeas, amazonSearch } = require('./llm');
const { resolveMany } = require('./bing_img');
const { makeUsers } = require('./auth/users');
const { makeSessions } = require('./auth/sessions');
const { makeAuth } = require('./auth/middleware');
const { mountAuth } = require('./auth/routes');
const { matchCatalog } = require('./catalog_match');
const { makeShare } = require('./share');
const { serpapiEnabled, searchShopping } = require('./serpapi');

const PORT = process.env.PORT || 3101;
const PUBLIC_DIR = path.join(__dirname, 'public');

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
const share = makeShare(db);

const app = express();
app.set('trust proxy', 1); // behind the Cloudflare tunnel; trust its forwarded client IP
app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR, { maxAge: '5m' }));

app.use(attachUser);
mountAuth(app, { db, users, sessions, secret: SECRET });
app.get('/api/health', (req, res) => res.json({ ok: true })); // keep health public (move from bottom)
// everything below /api (except /api/auth and /api/share) requires a signed-in user:
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/share') || req.path === '/health') return next();
  return requireUser(req, res, next);
});

const nowIso = () => new Date().toISOString();
const num = (v, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : n; };
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

// ---- prepared statements ----
const Q = {
  recipients: db.prepare('SELECT * FROM recipients WHERE user_id = ? ORDER BY sort, id'),
  recipient: db.prepare('SELECT * FROM recipients WHERE id = ? AND user_id = ?'),
  insRecipient: db.prepare(`INSERT INTO recipients
    (user_id, name, relationship, emoji, age, gender, keywords, wishlist, feedback, budget_min, budget_max, sort, created, updated)
    VALUES (@user_id,@name,@relationship,@emoji,@age,@gender,@keywords,@wishlist,@feedback,@budget_min,@budget_max,@sort,@created,@updated)`),
  updRecipient: db.prepare(`UPDATE recipients SET
    name=@name, relationship=@relationship, emoji=@emoji, age=@age, gender=@gender,
    keywords=@keywords, wishlist=@wishlist, feedback=@feedback, budget_min=@budget_min, budget_max=@budget_max, updated=@updated
    WHERE id=@id`),
  appendFeedback: db.prepare(`UPDATE recipients SET feedback=@feedback, updated=@updated WHERE id=@id`),
  delRecipient: db.prepare('DELETE FROM recipients WHERE id = ?'),
  delRecipientIdeas: db.prepare('DELETE FROM ideas WHERE recipient_id = ?'),
  delRecipientPrices: db.prepare('DELETE FROM price_history WHERE idea_id IN (SELECT id FROM ideas WHERE recipient_id = ?)'),

  ideasFor: db.prepare('SELECT * FROM ideas WHERE recipient_id = ? ORDER BY rating DESC, id'),
  idea: db.prepare('SELECT * FROM ideas WHERE id = ?'),
  insIdea: db.prepare(`INSERT INTO ideas
    (recipient_id, title, descr, category, est_price, retailer, search_url, product_url, image, source, why, created, updated)
    VALUES (@recipient_id,@title,@descr,@category,@est_price,@retailer,@search_url,@product_url,@image,@source,@why,@created,@updated)`),
  titlesFor: db.prepare('SELECT title FROM ideas WHERE recipient_id = ?'),
  banishedFor: db.prepare("SELECT title, category FROM ideas WHERE recipient_id = ? AND status = 'hidden' ORDER BY updated DESC LIMIT 30"),
  losersFor: db.prepare("SELECT title, category FROM ideas WHERE recipient_id = ? AND status = 'active' AND battles > 0 ORDER BY rating ASC LIMIT 12"),
  updRating: db.prepare('UPDATE ideas SET rating=@rating, battles=battles+1, updated=@updated WHERE id=@id'),
  setRatingExact: db.prepare('UPDATE ideas SET rating=@rating, battles=@battles, updated=@updated WHERE id=@id'),
  setStatus: db.prepare('UPDATE ideas SET status=@status, updated=@updated WHERE id=@id'),
  updIdea: db.prepare(`UPDATE ideas SET
    product_url=@product_url, target_price=@target_price, last_price=@last_price,
    purchased_price=@purchased_price, notes=@notes, est_price=@est_price, status=@status, updated=@updated
    WHERE id=@id`),
  delIdea: db.prepare('DELETE FROM ideas WHERE id = ?'),
  delIdeaPrices: db.prepare('DELETE FROM price_history WHERE idea_id = ?'),

  prices: db.prepare('SELECT ts, price, ok, source FROM price_history WHERE idea_id = ? ORDER BY ts'),
  insPrice: db.prepare('INSERT INTO price_history (idea_id, ts, price, ok, source) VALUES (?,?,?,?,?)'),
  setLastPrice: db.prepare('UPDATE ideas SET last_price=?, updated=? WHERE id=?'),

  counts: db.prepare(`SELECT
      SUM(CASE WHEN status IN ('active','hidden') THEN 1 ELSE 0 END) AS ideas,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='listed' THEN 1 ELSE 0 END) AS listed,
      SUM(CASE WHEN status='purchased' THEN 1 ELSE 0 END) AS purchased,
      SUM(CASE WHEN status='listed' THEN COALESCE(last_price, est_price) ELSE 0 END) AS listed_total,
      SUM(CASE WHEN status='purchased' THEN COALESCE(purchased_price, last_price, est_price) ELSE 0 END) AS spent
    FROM ideas WHERE recipient_id = ?`)
};

const Qclaims = {
  forIdea: db.prepare('SELECT id, claimer_name, note, created FROM claims WHERE idea_id = ? ORDER BY created'),
  ins: db.prepare('INSERT INTO claims (idea_id, claimer_name, note, created) VALUES (?,?,?,?)'),
  del: db.prepare('DELETE FROM claims WHERE idea_id = ? AND claimer_name = ?')
};

const rl = new Map(); // ip -> [timestamps]
function rateLimited(req, max = 30, windowMs = 60000) {
  // prefer the real client IP forwarded by Cloudflare, else the connection IP
  const ip = req.headers['cf-connecting-ip'] || req.ip || 'x';
  const now = Date.now();
  const arr = (rl.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  rl.set(ip, arr);
  // evict idle buckets so the map cannot grow unbounded
  if (rl.size > 5000) { for (const [k, v] of rl) { if (!v.length || now - v[v.length - 1] > windowMs) rl.delete(k); } }
  return arr.length > max;
}

function recipientPayload(r) {
  const c = Q.counts.get(r.id) || {};
  return { ...r, shared: !!r.share_token, hideClaims: !!r.share_hide_claims, counts: {
    ideas: c.ideas || 0, active: c.active || 0, listed: c.listed || 0,
    purchased: c.purchased || 0, listed_total: c.listed_total || 0, spent: c.spent || 0
  } };
}

// Return the idea only if it belongs to one of this user's recipients.
const ideaOwnedBy = db.prepare(`SELECT ideas.* FROM ideas
  JOIN recipients ON recipients.id = ideas.recipient_id
  WHERE ideas.id = ? AND recipients.user_id = ?`);
function ownedIdea(ideaId, userId) { return ideaOwnedBy.get(ideaId, userId); }

// ---- recipients ----
app.get('/api/state', (req, res) => {
  const recipients = Q.recipients.all(req.user.id).map(recipientPayload);
  res.json({ recipients });
});

app.get('/api/recipients/:id', (req, res) => {
  const r = Q.recipient.get(num(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const showClaims = !r.share_hide_claims;
  const ideas = Q.ideasFor.all(r.id).map((i) => showClaims
    ? { ...i, claims: Qclaims.forIdea.all(i.id) }
    : i);
  res.json({ recipient: recipientPayload(r), ideas });
});

function cleanRecipient(body) {
  return {
    name: str(body.name, 60) || 'Someone',
    relationship: str(body.relationship, 60),
    emoji: str(body.emoji, 8) || '🎁',
    age: str(body.age, 30),
    gender: str(body.gender, 30),
    keywords: str(body.keywords, 800),
    wishlist: str(body.wishlist, 1500),
    feedback: str(body.feedback, 2000),
    budget_min: Math.max(0, num(body.budget_min, 0)),
    budget_max: Math.max(100, num(body.budget_max, 20000))
  };
}

app.post('/api/recipients', async (req, res) => {
  const c = cleanRecipient(req.body || {});
  const ts = nowIso();
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS s FROM recipients WHERE user_id = ?').get(req.user.id).s;
  const ins = Q.insRecipient.run({ ...c, user_id: req.user.id, sort: maxSort, created: ts, updated: ts });
  const r = Q.recipient.get(ins.lastInsertRowid, req.user.id);
  await populatePool(r); // Task 11
  res.json({ recipient: recipientPayload(r) });
});

app.post('/api/sample-people', async (req, res) => {
  const existing = Q.recipients.all(req.user.id).length;
  if (existing > 0) return res.status(400).json({ error: 'you already have people added' });
  const n = seedPersonasFor(db, req.user.id);
  res.json({ added: n, recipients: Q.recipients.all(req.user.id).map(recipientPayload) });
});

app.put('/api/recipients/:id', (req, res) => {
  const r = Q.recipient.get(num(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const c = cleanRecipient(req.body || {});
  // preserve accumulated feedback unless explicitly provided
  const fbProvided = req.body.feedback !== undefined;
  if (!fbProvided) c.feedback = r.feedback || '';
  Q.updRecipient.run({ ...c, id: r.id, updated: nowIso() });
  // if the steering notes changed, purge existing ideas that match the avoid terms
  let purged = 0;
  if (fbProvided && (c.feedback || '').trim() !== (r.feedback || '').trim()) {
    purged = purgeAvoid(r.id, c.feedback).purged;
  }
  res.json({ recipient: recipientPayload(Q.recipient.get(r.id, req.user.id)), purged });
});

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

// ---- share links (owner) ----
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

// ---- public shared list + claims (no auth) ----
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

// ---- idea generation (shared) ----
async function runGeneration(r, rounds, liked) {
  rounds = Math.min(8, Math.max(1, rounds || 1));
  const seen = new Set(Q.titlesFor.all(r.id).map((x) => x.title.toLowerCase()));
  const ts = nowIso();
  let added = 0, provider = 'none', lastError = null;
  // Negative signal: what the shopper banished + the gifts losing head-to-head,
  // so the model stops suggesting unwanted things and whole unwanted categories.
  const banished = Q.banishedFor.all(r.id);
  const losers = Q.losersFor.all(r.id);
  const rejTitles = [...banished.map((x) => x.title), ...losers.slice(0, 6).map((x) => x.title)];
  const catCount = {};
  for (const b of banished) { if (b.category) catCount[b.category] = (catCount[b.category] || 0) + 1; }
  const rejCats = Object.entries(catCount).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map((e) => e[0]).slice(0, 8);
  const rejected = { titles: rejTitles, cats: rejCats };
  // Run all rounds concurrently so N rounds take ~1 call of latency instead of N.
  const avoid = Array.from(seen);
  const results = await Promise.all(Array.from({ length: rounds }, () => generateIdeas(r, avoid, liked, rejected)));
  const all = [];
  for (const { ideas, provider: p, error } of results) {
    if (p && p !== 'none') provider = p;
    if (error) lastError = error;
    if (ideas && ideas.length) all.push(...ideas);
  }
  // dedup against what the recipient already has / within this batch
  const fresh = [];
  for (const it of all) { const k = it.title.toLowerCase(); if (seen.has(k)) continue; seen.add(k); fresh.push(it); }
  // give generated ideas a real photo AND a matching product link from the same
  // search result, so the link and photo are consistent and accurate.
  let imgMap = new Map();
  try { imgMap = await resolveMany(fresh.map((f) => f.title), 6); } catch (e) { /* ignore */ }
  const insertTx = db.transaction(() => {
    for (const it of fresh) {
      const rr = imgMap.get(it.title) || {};
      Q.insIdea.run({
        recipient_id: r.id, title: it.title, descr: it.descr, category: it.category,
        est_price: it.est_price, retailer: it.retailer, search_url: it.search_url, product_url: rr.page || '',
        image: rr.image || '', source: it.source || 'ai', why: it.why, created: ts, updated: ts
      });
      added++;
    }
  });
  insertTx();
  return { added, provider, error: added ? null : lastError };
}

const catalog = (() => { try { return require('./seed/catalog.json'); } catch (e) { return []; } })();

// Fill a brand-new recipient's head-to-head pool from the shared catalog so it is
// not empty before the user runs AI generation.
// Build a head-to-head pool of at least TARGET items that ALL have a real photo:
// lead with interest-matched photographed items, then fill with photographed,
// gender/budget-appropriate catalog items so there's plenty to consider.
const POOL_TARGET = 110;

// What has this recipient rejected? Returns categories they've banished >=2x that
// are NOT among their stated interests (so nixing a few aviation items doesn't ban
// all aviation, but repeatedly banishing cookware bans kitchen stuff), plus any
// avoid-terms pulled from their steering notes. Used to keep the pool filler from
// re-introducing disliked items.
const AVOID_STOP = new Set(['with', 'your', 'sets', 'kits', 'tool', 'tools', 'gift', 'gifts', 'pack', 'piece', 'pieces', 'inch', 'premium', 'classic', 'ultimate', 'mini', 'large', 'small', 'steel', 'stainless', 'nonstick', 'wireless', 'original', 'deluxe', 'edition', 'bundle', 'accessory', 'accessories', 'kit']);
// Interest clusters so that nixing specific items in an interest doesn't ban the
// theme: a shopper into "bourbon" also implicitly likes whiskey/barware, "truck"
// covers cars/auto, "aviation" covers flight/pilot, etc.
const INTEREST_CLUSTERS = [
  ['bourbon', 'whiskey', 'whisky', 'scotch', 'rye', 'spirits', 'liquor', 'barware', 'cocktail', 'distill', 'bartending'],
  ['truck', 'car', 'cars', 'auto', 'automotive', 'vehicle', 'garage', 'motor', 'driving'],
  ['aviation', 'flight', 'pilot', 'aircraft', 'aeronautical', 'flying', 'aero', 'airplane'],
  ['fishing', 'boating', 'boat', 'marine', 'tackle', 'angler', 'kayak'],
  ['camping', 'hiking', 'outdoor', 'outdoors', 'trail', 'backpack'],
  ['coffee', 'espresso', 'barista'],
  ['cooking', 'kitchen', 'baking', 'bakeware', 'cookware', 'culinary', 'chef', 'grilling', 'grill'],
  ['running', 'fitness', 'gym', 'workout', 'exercise'],
  ['golf', 'golfing'],
  ['nerd', 'tech', 'technology', 'gaming', 'gamer', 'gadget', 'geek', 'science', 'computer', 'electronics'],
  ['music', 'vinyl', 'audio', 'headphone', 'records'],
  ['reading', 'books', 'book', 'literature'],
  ['gardening', 'garden', 'plant', 'plants'],
  ['beauty', 'skincare', 'makeup', 'cosmetics'],
  ['jewelry', 'jewellery', 'necklace', 'earrings', 'bracelet']
];
function recipientAvoid(r) {
  let hidden = [];
  try { hidden = db.prepare("SELECT category, title FROM ideas WHERE recipient_id = ? AND status = 'hidden'").all(r.id); } catch (e) {}
  const interest = new Set(((r.keywords || '') + ' ' + (r.wishlist || '')).toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4));
  // expand interests with their cluster synonyms so interest-adjacent words are safe
  const safe = new Set(interest);
  for (const w of interest) for (const cl of INTEREST_CLUSTERS) if (cl.some((c) => w.includes(c) || c.includes(w))) cl.forEach((c) => safe.add(c));
  const isInterest = (w) => [...safe].some((iw) => w.includes(iw) || iw.includes(w));
  // Data-driven: the words that characterize what the shopper keeps banishing
  // (from the categories + titles of hidden items), excluding their interests and
  // generic filler. Words that recur >=3x become avoid terms.
  // Use CATEGORY words only (not titles): banishing individual aviation items
  // must not turn "flight"/"pilot" into avoid-terms and kill an interest. Words
  // that recur across the categories of >=2 banished items become avoid-terms,
  // so "Baking"/"Baking Tools"/"Baking Kits" all collapse to "baking".
  const bag = {};
  for (const h of hidden) {
    for (const w of new Set((h.category || '').toLowerCase().split(/[^a-z]+/))) {
      if (w.length >= 4 && !AVOID_STOP.has(w) && !isInterest(w)) bag[w] = (bag[w] || 0) + 1;
    }
  }
  const terms = Object.entries(bag).filter(([, n]) => n >= 2).map(([w]) => w);
  // also honor explicit avoid-terms from steering notes
  for (const t of extractAvoidTerms(r.feedback || '')) if (!isInterest(t) && !terms.includes(t)) terms.push(t);
  const termRx = terms.length ? new RegExp('\\b(' + terms.map(escapeRx).join('|') + ')', 'i') : null;
  return { terms, termRx };
}
function matchesAvoid(it, avoid) {
  if (!avoid || !avoid.termRx) return false;
  return avoid.termRx.test((it.title || '') + ' ' + (it.category || '') + ' ' + (it.descr || ''));
}

function selectPool(r, cat, target = POOL_TARGET, avoid = null) {
  const g = (r.gender || '').toLowerCase();
  const wantF = /^f|female|woman|women/.test(g);
  const wantM = /^m|male|man|men/.test(g);
  const hay = ((r.relationship || '') + ' ' + (r.keywords || '') + ' ' + (r.name || '')).toLowerCase();
  const dog = /\bdogs?\b|\bpuppy\b/.test(hay);
  const ceiling = (Number(r.budget_max) || 20000) * 1.4;
  const okTag = (i) => {
    if (matchesAvoid(i, avoid)) return false; // never fill in a disliked category/term
    const t = i.tags || [];
    if (dog) return t.includes('dogs');
    if (t.includes('dogs')) return false;
    const neutral = t.includes('unisex') || t.includes('anyone');
    if (wantM && t.includes('women') && !t.includes('men') && !neutral) return false;
    if (wantF && t.includes('men') && !t.includes('women') && !neutral) return false;
    return true;
  };
  const okBudget = (i) => !i.price_cents || i.price_cents <= ceiling;
  const seen = new Set();
  const chosen = [];
  const add = (it) => { const k = it.title.toLowerCase(); if (seen.has(k)) return; seen.add(k); chosen.push(it); };
  // 1) interest matches that have a photo
  const matched = matchCatalog(r, cat, 400);
  for (const it of matched) { if (chosen.length >= target) break; if (it.image && okTag(it) && okBudget(it)) add(it); }
  // 2) fill with photographed, appropriate items (broadly-giftable first)
  const photographed = cat.filter((i) => i.image && okTag(i) && okBudget(i));
  const fill = photographed.filter((i) => (i.tags || []).includes('anyone'))
    .concat(photographed.filter((i) => !(i.tags || []).includes('anyone')));
  for (const it of fill) { if (chosen.length >= target) break; add(it); }
  // 3) last resort if the catalog is tiny: interest matches without a photo
  for (const it of matched) { if (chosen.length >= target) break; if (okTag(it) && okBudget(it)) add(it); }
  return chosen;
}

// Live niche fill: one Google Shopping query per interest keyword returns real
// photographed, priced, linkable products. Cached, so repeat niches are free.
async function enrichFromSerpApi(r, avoid, cap = 70) {
  if (!serpapiEnabled()) return [];
  const ceiling = (Number(r.budget_max) || 20000) * 1.4;
  let phrases = String(r.keywords || '').split(',').map((s) => s.trim()).filter((s) => s.length >= 3);
  if (String(r.wishlist || '').trim()) phrases.push(String(r.wishlist).trim().slice(0, 40));
  if (!phrases.length) phrases = ['gift ideas'];
  phrases = phrases.slice(0, 5); // cap queries to protect the monthly quota
  const perPhrase = Math.max(10, Math.ceil(cap / phrases.length)); // represent EVERY interest, not just the first
  const seen = new Set();
  const out = [];
  for (const ph of phrases) {
    const q = /gift/i.test(ph) ? ph : ph + ' gifts';
    let items = [];
    try { items = await searchShopping(q, { maxPriceCents: ceiling, categoryLabel: ph.replace(/\b\w/g, (c) => c.toUpperCase()) }); } catch (e) {}
    let taken = 0;
    for (const it of items) {
      const k = it.title.toLowerCase();
      if (seen.has(k) || matchesAvoid(it, avoid)) continue;
      seen.add(k); out.push({ ...it, source: 'serpapi' }); taken++;
      if (taken >= perPhrase || out.length >= cap) break;
    }
    if (out.length >= cap) break;
  }
  return out;
}

async function populatePool(r) {
  const avoid = recipientAvoid(r);
  let picks = [];
  // 1) live, accurately-photographed niche products from SerpApi (cached)
  try { picks = await enrichFromSerpApi(r, avoid); } catch (e) { console.error('[serpapi enrich]', e && e.message); }
  // 2) fill the rest from the catalog (photographed, dislike-aware) up to the target
  if (catalog.length) {
    const have = new Set(picks.map((p) => p.title.toLowerCase()));
    const catPicks = selectPool(r, catalog, POOL_TARGET, avoid).filter((it) => !have.has(it.title.toLowerCase()));
    picks = picks.concat(catPicks);
  }
  picks = picks.slice(0, Math.max(POOL_TARGET, picks.length));
  const ts = nowIso();
  const tx = db.transaction(() => {
    for (const it of picks) {
      Q.insIdea.run({
        recipient_id: r.id, title: it.title, descr: it.descr || '', category: it.category || '',
        est_price: it.price_cents || 0, retailer: it.retailer || 'Amazon',
        search_url: it.url || amazonSearch(it.title), product_url: it.url || '',
        image: it.image || '', source: it.source || 'pool', why: it.why || '', created: ts, updated: ts
      });
    }
  });
  tx();
  return picks.length;
}

app.post('/api/recipients/:id/generate', async (req, res) => {
  const r = Q.recipient.get(num(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const rounds = num(req.body && req.body.rounds, 1);
  const out = await runGeneration(r, rounds);
  res.json({ ...out, ideas: Q.ideasFor.all(r.id) });
});

const countActive = (id) => Q.ideasFor.all(id).filter((i) => i.status === 'active').length;

// Generate (in bounded batches) until the recipient has at least `target` active
// ideas. `liked` keeps new ideas on-taste. Stops on no-progress or a guard cap.
async function generateUpTo(recipientId, target, liked, userId) {
  let active = countActive(recipientId), added = 0, provider = 'none', lastError = null, guard = 0;
  while (active < target && guard < 6) {
    const rounds = Math.min(3, Math.max(1, Math.ceil((target - active) / 9)));
    const out = await runGeneration(Q.recipient.get(recipientId, userId), rounds, liked);
    added += out.added; if (out.provider !== 'none') provider = out.provider; if (out.error) lastError = out.error;
    const na = countActive(recipientId);
    if (na <= active) break; // engine dry or rate-limited, stop rather than loop
    active = na; guard++;
  }
  return { added, provider, error: added ? null : lastError, active };
}

// ---- refine: keep the top 50% by Elo, retire the bottom 50%, breed fresh ideas
//      from the winners, and never leave fewer than 80 active ideas ----
app.post('/api/recipients/:id/refine', async (req, res) => {
  const r = Q.recipient.get(num(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const active = Q.ideasFor.all(r.id).filter((i) => i.status === 'active'); // ordered by rating desc
  if (active.length < 4) return res.status(400).json({ error: 'not enough ideas to refine yet, battle a few first' });
  const pct = Math.min(0.9, Math.max(0.1, Number(req.body && req.body.pct) || 0.5));
  const keepN = Math.max(5, Math.ceil(active.length * pct));
  const keep = active.slice(0, keepN);
  const retire = active.slice(keepN);
  const ts = nowIso();
  db.transaction(() => { for (const it of retire) Q.setStatus.run({ id: it.id, status: 'hidden', updated: ts }); })();
  // Pass the winners as a positive lean for THIS generation only (not persisted,
  // so it never overrides the shopper's explicit steering later).
  const liked = keep.map((i) => i.title + (i.category ? ' (' + i.category + ')' : ''));
  // replace the retired half, floored at 80 and capped so it stays reasonably fast
  const target = Math.max(80, Math.min(active.length, keepN + 40));
  const out = await generateUpTo(r.id, target, liked, req.user.id);
  res.json({ kept: keep.length, retired: retire.length, finalActive: countActive(r.id), added: out.added,
    provider: out.provider, error: out.error, recipient: recipientPayload(Q.recipient.get(r.id, req.user.id)), ideas: Q.ideasFor.all(r.id) });
});

// Pull "avoid" terms out of free-text steering ("no coffee", "less kitchen stuff").
function extractAvoidTerms(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  const STOP = new Set(['want', 'wants', 'like', 'likes', 'love', 'more', 'less', 'fewer', 'no', 'nor', 'not', 'dont', 'don', 'nothing', 'stuff', 'things', 'thing', 'item', 'items', 'the', 'an', 'any', 'some', 'really', 'just', 'please', 'into', 'for', 'with', 'without', 'and', 'but', 'or', 'also', 'make', 'sure', 'too', 'much', 'many', 'that', 'this', 'those', 'these', 'such', 'kind', 'type', 'gift', 'gifts', 'idea', 'ideas', 'give', 'show', 'see', 'instead', 'rather', 'avoid', 'skip', 'hate', 'dislike', 'him', 'her', 'them', 'they', 'anything', 'something', 'focus']);
  const terms = new Set();
  const clauses = t.split(/[,.;!]| and | but | plus | while /);
  for (const c of clauses) {
    if (/\b(no|not|don'?t|less|fewer|without|avoid|skip|hate|dislikes?|nothing|stop|get rid of|not into|steer clear)\b/.test(c)) {
      for (const w of c.split(/[^a-z]+/)) { if (w.length >= 3 && !STOP.has(w)) terms.add(w); }
    }
  }
  return [...terms];
}
function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// Hide active ideas that match the shopper's avoid terms, so unwanted stuff
// leaves the head-to-head pool immediately (not just future generations).
function purgeAvoid(recipientId, text) {
  const terms = extractAvoidTerms(text);
  if (!terms.length) return { purged: 0, terms };
  const rx = new RegExp('\\b(' + terms.map(escapeRx).join('|') + ')', 'i');
  const act = Q.ideasFor.all(recipientId).filter((i) => i.status === 'active');
  const ts = nowIso();
  let purged = 0;
  db.transaction(() => {
    for (const it of act) {
      if (rx.test(it.title + ' ' + it.category + ' ' + it.descr)) { Q.setStatus.run({ id: it.id, status: 'hidden', updated: ts }); purged++; }
    }
  })();
  return { purged, terms };
}

// ---- head-to-head feedback: steer the profile, pull in fresh matching ideas ----
app.post('/api/recipients/:id/feedback', async (req, res) => {
  const r = Q.recipient.get(num(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const text = str(req.body && req.body.text, 600).trim();
  if (!text) return res.status(400).json({ error: 'feedback text required' });
  // append to the profile's accumulated feedback (most recent last, capped)
  const merged = ((r.feedback ? r.feedback + ' | ' : '') + text).slice(-2000);
  Q.appendFeedback.run({ id: r.id, feedback: merged, updated: nowIso() });
  // remove existing ideas that match what the shopper just said to avoid. This is
  // instant (no AI); fresh on-taste ideas are pulled in afterward in the background.
  const { purged, terms } = purgeAvoid(r.id, text);
  res.json({ purged, avoided: terms, recipient: recipientPayload(Q.recipient.get(r.id, req.user.id)), ideas: Q.ideasFor.all(r.id) });
});

// custom manual idea
app.post('/api/recipients/:id/ideas', (req, res) => {
  const r = Q.recipient.get(num(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const ts = nowIso();
  const title = str(b.title, 140);
  if (!title) return res.status(400).json({ error: 'title required' });
  const q = str(b.search_query || b.title, 140);
  const r2 = Q.insIdea.run({
    recipient_id: r.id, title, descr: str(b.descr, 300), category: str(b.category, 60),
    est_price: Math.max(0, num(b.est_price, 0)), retailer: str(b.retailer, 40) || 'Amazon',
    search_url: /^https?:\/\//i.test(b.search_url) ? b.search_url : amazonSearch(q),
    product_url: /^https?:\/\//i.test(b.search_url) ? str(b.search_url, 600) : '',
    image: /^https?:\/\//i.test(b.image) ? str(b.image, 600) : '', source: 'custom', why: str(b.why, 240), created: ts, updated: ts
  });
  res.json({ idea: Q.idea.get(r2.lastInsertRowid) });
});

// ---- head to head (elo) ----
function elo(ra, rb, aWon, k = 40) {
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const eb = 1 - ea;
  return [ra + k * ((aWon ? 1 : 0) - ea), rb + k * ((aWon ? 0 : 1) - eb)];
}

app.post('/api/battle', (req, res) => {
  const b = req.body || {};
  const ts = nowIso();
  // "neither": both options rejected, both lose rating (penalized vs an implied better gift)
  if (b.neither) {
    const a = ownedIdea(num(b.aId), req.user.id), c = ownedIdea(num(b.bId), req.user.id);
    if (!a || !c) return res.status(400).json({ error: 'bad ids' });
    const PEN = 28;
    const na = a.rating - PEN, nc = c.rating - PEN;
    Q.updRating.run({ id: a.id, rating: na, updated: ts });
    Q.updRating.run({ id: c.id, rating: nc, updated: ts });
    return res.json({ ok: true, neither: true, a: { id: a.id, rating: na }, b: { id: c.id, rating: nc } });
  }
  const w = ownedIdea(num(b.winnerId), req.user.id);
  const l = ownedIdea(num(b.loserId), req.user.id);
  if (!w || !l) return res.status(400).json({ error: 'bad ids' });
  const [nw, nl] = elo(w.rating, l.rating, true);
  Q.updRating.run({ id: w.id, rating: nw, updated: ts });
  Q.updRating.run({ id: l.id, rating: nl, updated: ts });
  res.json({ ok: true, winner: { id: w.id, rating: nw }, loser: { id: l.id, rating: nl } });
});

// ---- undo a rating decision: restore exact ratings/battles ----
app.post('/api/battle/undo', (req, res) => {
  const items = (req.body && req.body.items) || [];
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'no items' });
  const ts = nowIso();
  const tx = db.transaction(() => {
    for (const it of items) {
      const id = num(it.id);
      if (!id) continue;
      if (!ownedIdea(id, req.user.id)) continue;
      Q.setRatingExact.run({ id, rating: Number(it.rating) || 1500, battles: Math.max(0, num(it.battles, 0)), updated: ts });
    }
  });
  tx();
  res.json({ ok: true });
});

// ---- status changes: favorite / hide / purchase / unlist ----
app.post('/api/ideas/:id/status', (req, res) => {
  const it = ownedIdea(num(req.params.id), req.user.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const status = str(b.status, 20);
  if (!['active', 'hidden', 'listed', 'purchased'].includes(status)) {
    return res.status(400).json({ error: 'bad status' });
  }
  const ts = nowIso();
  const payload = {
    id: it.id, status, updated: ts,
    product_url: it.product_url, target_price: it.target_price, last_price: it.last_price,
    purchased_price: it.purchased_price, notes: it.notes, est_price: it.est_price
  };
  if (status === 'listed') {
    if (b.product_url !== undefined) payload.product_url = /^https?:\/\//i.test(b.product_url) ? str(b.product_url, 600) : '';
    if (b.target_price !== undefined) payload.target_price = b.target_price === null ? null : Math.max(0, num(b.target_price, 0));
    // seed a first price point from estimate so the graph has an anchor
    if (!it.last_price && it.est_price) {
      payload.last_price = it.est_price;
      Q.insPrice.run(it.id, ts, it.est_price, 1, 'estimate');
    }
  }
  if (status === 'purchased') {
    payload.purchased_price = b.purchased_price !== undefined ? Math.max(0, num(b.purchased_price, it.last_price || it.est_price || 0)) : (it.purchased_price || it.last_price || it.est_price || 0);
  }
  Q.updIdea.run(payload);
  res.json({ idea: Q.idea.get(it.id) });
});

// update idea fields (url, target, notes, est_price)
app.put('/api/ideas/:id', (req, res) => {
  const it = ownedIdea(num(req.params.id), req.user.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const ts = nowIso();
  const payload = {
    id: it.id, status: it.status, updated: ts,
    product_url: b.product_url !== undefined ? (/^https?:\/\//i.test(b.product_url) ? str(b.product_url, 600) : '') : it.product_url,
    target_price: b.target_price !== undefined ? (b.target_price === null || b.target_price === '' ? null : Math.max(0, num(b.target_price, 0))) : it.target_price,
    last_price: it.last_price,
    purchased_price: b.purchased_price !== undefined ? Math.max(0, num(b.purchased_price, 0)) : it.purchased_price,
    notes: b.notes !== undefined ? str(b.notes, 600) : it.notes,
    est_price: b.est_price !== undefined ? Math.max(0, num(b.est_price, 0)) : it.est_price
  };
  Q.updIdea.run(payload);
  res.json({ idea: Q.idea.get(it.id) });
});

app.delete('/api/ideas/:id', (req, res) => {
  const id = num(req.params.id);
  if (!ownedIdea(id, req.user.id)) return res.status(404).json({ error: 'not found' });
  const tx = db.transaction(() => { Q.delIdeaPrices.run(id); Q.delIdea.run(id); });
  tx();
  res.json({ ok: true });
});

// ---- price watch ----
app.get('/api/ideas/:id/prices', (req, res) => {
  const it = ownedIdea(num(req.params.id), req.user.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  res.json({ idea: it, prices: Q.prices.all(it.id) });
});

// manually log a price point
app.post('/api/ideas/:id/price', (req, res) => {
  const it = ownedIdea(num(req.params.id), req.user.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  const price = Math.max(0, num(req.body && req.body.price, 0));
  if (!price) return res.status(400).json({ error: 'price required (cents)' });
  const ts = nowIso();
  Q.insPrice.run(it.id, ts, price, 1, 'manual');
  Q.setLastPrice.run(price, ts, it.id);
  res.json({ ok: true, idea: Q.idea.get(it.id) });
});

// ---- shopping list ----
app.get('/api/shopping-list', (req, res) => {
  const recipients = Q.recipients.all(req.user.id);
  const out = [];
  let grandListed = 0, grandSpent = 0;
  for (const r of recipients) {
    const items = Q.ideasFor.all(r.id).filter((i) => i.status === 'listed' || i.status === 'purchased');
    if (!items.length) continue;
    const listed = items.filter((i) => i.status === 'listed')
      .reduce((s, i) => s + (i.last_price || i.est_price || 0), 0);
    const spent = items.filter((i) => i.status === 'purchased')
      .reduce((s, i) => s + (i.purchased_price || i.last_price || i.est_price || 0), 0);
    grandListed += listed; grandSpent += spent;
    out.push({ recipient: recipientPayload(r), items, listed, spent });
  }
  res.json({ groups: out, grandListed, grandSpent });
});

app.get('/share/:token', (req, res) => {
  res.set('X-Robots-Tag', 'noindex');
  res.sendFile(path.join(PUBLIC_DIR, 'share.html'));
});

app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.listen(PORT, () => console.log(`🎄 christmas gift finder on :${PORT}`));
