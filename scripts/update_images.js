'use strict';
// In-place updater: push catalog image/url changes into the live DB WITHOUT
// wiping state (preserves ratings, favorites, purchases). Matches ideas to
// catalog items by title and updates image, and search/product url when the
// catalog url changed (e.g. re-pointed dog items).

const fs = require('fs');
const path = require('path');
const { db } = require('../db');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'catalog.json'), 'utf8'));
const byTitle = new Map();
for (const it of catalog) byTitle.set(it.title.trim().toLowerCase(), it);

const rows = db.prepare('SELECT id, title, image, product_url, search_url FROM ideas').all();
const upImg = db.prepare('UPDATE ideas SET image=@image WHERE id=@id');
const upUrl = db.prepare('UPDATE ideas SET image=@image, product_url=@product_url, search_url=@search_url WHERE id=@id');
const ts = new Date().toISOString();

let img = 0, url = 0;
const tx = db.transaction(() => {
  for (const r of rows) {
    const it = byTitle.get((r.title || '').trim().toLowerCase());
    if (!it) continue;
    const newImg = it.image || '';
    const newUrl = it.url || '';
    const urlChanged = newUrl && newUrl !== r.product_url && !/chewy\.com/i.test(newUrl) && /chewy\.com/i.test(r.product_url || r.search_url || '');
    if (urlChanged) {
      upUrl.run({ id: r.id, image: newImg, product_url: newUrl, search_url: newUrl });
      url++; if (newImg !== r.image) img++;
    } else if (newImg !== r.image) {
      upImg.run({ id: r.id, image: newImg });
      img++;
    }
  }
});
tx();
console.log(`updated images on ${img} ideas, re-pointed urls on ${url} ideas @ ${ts}`);
