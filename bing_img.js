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

const BADPAGE = /(bing\.com|pinterest\.|facebook\.|instagram\.|lookaside|ebay\.|aliexpress\.|auction|dhgate\.|wish\.com)/i;
// Only trust a Bing image's source page as the product link if it is a reputable
// retailer or clearly a product page; otherwise the caller falls back to search.
const GOODPAGE = /(amazon\.com|etsy\.com|target\.com|walmart\.com|bestbuy\.com|rei\.com|homedepot\.com|lowes\.com|wayfair\.com|nordstrom\.com|crateandbarrel\.com|williams-?sonoma\.com|chewy\.com|uncommongoods\.com|backcountry\.com|macys\.com|surlatable\.com|\/dp\/|\/gp\/product|\/ip\/|\/product\/|\/products\/|\/listing\/|\/p\/|\/pd\/)/i;

function decodeEnt(s) { return String(s).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\\u0026/g, '&'); }

// Returns an ordered list of {image, page} candidates from Bing image search,
// each pair taken from the SAME search result so the photo and the product page
// match. Uses the iusc "m" JSON blob (murl = image, purl = source page).
function parseResults(html) {
  const out = [];
  for (const m of html.matchAll(/class="iusc"[^>]*\sm="([^"]+)"/g)) {
    try {
      const j = JSON.parse(decodeEnt(m[1]));
      if (j && j.murl) out.push({ image: j.murl, page: j.purl || '' });
    } catch (e) { /* ignore */ }
  }
  if (!out.length) { // fallback: image-only
    for (const m of html.matchAll(/murl&quot;:&quot;(.*?)&quot;/g)) out.push({ image: decodeEnt(m[1]), page: '' });
  }
  return out;
}

async function resolveProduct(title) {
  if (!title) return { image: '', page: '' };
  try {
    const r = await fetch('https://www.bing.com/images/search?q=' + encodeURIComponent(title) + '&form=HDRSC2&first=1',
      { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
    if (!r.ok) return { image: '', page: '' };
    const cands = parseResults(await r.text()).filter((c) => c.image && !BAD.test(c.image)).slice(0, 6);
    for (const c of cands) {
      if (await verify(c.image)) {
        const page = c.page && /^https?:\/\//i.test(c.page) && !BADPAGE.test(c.page) && GOODPAGE.test(c.page) ? c.page : '';
        return { image: c.image, page };
      }
    }
  } catch (e) { /* ignore */ }
  return { image: '', page: '' };
}

async function resolveImage(title) { return (await resolveProduct(title)).image; }

// Resolve many titles concurrently. Returns Map(title -> {image, page}).
async function resolveMany(titles, conc = 8) {
  const out = new Map();
  let i = 0;
  async function worker() {
    while (i < titles.length) { const t = titles[i++]; out.set(t, await resolveProduct(t)); }
  }
  await Promise.all(Array.from({ length: Math.min(conc, titles.length) }, worker));
  return out;
}

module.exports = { resolveImage, resolveProduct, resolveMany };
