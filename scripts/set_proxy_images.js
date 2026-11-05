'use strict';
// For catalog items still missing a direct image, set the image to a
// weserv-cached microlink resolution of the product page's og:image. weserv
// fetches once and serves from its own CDN, so viewers never hit microlink's
// rate limit. Skips Chewy (which blocks microlink too; those get re-pointed).

const fs = require('fs');
const path = require('path');
const CAT = path.join(__dirname, '..', 'seed', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(CAT, 'utf8'));

function proxied(productUrl) {
  const inner = 'api.microlink.io/?url=' + encodeURIComponent(productUrl) + '&embed=image.url';
  return 'https://images.weserv.nl/?url=' + encodeURIComponent(inner) + '&w=640&output=jpg&we';
}

let set = 0, skipped = 0;
for (const it of catalog) {
  if (it.image) continue;
  if (!it.url || !/^https?:\/\//i.test(it.url)) { skipped++; continue; }
  if (/chewy\.com/i.test(it.url)) { skipped++; continue; } // blocks microlink; re-point instead
  it.image = proxied(it.url);
  it.image_proxied = true;
  set++;
}
fs.writeFileSync(CAT, JSON.stringify(catalog, null, 2));
console.log(`set ${set} proxied images, skipped ${skipped} (chewy/no-url)`);
console.log(`catalog ${catalog.length} items, ${catalog.filter((x) => x.image).length} with images, ${catalog.filter((x) => !x.image).length} still none`);
