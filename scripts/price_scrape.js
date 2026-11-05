'use strict';
// Best-effort nightly price scraper. Walks every listed idea that has a
// concrete product_url, fetches the page with a browser-like UA, tries several
// extraction strategies, and records whatever price it can into price_history.
// Failures are recorded as ok=0 so the graph can show gaps honestly.

const { db } = require('../db');

const listed = db.prepare("SELECT id, title, product_url, last_price FROM ideas WHERE status IN ('listed','purchased') AND product_url <> ''").all();
const insPrice = db.prepare('INSERT INTO price_history (idea_id, ts, price, ok, source) VALUES (?,?,?,?,?)');
const setLast = db.prepare('UPDATE ideas SET last_price=?, updated=? WHERE id=?');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

function centsFrom(str) {
  if (!str) return 0;
  const m = String(str).replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return 0;
  return Math.round(parseFloat(m[1]) * 100);
}

function extractPrice(html) {
  if (!html) return 0;
  // 1) JSON-LD offers price
  const ldBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldBlocks) {
    const inner = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
    try {
      const data = JSON.parse(inner);
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const offers = node && node.offers;
        const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
        for (const o of list) {
          const p = centsFrom(o.price || o.lowPrice || (o.priceSpecification && o.priceSpecification.price));
          if (p) return p;
        }
      }
    } catch (e) { /* ignore */ }
  }
  // 2) meta tags
  const meta = html.match(/<meta[^>]+(?:itemprop|property)=["'](?:price|product:price:amount|og:price:amount)["'][^>]*content=["']([^"']+)["']/i);
  if (meta) { const p = centsFrom(meta[1]); if (p) return p; }
  // 3) Amazon a-price
  const amzWhole = html.match(/class=["']a-price-whole["']>\s*([\d.,]+)/i);
  if (amzWhole) {
    const frac = html.match(/class=["']a-price-fraction["']>\s*(\d{1,2})/i);
    const whole = amzWhole[1].replace(/[^\d]/g, '');
    const p = Math.round(parseFloat(whole + '.' + (frac ? frac[1] : '0')) * 100);
    if (p) return p;
  }
  const amzBlock = html.match(/id=["'](?:priceblock_ourprice|priceblock_dealprice)["'][^>]*>\s*\$?([\d.,]+)/i);
  if (amzBlock) { const p = centsFrom(amzBlock[1]); if (p) return p; }
  // 4) generic data-price attribute
  const dataPrice = html.match(/data-(?:a-)?price(?:-amount)?=["']([\d.,]+)["']/i);
  if (dataPrice) { const p = centsFrom(dataPrice[1]); if (p) return p; }
  return 0;
}

async function fetchPrice(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: ac.signal,
      redirect: 'follow'
    });
    const html = await res.text();
    return extractPrice(html);
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  const ts = new Date().toISOString();
  let ok = 0, fail = 0;
  for (const it of listed) {
    try {
      const price = await fetchPrice(it.product_url);
      if (price > 0) {
        insPrice.run(it.id, ts, price, 1, 'scrape');
        setLast.run(price, ts, it.id);
        ok++;
        console.log(`ok   [${it.id}] $${(price / 100).toFixed(2)}  ${it.title}`);
      } else {
        insPrice.run(it.id, ts, it.last_price || 0, 0, 'scrape-miss');
        fail++;
        console.log(`miss [${it.id}] could not parse  ${it.title}`);
      }
    } catch (e) {
      insPrice.run(it.id, ts, it.last_price || 0, 0, 'scrape-err');
      fail++;
      console.log(`err  [${it.id}] ${e.message}  ${it.title}`);
    }
    await new Promise((r) => setTimeout(r, 1500 + Math.floor(1500 * ((it.id % 7) / 7))));
  }
  console.log(`done: ${ok} ok, ${fail} miss/err, ${listed.length} total @ ${ts}`);
  process.exit(0);
})();
