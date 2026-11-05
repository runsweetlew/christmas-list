'use strict';
// Resolve a real product image for a title via Bing image search (free, no key).
// Used to give AI-generated gift ideas photos, like the baked catalog items.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const MIN = 4000;
const BAD = /(lookaside\.fbsbx|youtube|ytimg|\.svg(\?|$)|favicon|sprite|placeholder|no[-_]?image|^data:)/i;

async function verify(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*,*/*' }, signal: ac.signal, redirect: 'follow' });
    if (!r.ok) return false;
    if (!(r.headers.get('content-type') || '').toLowerCase().startsWith('image')) return false;
    const b = await r.arrayBuffer();
    return b.byteLength >= MIN;
  } catch (e) { return false; } finally { clearTimeout(t); }
}

async function resolveImage(title) {
  if (!title) return '';
  try {
    const r = await fetch('https://www.bing.com/images/search?q=' + encodeURIComponent(title) + '&form=HDRSC2&first=1',
      { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
    if (!r.ok) return '';
    const h = await r.text();
    const urls = [...h.matchAll(/murl&quot;:&quot;(.*?)&quot;/g)].map((m) => m[1].replace(/\\u0026/g, '&'));
    for (const u of urls.filter((x) => x && !BAD.test(x)).slice(0, 5)) {
      if (await verify(u)) return u;
    }
  } catch (e) { /* ignore */ }
  return '';
}

// Resolve images for many titles with limited concurrency. Returns Map(title->url).
async function resolveMany(titles, conc = 6) {
  const out = new Map();
  let i = 0;
  async function worker() {
    while (i < titles.length) {
      const t = titles[i++];
      out.set(t, await resolveImage(t));
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, titles.length) }, worker));
  return out;
}

module.exports = { resolveImage, resolveMany };
