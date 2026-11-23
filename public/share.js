'use strict';
const token = location.pathname.split('/').pop();
const root = document.getElementById('share-root');
const dollars = (c) => c ? '$' + (c / 100).toFixed(2).replace(/\.00$/, '') : '';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const nameKey = 'cl_claimer_name';

async function api(path, opts) {
  const r = await fetch('/api/share/' + token + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'error');
  return r.json();
}

function claimLine(c) { return esc(c.claimer_name) + (c.note ? ' — ' + esc(c.note) : ''); }

function render(data) {
  const r = data.recipient;
  const mine = localStorage.getItem(nameKey) || '';
  const items = data.items.map((it) => {
    const claimed = it.claims && it.claims.length;
    const iHave = it.claims && it.claims.some((c) => c.claimer_name === mine && mine);
    const price = dollars(it.last_price || it.est_price);
    return `<article class="share-card${claimed ? ' is-claimed' : ''}">
      ${it.image ? `<img class="share-thumb" src="${esc(it.image)}" alt="" onerror="this.style.display='none'"/>` : ''}
      <div class="share-info">
        <h3>${esc(it.title)}</h3>
        ${it.why ? `<p class="share-why">${esc(it.why)}</p>` : ''}
        ${price ? `<p class="share-price">${price}</p>` : ''}
        ${it.product_url || it.search_url ? `<a class="share-link" target="_blank" rel="noopener" href="${esc(it.product_url || it.search_url)}">View product →</a>` : ''}
        ${claimed ? `<p class="share-claims">Claimed by: ${it.claims.map(claimLine).join(', ')}</p>` : ''}
        <button class="share-claim-btn" data-id="${it.id}" data-have="${iHave ? 1 : 0}">${iHave ? 'Release my claim' : "I'll buy this"}</button>
      </div>
    </article>`;
  }).join('');
  root.innerHTML = `<header class="share-head">
      <div class="share-emoji">${esc(r.emoji || '🎁')}</div>
      <h1>Gift list for ${esc(r.name)}</h1>
      <p class="share-sub">Claim what you plan to buy so no one doubles up.</p>
    </header>
    <section class="share-grid">${items || '<p>No items on this list yet.</p>'}</section>`;
  root.querySelectorAll('.share-claim-btn').forEach((btn) => btn.addEventListener('click', onClaim));
}

async function onClaim(e) {
  const btn = e.currentTarget;
  const id = Number(btn.dataset.id);
  const have = btn.dataset.have === '1';
  let name = localStorage.getItem(nameKey) || '';
  if (!name) { name = (prompt('Your name (so others know who claimed it):') || '').trim(); if (!name) return; localStorage.setItem(nameKey, name); }
  btn.disabled = true;
  try {
    await api('/' + (have ? 'unclaim' : 'claim'), { method: 'POST', body: JSON.stringify({ ideaId: id, name }) });
    load();
  } catch (err) { alert(err.message); btn.disabled = false; }
}

async function load() {
  try { render(await api('')); }
  catch (e) { root.innerHTML = '<p class="share-loading">This list is unavailable.</p>'; }
}
load();
