'use strict';
// End-to-end smoke test. Run inside the node:20 container (better-sqlite3).
const { spawn } = require('child_process');
const PORT = 3188;
const BASE = 'http://localhost:' + PORT;

function sh(assert, msg) { if (!assert) { console.error('FAIL:', msg); process.exit(1); } console.log('ok:', msg); }

async function main() {
  const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR: '/tmp/smoke-' + Date.now() }, stdio: 'inherit' });
  await new Promise((r) => setTimeout(r, 1500));
  let cookie = '';
  const jar = (res) => { const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; };
  const j = (res) => res.json();
  const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(b) });
  const put = (p, b) => fetch(BASE + p, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(b) });
  const get = (p) => fetch(BASE + p, { headers: { Cookie: cookie } });
  try {
    let r = await post('/api/auth/signup', { email: 'a@test.com', password: 'password1', name: 'A' }); jar(r);
    sh(r.status === 200, 'signup');
    r = await get('/api/auth/me'); sh((await j(r)).user.email === 'a@test.com', 'me after signup');
    r = await get('/api/state'); sh((await j(r)).recipients.length === 0, 'fresh account has no recipients');
    r = await post('/api/recipients', { name: 'Dad', keywords: 'grilling, tools, outdoors', budget_max: 20000 });
    const rec = (await j(r)).recipient; sh(rec && rec.id, 'new recipient created and acknowledged immediately');
    // Pool is filled in the background now; poll briefly until ideas land.
    let poolCount = 0;
    for (let i = 0; i < 30 && poolCount === 0; i++) {
      await new Promise((rr) => setTimeout(rr, 200));
      poolCount = ((await (await get('/api/recipients/' + rec.id)).json()).ideas || []).length;
    }
    sh(poolCount > 0, 'new recipient pool populated from catalog (background)');
    r = await post('/api/recipients/' + rec.id + '/share', {}); const share = await j(r);
    sh(/\/share\//.test(share.url), 'share link minted');
    // second user cannot see the first user's recipient
    let r2 = await post('/api/auth/signup', { email: 'b@test.com', password: 'password1', name: 'B' });
    const cookieB = r2.headers.get('set-cookie').split(';')[0];
    const rB = await fetch(BASE + '/api/recipients/' + rec.id, { headers: { Cookie: cookieB } });
    sh(rB.status === 404, 'cross-account access is blocked');
    // public share view (no cookie) + claim
    const token = share.token;
    let rp = await fetch(BASE + '/api/share/' + token); const pub = await rp.json();
    sh(pub.recipient.name === 'Dad', 'public share view loads');
    // list an item so it appears, then claim it
    const ideasRes = await get('/api/recipients/' + rec.id); const anIdea = (await ideasRes.json()).ideas[0];
    await post('/api/ideas/' + anIdea.id + '/status', { status: 'listed' });
    rp = await fetch(BASE + '/api/share/' + token); const pub2 = await rp.json();
    sh(pub2.items.length >= 1, 'listed item appears on share page');
    const cl = await fetch(BASE + '/api/share/' + token + '/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ideaId: pub2.items[0].id, name: 'Grandma' }) });
    sh((await cl.json()).claims.length === 1, 'claim recorded');
    // dedicated avoid field purges matching active ideas and keeps them out
    r = await post('/api/recipients', { name: 'AvoidTest', keywords: 'golf', budget_max: 20000 });
    const at = (await j(r)).recipient;
    await post('/api/recipients/' + at.id + '/ideas', { title: 'Nordic Ware Bundt Pan', category: 'Baking', est_price: 3000 });
    r = await put('/api/recipients/' + at.id, { name: 'AvoidTest', keywords: 'golf', avoid: 'baking' });
    const av = await j(r);
    sh(av.purged >= 1, 'avoid field purges matching active ideas on save');
    const activeNow = ((await (await get('/api/recipients/' + at.id)).json()).ideas || []).filter((i) => i.status === 'active');
    sh(!activeNow.some((i) => /baking/i.test(i.title + ' ' + i.category)), 'no baking items remain active after avoid');

    console.log('\nSMOKE PASSED');
    srv.kill(); process.exit(0);
  } catch (e) { console.error(e); srv.kill(); process.exit(1); }
}
main();
