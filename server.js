'use strict';
const path = require('path');
const express = require('express');
const { db } = require('./db');
const { seedIfEmpty } = require('./seed/seed');
const { generateIdeas, amazonSearch } = require('./llm');
const { resolveMany } = require('./bing_img');

const PORT = process.env.PORT || 3101;
const PUBLIC_DIR = path.join(__dirname, 'public');

seedIfEmpty(db);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR, { maxAge: '5m' }));

const nowIso = () => new Date().toISOString();
const num = (v, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : n; };
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

// ---- prepared statements ----
const Q = {
  recipients: db.prepare('SELECT * FROM recipients ORDER BY sort, id'),
  recipient: db.prepare('SELECT * FROM recipients WHERE id = ?'),
  insRecipient: db.prepare(`INSERT INTO recipients
    (name, relationship, emoji, age, gender, keywords, wishlist, feedback, budget_min, budget_max, sort, created, updated)
    VALUES (@name,@relationship,@emoji,@age,@gender,@keywords,@wishlist,@feedback,@budget_min,@budget_max,@sort,@created,@updated)`),
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

function recipientPayload(r) {
  const c = Q.counts.get(r.id) || {};
  return { ...r, counts: {
    ideas: c.ideas || 0, active: c.active || 0, listed: c.listed || 0,
    purchased: c.purchased || 0, listed_total: c.listed_total || 0, spent: c.spent || 0
  } };
}

// ---- recipients ----
app.get('/api/state', (req, res) => {
  const recipients = Q.recipients.all().map(recipientPayload);
  res.json({ recipients });
});

app.get('/api/recipients/:id', (req, res) => {
  const r = Q.recipient.get(num(req.params.id));
  if (!r) return res.status(404).json({ error: 'not found' });
  const ideas = Q.ideasFor.all(r.id);
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

app.post('/api/recipients', (req, res) => {
  const c = cleanRecipient(req.body || {});
  const ts = nowIso();
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS s FROM recipients').get().s;
  const r = Q.insRecipient.run({ ...c, sort: maxSort, created: ts, updated: ts });
  res.json({ recipient: recipientPayload(Q.recipient.get(r.lastInsertRowid)) });
});

app.put('/api/recipients/:id', (req, res) => {
  const r = Q.recipient.get(num(req.params.id));
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
  res.json({ recipient: recipientPayload(Q.recipient.get(r.id)), purged });
});

app.delete('/api/recipients/:id', (req, res) => {
  const id = num(req.params.id);
  const tx = db.transaction(() => {
    Q.delRecipientPrices.run(id);
    Q.delRecipientIdeas.run(id);
    Q.delRecipient.run(id);
  });
  tx();
  res.json({ ok: true });
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

app.post('/api/recipients/:id/generate', async (req, res) => {
  const r = Q.recipient.get(num(req.params.id));
  if (!r) return res.status(404).json({ error: 'not found' });
  const rounds = num(req.body && req.body.rounds, 1);
  const out = await runGeneration(r, rounds);
  res.json({ ...out, ideas: Q.ideasFor.all(r.id) });
});

const countActive = (id) => Q.ideasFor.all(id).filter((i) => i.status === 'active').length;

// Generate (in bounded batches) until the recipient has at least `target` active
// ideas. `liked` keeps new ideas on-taste. Stops on no-progress or a guard cap.
async function generateUpTo(recipientId, target, liked) {
  let active = countActive(recipientId), added = 0, provider = 'none', lastError = null, guard = 0;
  while (active < target && guard < 6) {
    const rounds = Math.min(3, Math.max(1, Math.ceil((target - active) / 9)));
    const out = await runGeneration(Q.recipient.get(recipientId), rounds, liked);
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
  const r = Q.recipient.get(num(req.params.id));
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
  const out = await generateUpTo(r.id, target, liked);
  res.json({ kept: keep.length, retired: retire.length, finalActive: countActive(r.id), added: out.added,
    provider: out.provider, error: out.error, recipient: recipientPayload(Q.recipient.get(r.id)), ideas: Q.ideasFor.all(r.id) });
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
  const r = Q.recipient.get(num(req.params.id));
  if (!r) return res.status(404).json({ error: 'not found' });
  const text = str(req.body && req.body.text, 600).trim();
  if (!text) return res.status(400).json({ error: 'feedback text required' });
  // append to the profile's accumulated feedback (most recent last, capped)
  const merged = ((r.feedback ? r.feedback + ' | ' : '') + text).slice(-2000);
  Q.appendFeedback.run({ id: r.id, feedback: merged, updated: nowIso() });
  // remove existing ideas that match what the shopper just said to avoid
  const { purged, terms } = purgeAvoid(r.id, text);
  const fresh = Q.recipient.get(r.id);
  const rounds = num(req.body && req.body.rounds, 2);
  const out = await runGeneration(fresh, rounds);
  // keep the pool healthy after purging unwanted items
  if (countActive(r.id) < 80) { const up = await generateUpTo(r.id, 80); out.added += up.added; if (up.provider !== 'none') out.provider = up.provider; }
  res.json({ ...out, purged, avoided: terms, recipient: recipientPayload(Q.recipient.get(r.id)), ideas: Q.ideasFor.all(r.id) });
});

// custom manual idea
app.post('/api/recipients/:id/ideas', (req, res) => {
  const r = Q.recipient.get(num(req.params.id));
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
    const a = Q.idea.get(num(b.aId)), c = Q.idea.get(num(b.bId));
    if (!a || !c) return res.status(400).json({ error: 'bad ids' });
    const PEN = 28;
    const na = a.rating - PEN, nc = c.rating - PEN;
    Q.updRating.run({ id: a.id, rating: na, updated: ts });
    Q.updRating.run({ id: c.id, rating: nc, updated: ts });
    return res.json({ ok: true, neither: true, a: { id: a.id, rating: na }, b: { id: c.id, rating: nc } });
  }
  const w = Q.idea.get(num(b.winnerId));
  const l = Q.idea.get(num(b.loserId));
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
      Q.setRatingExact.run({ id, rating: Number(it.rating) || 1500, battles: Math.max(0, num(it.battles, 0)), updated: ts });
    }
  });
  tx();
  res.json({ ok: true });
});

// ---- status changes: favorite / hide / purchase / unlist ----
app.post('/api/ideas/:id/status', (req, res) => {
  const it = Q.idea.get(num(req.params.id));
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
  const it = Q.idea.get(num(req.params.id));
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
  const tx = db.transaction(() => { Q.delIdeaPrices.run(id); Q.delIdea.run(id); });
  tx();
  res.json({ ok: true });
});

// ---- price watch ----
app.get('/api/ideas/:id/prices', (req, res) => {
  const it = Q.idea.get(num(req.params.id));
  if (!it) return res.status(404).json({ error: 'not found' });
  res.json({ idea: it, prices: Q.prices.all(it.id) });
});

// manually log a price point
app.post('/api/ideas/:id/price', (req, res) => {
  const it = Q.idea.get(num(req.params.id));
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
  const recipients = Q.recipients.all();
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

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.listen(PORT, () => console.log(`🎄 christmas gift finder on :${PORT}`));
