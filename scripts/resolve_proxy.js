'use strict';
// Convert weserv/microlink proxy images into real direct image URLs, run from a
// host with fresh microlink quota (Bastiat). Retries handle Amazon's rotating
// bot wall. Dogs first (the thinnest coverage). Stops after sustained rate-limit.

const fs = require('fs');
const path = require('path');
const CAT = path.join(__dirname, '..', 'seed', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(CAT, 'utf8'));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const MIN = 3500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function innerUrl(it) {
  // proxy image encodes: ...?url=<enc(api.microlink.io/?url=<enc(PRODUCT)>&embed=image.url)>
  if (it.url && /^https?:\/\//i.test(it.url)) return it.url;
  return null;
}
async function verify(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
  try { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*,*/*' }, signal: ac.signal, redirect: 'follow' });
    if (!r.ok) return false; const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image')) return false; const b = await r.arrayBuffer(); return b.byteLength >= MIN;
  } catch (e) { return false; } finally { clearTimeout(t); }
}
async function microImage(productUrl) {
  const api = 'https://api.microlink.io/?url=' + encodeURIComponent(productUrl);
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(api, { headers: { 'User-Agent': UA }, signal: ac.signal });
    if (r.status === 429) return { rl: true };
    const j = await r.json();
    const img = j && j.data && j.data.image && j.data.image.url;
    return { url: img || null };
  } catch (e) { return { url: null }; } finally { clearTimeout(t); }
}

async function run() {
  let targets = catalog.filter((i) => i.image_proxied || /weserv\.nl/i.test(i.image || ''));
  targets.sort((a, b) => (a.tags.includes('dogs') ? 0 : 1) - (b.tags.includes('dogs') ? 0 : 1));
  console.log(`resolving ${targets.length} proxy images (dogs first)...`);
  let ok = 0, fail = 0, rlStreak = 0, done = 0;
  for (const it of targets) {
    const product = innerUrl(it); let got = null;
    for (let tries = 0; tries < 3 && !got; tries++) {
      const res = await microImage(product);
      if (res.rl) { rlStreak++; await sleep(3000); continue; }
      rlStreak = 0;
      if (res.url && await verify(res.url)) got = res.url;
      else await sleep(800);
    }
    if (got) { it.image = got; delete it.image_proxied; ok++; } else fail++;
    done++;
    if (done % 15 === 0) { console.log(`  ...${done}/${targets.length} (${ok} real, ${fail} kept-proxy)`); fs.writeFileSync(CAT, JSON.stringify(catalog, null, 2)); }
    if (rlStreak >= 12) { console.log('  rate-limited, stopping early'); break; }
    await sleep(600);
  }
  fs.writeFileSync(CAT, JSON.stringify(catalog, null, 2));
  const direct = catalog.filter((i) => i.image && !/weserv\.nl/i.test(i.image)).length;
  console.log(`\nresolved ${ok} new real images, ${fail} kept proxy`);
  console.log(`catalog: ${direct}/${catalog.length} direct render-now, ${catalog.length - direct} proxy`);
}
run();
