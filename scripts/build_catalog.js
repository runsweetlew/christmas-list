'use strict';
// Aggregate seed/raw/batch*.json (from research agents) into seed/catalog.json.
// Normalizes fields, derives Amazon images from ASINs where missing, dedupes.

const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'seed', 'raw');
const OUT = path.join(__dirname, '..', 'seed', 'catalog.json');
const VALID_TAGS = ['mom', 'wife', 'dad', 'dogs', 'friends', 'coworker', 'myself', 'anyone'];

function asin(url) {
  if (!url) return '';
  const m = String(url).match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i) || String(url).match(/\/([A-Z0-9]{10})(?:[/?]|$)/);
  return m ? m[1].toUpperCase() : '';
}
function amazonImg(a) { return a ? `https://images-na.ssl-images-amazon.com/images/P/${a}.01._SCLZZZZZZZ_.jpg` : ''; }

function clean(raw) {
  const out = [];
  for (const it of raw) {
    const title = String(it.title || '').trim();
    if (!title) continue;
    let price = parseInt(it.price_cents, 10);
    if (isNaN(price) || price < 0) price = 0;
    if (price > 0 && price < 100) price *= 100; // guard dollars->cents
    const url = String(it.url || '').trim();
    let image = String(it.image || '').trim();
    if (!/^https?:\/\//i.test(image)) image = '';
    if (!image) { const a = asin(url); if (a) image = amazonImg(a); }
    let tags = Array.isArray(it.tags) ? it.tags.map((t) => String(t).toLowerCase().trim()).filter((t) => VALID_TAGS.includes(t)) : [];
    if (!tags.length) tags = ['anyone'];
    out.push({
      title: title.slice(0, 140),
      descr: String(it.descr || '').trim().slice(0, 300),
      category: String(it.category || '').trim().slice(0, 50),
      price_cents: price,
      retailer: String(it.retailer || 'Amazon').trim().slice(0, 40),
      url: /^https?:\/\//i.test(url) ? url : '',
      image,
      tags,
      why: String(it.why || '').trim().slice(0, 240)
    });
  }
  return out;
}

const files = fs.readdirSync(RAW).filter((f) => /^batch.*\.json$/i.test(f)).sort();
let all = [];
for (const f of files) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
    const arr = Array.isArray(data) ? data : (data.items || data.products || []);
    const cleaned = clean(arr);
    all = all.concat(cleaned);
    console.log(`${f}: ${cleaned.length}`);
  } catch (e) { console.error(`${f}: parse failed ${e.message}`); }
}

// dedupe by normalized title
const seen = new Set(), dedup = [];
for (const it of all) {
  const k = it.title.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (seen.has(k)) continue; seen.add(k); dedup.push(it);
}

const withImg = dedup.filter((i) => i.image).length;
fs.writeFileSync(OUT, JSON.stringify(dedup, null, 2));
console.log(`\nTOTAL ${dedup.length} items (${withImg} with images). Written to ${OUT}`);
const byTag = {};
for (const it of dedup) for (const t of it.tags) byTag[t] = (byTag[t] || 0) + 1;
console.log('by tag:', byTag);
