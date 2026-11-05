'use strict';
// Verify every catalog image actually loads as a real image. Blank the ones
// that 404, aren't images, or are tiny "image not available" placeholders, so
// the UI shows a clean fallback instead of a broken/cut-off image.

const fs = require('fs');
const path = require('path');
const CAT = path.join(__dirname, '..', 'seed', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(CAT, 'utf8'));

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const MIN_BYTES = 3500; // Amazon "image not available" and 1x1 trackers are tiny

async function check(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*,*/*' }, signal: ac.signal, redirect: 'follow' });
    if (!res.ok) return false;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image')) return false;
    const buf = await res.arrayBuffer();
    return buf.byteLength >= MIN_BYTES;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function run() {
  let ok = 0, blanked = 0, already = 0;
  const CONC = 12;
  let idx = 0;
  async function worker() {
    while (idx < catalog.length) {
      const i = idx++;
      const it = catalog[i];
      if (!it.image) { already++; continue; }
      const good = await check(it.image);
      if (good) { ok++; }
      else { it.image = ''; blanked++; }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  fs.writeFileSync(CAT, JSON.stringify(catalog, null, 2));
  console.log(`images: ${ok} verified, ${blanked} blanked (broken/placeholder), ${already} had none`);
  console.log(`catalog now: ${catalog.length} items, ${catalog.filter((x) => x.image).length} with working images`);
}
run();
