'use strict';
// Apply the dog re-point results (/tmp/repoint_out_*.json): for Chewy-linked
// catalog items, swap the url to the found Amazon/brand product page and set a
// weserv-microlink proxy image (which resolves that page's real photo).

const fs = require('fs');
const path = require('path');
const CAT = path.join(__dirname, '..', 'seed', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(CAT, 'utf8'));

function proxied(u) {
  const inner = 'api.microlink.io/?url=' + encodeURIComponent(u) + '&embed=image.url';
  return 'https://images.weserv.nl/?url=' + encodeURIComponent(inner) + '&w=640&output=jpg&we';
}

const map = new Map();
for (const f of ['/tmp/repoint_out_1.json', '/tmp/repoint_out_2.json', '/tmp/repoint_out_3.json']) {
  try {
    const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const r of (Array.isArray(arr) ? arr : [])) {
      if (r && r.title && r.url && /^https?:\/\//i.test(r.url) && !/chewy\.com/i.test(r.url)) {
        map.set(r.title.trim().toLowerCase(), r.url.trim());
      }
    }
  } catch (e) { console.error('skip', f, e.message); }
}
console.log('re-point urls loaded:', map.size);

let updated = 0;
for (const it of catalog) {
  if (!/chewy\.com/i.test(it.url)) continue;
  const nu = map.get(it.title.trim().toLowerCase());
  if (!nu) continue;
  it.url = nu;
  it.image = proxied(nu);
  it.image_proxied = true;
  updated++;
}
fs.writeFileSync(CAT, JSON.stringify(catalog, null, 2));
const stillChewy = catalog.filter((i) => /chewy\.com/i.test(i.url) && !i.image).length;
console.log(`re-pointed ${updated} dog items to amazon/brand with proxy images`);
console.log(`catalog ${catalog.length} items, ${catalog.filter((x) => x.image).length} with images; ${stillChewy} chewy still imageless`);
