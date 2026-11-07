'use strict';
/* The Christmas List - client app */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const money = (c) => '$' + (Math.round(c || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: (c % 100 ? 2 : 0), maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const attr = (s) => String(s == null ? '' : s).replace(/"/g, '&quot;');
const link = (i) => i.product_url || i.search_url || '#';

/* image with graceful fallback to a placeholder sibling */
function imgHtml(image, title, imgClass, phClass) {
  const ph = `<div class="${phClass}" ${image ? 'style="display:none"' : ''}>🎁<br>${esc((title || '').slice(0, 40))}</div>`;
  if (!image) return ph;
  return `<img class="${imgClass}" src="${attr(image)}" alt="${attr(title)}" referrerpolicy="no-referrer" loading="lazy"
    onerror="var p=this.nextElementSibling;if(p)p.style.display='grid';this.remove()">${ph}`;
}

const api = {
  async get(u) { const r = await fetch(u); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status); return r.json(); },
  async send(u, method, body) {
    const r = await fetch(u, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    return r.json();
  },
  post(u, b) { return this.send(u, 'POST', b); },
  put(u, b) { return this.send(u, 'PUT', b); },
  del(u) { return this.send(u, 'DELETE'); }
};

let STATE = { recipients: [], person: null, ideas: [], battle: null };

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false; t.classList.toggle('err', !!isErr);
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------------- view switching ---------------- */
function showView(name) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  const el = $('#view-' + name); if (el) el.classList.add('active');
  $$('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab'); if (!b) return;
  const v = b.dataset.view;
  if (v === 'list') loadList();
  if (v === 'battle') openBattle(STATE.person ? STATE.person.id : null);
  if (v === 'shop') loadShop();
  showView(v);
});
document.body.addEventListener('click', (e) => {
  if (e.target.closest('[data-view="list"].back')) { loadList(); showView('list'); }
});

/* ---------------- PEOPLE ---------------- */
async function loadList() {
  const { recipients } = await api.get('/api/state');
  STATE.recipients = recipients;
  $('#people-grid').innerHTML = recipients.map(personCard).join('') +
    `<div class="add-card" id="add-person"><div><div class="plus">+</div><div>Add someone</div></div></div>`;
}
function personCard(r) {
  const c = r.counts;
  return `<div class="person-card" data-id="${r.id}">
    <div class="avatar">${esc(r.emoji)}</div>
    <h3>${esc(r.name)}</h3>
    <div class="rel">${esc(r.relationship || '')}</div>
    <div class="kw">${esc(r.keywords || '')}</div>
    <div class="chips">
      <span class="chip">${c.active} ideas</span>
      <span class="chip star">★ ${c.listed}</span>
      <span class="chip buy">✓ ${c.purchased}</span>
    </div>
    <div class="budget">Budget <b>${money(r.budget_min)} – ${money(r.budget_max)}</b></div>
    <div class="pcard-actions">
      <button class="btn primary sm" data-act="open" data-id="${r.id}">Open</button>
      <button class="btn gold sm" data-act="battle" data-id="${r.id}">Head-to-Head</button>
      <button class="btn ghost sm" data-act="edit" data-id="${r.id}">Edit</button>
    </div>
  </div>`;
}
$('#people-grid').addEventListener('click', (e) => {
  if (e.target.closest('#add-person')) return openPersonEditor(null);
  const btn = e.target.closest('[data-act]');
  if (btn) {
    const id = +btn.dataset.id;
    if (btn.dataset.act === 'open') return openPerson(id);
    if (btn.dataset.act === 'battle') { openBattle(id); showView('battle'); return; }
    if (btn.dataset.act === 'edit') return openPersonEditor(id);
    return;
  }
  const card = e.target.closest('.person-card');
  if (card) openPerson(+card.dataset.id);
});

/* ---------------- PERSON EDITOR ---------------- */
function personFormHtml(r) {
  r = r || { name: '', relationship: '', emoji: '🎁', age: '', gender: '', keywords: '', wishlist: '', budget_min: 2500, budget_max: 15000 };
  return `<h2>${r.id ? 'Edit ' + esc(r.name) : 'Add someone'}</h2>
    <div class="form-grid">
      <div><label>Name</label><input id="f-name" value="${attr(r.name)}" placeholder="Grandma"></div>
      <div><label>Relationship</label><input id="f-rel" value="${attr(r.relationship)}" placeholder="Mother-in-law"></div>
      <div><label>Emoji</label><input id="f-emoji" value="${attr(r.emoji)}" maxlength="4" placeholder="🎁"></div>
      <div><label>Age</label><input id="f-age" value="${attr(r.age)}" placeholder="60s"></div>
      <div><label>Gender</label><input id="f-gender" value="${attr(r.gender)}" placeholder="any"></div>
      <div class="full"><label>Interests / keywords</label><input id="f-kw" value="${attr(r.keywords)}" placeholder="golf, grilling, whiskey, history"></div>
      <div class="full wish-field"><label>What they said they want (we go deep on this)</label>
        <textarea id="f-wish" placeholder="Their actual asks, hints, sizes, favorite brands, links they sent...">${esc(r.wishlist)}</textarea></div>
      <div class="full fb-field"><label>Your steering notes (likes, dislikes, things to avoid)</label>
        <textarea id="f-fb" placeholder="Builds up as you give feedback in head-to-head. Edit freely.">${esc(r.feedback || '')}</textarea></div>
      <div class="full"><label>Budget per gift</label>
        <div class="budget-row">
          <input id="f-bmin" type="number" value="${Math.round(r.budget_min / 100)}" min="0"> <span>to</span>
          <input id="f-bmax" type="number" value="${Math.round(r.budget_max / 100)}" min="1"> <span>dollars</span>
        </div></div>
    </div>
    <div class="form-actions">
      <button class="btn primary" id="f-save">${r.id ? 'Save changes' : 'Add person'}</button>
      ${r.id ? `<button class="btn ghost" id="f-delete">Delete</button>` : ''}
      <button class="btn ghost" id="f-cancel">Cancel</button>
    </div>`;
}
function openPersonEditor(id) {
  const r = id ? STATE.recipients.find((x) => x.id === id) : null;
  openModal(personFormHtml(r));
  $('#f-save').onclick = async () => {
    const body = {
      name: $('#f-name').value, relationship: $('#f-rel').value, emoji: $('#f-emoji').value || '🎁',
      age: $('#f-age').value, gender: $('#f-gender').value, keywords: $('#f-kw').value, wishlist: $('#f-wish').value,
      feedback: $('#f-fb') ? $('#f-fb').value : undefined,
      budget_min: Math.round((+$('#f-bmin').value || 0) * 100), budget_max: Math.round((+$('#f-bmax').value || 150) * 100)
    };
    // did the targeting (what drives idea matching) change?
    const changedTargeting = r && (
      body.keywords.trim() !== (r.keywords || '').trim() ||
      body.wishlist.trim() !== (r.wishlist || '').trim() ||
      (body.feedback || '').trim() !== (r.feedback || '').trim() ||
      body.budget_min !== r.budget_min || body.budget_max !== r.budget_max);
    try {
      if (id) await api.put('/api/recipients/' + id, body); else await api.post('/api/recipients', body);
      closeModal();
      if (id && changedTargeting) {
        toast('Saved. Pulling in fresh ideas to match...');
        await openPerson(id);
        const gs = $('#gen-status'); if (gs) gs.innerHTML = '<span class="spinner"></span> Updating the idea pool for ' + esc(body.name) + '...';
        const res = await api.post('/api/recipients/' + id + '/generate', { rounds: 2 });
        await openPerson(id);
        toast(res.added ? `Added ${res.added} re-targeted ideas` : 'Profile saved', res.error && !res.added);
      } else if (id) {
        await openPerson(id); toast('Saved');
      } else {
        await loadList(); showView('list'); toast('Added');
      }
    } catch (err) { toast('Could not save: ' + err.message, true); }
  };
  if (id) $('#f-delete').onclick = async () => {
    if (!confirm('Delete this person and all their gift ideas?')) return;
    await api.del('/api/recipients/' + id); closeModal(); await loadList(); showView('list'); toast('Removed');
  };
  $('#f-cancel').onclick = closeModal;
}

/* ---------------- PERSON DETAIL ---------------- */
async function openPerson(id) {
  const { recipient, ideas } = await api.get('/api/recipients/' + id);
  STATE.person = recipient; STATE.ideas = ideas;
  renderPerson(); showView('person');
}
function renderPerson() {
  const r = STATE.person, ideas = STATE.ideas;
  const active = ideas.filter((i) => i.status === 'active');
  const listed = ideas.filter((i) => i.status === 'listed');
  const purchased = ideas.filter((i) => i.status === 'purchased');
  $('#person-detail').innerHTML = `
    <div class="persona-box">
      <div class="persona-head">
        <div class="avatar">${esc(r.emoji)}</div>
        <div><h2>${esc(r.name)}</h2><div class="rel">${esc(r.relationship || '')} · budget ${money(r.budget_min)} – ${money(r.budget_max)}</div></div>
      </div>
      <p class="kw" style="color:var(--ink-soft);font-size:14px;margin:0 0 4px">${esc(r.keywords || '')}</p>
      ${r.wishlist ? `<p class="gen-note">Wants: ${esc(r.wishlist)}</p>` : ''}
      <div class="form-actions">
        <button class="btn primary" id="p-battle" ${active.length < 2 ? 'disabled' : ''}>Head-to-Head (${active.length})</button>
        <button class="btn gold" id="p-refine" ${active.length < 4 ? 'disabled' : ''} title="Keep your top 50% by Elo and replace the bottom 50% with fresh ideas">✨ Refine from winners</button>
        <button class="btn gold" id="p-generate">Generate more ideas</button>
        <button class="btn ghost" id="p-edit">Edit person</button>
        <button class="btn ghost" id="p-add">Add idea manually</button>
      </div>
      <div id="gen-status" class="gen-note" style="margin-top:10px"></div>
    </div>
    ${listed.length ? sectionHtml('★ On the shopping list', listed) : ''}
    <div class="ideas-head"><h3>Gift ideas (${active.length})</h3>
      <span class="gen-note">Star the keepers, banish the duds, or battle them.</span></div>
    <div class="idea-grid">${active.map(ideaCard).join('') || '<p class="gen-note">No ideas yet. Hit Generate more ideas.</p>'}</div>
    ${purchased.length ? sectionHtml('✓ Already bought', purchased) : ''}`;
  $('#p-generate').onclick = generateFor;
  $('#p-refine').onclick = () => doRefine(false);
  $('#p-battle').onclick = () => { openBattle(r.id); showView('battle'); };
  $('#p-edit').onclick = () => openPersonEditor(r.id);
  $('#p-add').onclick = () => openIdeaEditor(r.id);
}
function sectionHtml(title, items) {
  return `<div class="ideas-head"><h3>${title} (${items.length})</h3></div><div class="idea-grid">${items.map(ideaCard).join('')}</div>`;
}
function ideaCard(i) {
  const price = i.last_price || i.est_price;
  const pill = i.status === 'listed' ? '<span class="status-pill listed">★ Listed</span>'
    : i.status === 'purchased' ? '<span class="status-pill purchased">✓ Bought</span>' : '';
  let actions;
  if (i.status === 'active') {
    actions = `<a class="btn ghost sm" href="${attr(link(i))}" target="_blank" rel="noopener">View</a>
      <button class="btn gold sm" data-idea="${i.id}" data-do="list">★ Keep</button>
      <button class="btn ghost sm" data-idea="${i.id}" data-do="hide">✕</button>`;
  } else if (i.status === 'listed') {
    actions = `<a class="btn ghost sm" href="${attr(link(i))}" target="_blank" rel="noopener">View</a>
      <button class="btn primary sm" data-idea="${i.id}" data-do="buy">✓ Bought</button>
      <button class="btn ghost sm" data-idea="${i.id}" data-do="active">Unstar</button>`;
  } else {
    actions = `<a class="btn ghost sm" href="${attr(link(i))}" target="_blank" rel="noopener">View</a>
      <button class="btn ghost sm" data-idea="${i.id}" data-do="list">Un-buy</button>`;
  }
  return `<div class="idea ${i.status}" data-idea-card="${i.id}">
    ${pill}
    <div class="thumb">${imgHtml(i.image, i.title, 'ti', 'ph')}</div>
    <div class="body">
      <div class="cat">${esc(i.category || i.retailer || 'Gift')}</div>
      <h4>${esc(i.title)}</h4>
      <div class="descr">${esc(i.descr)}</div>
      ${i.why ? `<div class="why">${esc(i.why)}</div>` : ''}
      <div class="priceline"><span class="price">${price ? money(price) : '—'}</span><span class="elo">Elo ${Math.round(i.rating)}</span></div>
      <div class="idea-actions">${actions}</div>
    </div>
  </div>`;
}
/* one persistent delegated handler for person-view idea buttons */
$('#person-detail').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-do]'); if (!b) return;
  const id = +b.dataset.idea, act = b.dataset.do;
  try {
    if (act === 'buy') {
      const idea = STATE.ideas.find((x) => x.id === id);
      const def = idea ? Math.round((idea.last_price || idea.est_price || 0) / 100) : '';
      const paid = prompt('What did you pay? (dollars)', def || ''); if (paid === null) return;
      await api.post(`/api/ideas/${id}/status`, { status: 'purchased', purchased_price: Math.round((+paid || 0) * 100) });
    } else {
      await api.post(`/api/ideas/${id}/status`, { status: act === 'list' ? 'listed' : act === 'hide' ? 'hidden' : 'active' });
    }
    await openPerson(STATE.person.id); toast('Updated');
  } catch (err) { toast('Error: ' + err.message, true); }
});

async function generateFor() {
  const r = STATE.person, btn = $('#p-generate'); btn.disabled = true;
  $('#gen-status').innerHTML = '<span class="spinner"></span> Finding fresh ideas for ' + esc(r.name) + '...';
  try {
    const res = await api.post('/api/recipients/' + r.id + '/generate', {});
    if (res.added > 0) toast(`Added ${res.added} ideas`);
    else toast(res.error ? 'Idea engine unavailable right now' : 'No new ideas this round', !!res.error);
    await openPerson(r.id);
  } catch (err) { toast('Generate failed: ' + err.message, true); btn.disabled = false; }
}

async function doRefine(fromBattle) {
  const r = STATE.person; if (!r) return;
  const active = (fromBattle && STATE.battle) ? STATE.battle.pool : STATE.ideas.filter((i) => i.status === 'active');
  if (active.length < 4) { toast('Battle a few ideas first so there are winners to keep', true); return; }
  const keepN = Math.max(5, Math.ceil(active.length * 0.5));
  if (!confirm(`Keep your top ${keepN} ideas (the highest Elo) for ${r.name}, replace the bottom ${active.length - keepN} with fresh ideas inspired by the winners, and keep at least 80 in play?`)) return;
  const statusEl = fromBattle ? null : $('#gen-status');
  if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> Keeping your winners and breeding fresh ideas...';
  else toast('Refining from your top picks...');
  try {
    const res = await api.post('/api/recipients/' + r.id + '/refine', { rounds: 2 });
    toast(`Kept ${res.kept}, retired ${res.retired}, added ${res.added} fresh ideas ✨`, res.error && !res.added);
    if (fromBattle) await openBattle(r.id); else await openPerson(r.id);
  } catch (e) { toast('Refine failed: ' + e.message, true); if (statusEl) statusEl.textContent = ''; }
}

function openIdeaEditor(recipientId) {
  openModal(`<h2>Add a gift idea</h2>
    <div class="form-grid">
      <div class="full"><label>Title</label><input id="i-title" placeholder="YETI Hopper cooler"></div>
      <div class="full"><label>Description</label><input id="i-descr" placeholder="Soft cooler that keeps ice for days"></div>
      <div><label>Category</label><input id="i-cat" placeholder="Outdoors"></div>
      <div><label>Est. price ($)</label><input id="i-price" type="number" placeholder="250"></div>
      <div><label>Retailer</label><input id="i-retailer" placeholder="Amazon"></div>
      <div class="full"><label>Product URL (specific item)</label><input id="i-url" placeholder="https://..."></div>
      <div class="full"><label>Image URL (optional)</label><input id="i-img" placeholder="https://...jpg"></div>
    </div>
    <div class="form-actions"><button class="btn primary" id="i-save">Add idea</button><button class="btn ghost" id="i-cancel">Cancel</button></div>`);
  $('#i-save').onclick = async () => {
    const title = $('#i-title').value.trim(); if (!title) return toast('Give it a title', true);
    await api.post('/api/recipients/' + recipientId + '/ideas', {
      title, descr: $('#i-descr').value, category: $('#i-cat').value,
      est_price: Math.round((+$('#i-price').value || 0) * 100), retailer: $('#i-retailer').value,
      search_url: $('#i-url').value, image: $('#i-img').value, search_query: title
    });
    closeModal(); await openPerson(recipientId); toast('Idea added');
  };
  $('#i-cancel').onclick = closeModal;
}

/* ---------------- HEAD TO HEAD ---------------- */
async function openBattle(personId) {
  const wrap = $('#battle-wrap');
  if (!personId && !STATE.person) {
    wrap.innerHTML = `<div class="battle-empty"><h2>Pick someone to battle</h2>
      <p>Open a person, then start a head-to-head.</p>
      <p style="margin-top:14px"><button class="btn primary" onclick="window._goList()">Go to People</button></p></div>`;
    return;
  }
  const id = personId || STATE.person.id;
  const { recipient, ideas } = await api.get('/api/recipients/' + id);
  STATE.person = recipient; STATE.ideas = ideas;
  const pool = ideas.filter((i) => i.status === 'active');
  STATE.battle = { pool, count: 0, pair: null, history: [], last: null };
  if (pool.length < 2) {
    wrap.innerHTML = `<div class="battle-empty"><h2>Not enough ideas yet</h2>
      <p>${esc(recipient.name)} needs at least 2 active ideas. Generate some first.</p>
      <p style="margin-top:14px"><button class="btn primary" onclick="window._openPerson(${id})">Open ${esc(recipient.name)}</button></p></div>`;
    return;
  }
  nextPair();
}
function pickPair(pool) {
  const leastBattled = [...pool].sort((a, b) => a.battles - b.battles);
  const rated = pool.filter((p) => p.battles > 0);
  let a, b;
  if (rated.length >= 2 && Math.random() < 0.5) {
    // contender (a current favorite) vs a fresh challenger, so ratings spread
    const top = [...pool].sort((x, y) => y.rating - x.rating).slice(0, Math.max(6, Math.ceil(pool.length * 0.15)));
    a = top[Math.floor(Math.random() * top.length)];
    do { b = leastBattled[Math.floor(Math.random() * Math.min(8, leastBattled.length))]; } while (b.id === a.id);
  } else {
    a = leastBattled[Math.floor(Math.random() * Math.min(6, leastBattled.length))];
    do { b = pool[Math.floor(Math.random() * pool.length)]; } while (b.id === a.id);
  }
  return Math.random() < 0.5 ? [a, b] : [b, a];
}
function fmtDelta(d) { return (d > 0 ? '+' : '') + d; }
function lastResultHtml(last) {
  if (!last) return '';
  const t = (s) => esc((s || '').slice(0, 26));
  if (last.type === 'neither') {
    return `<div class="last-result"><span class="down">✕ Neither &mdash; ${t(last.a.t)} ${fmtDelta(last.a.d)} · ${t(last.b.t)} ${fmtDelta(last.b.d)}</span></div>`;
  }
  return `<div class="last-result"><span class="up">▲ ${t(last.win.t)} ${fmtDelta(last.win.d)}</span> <span class="down">▼ ${t(last.lose.t)} ${fmtDelta(last.lose.d)}</span></div>`;
}
function nextPair() { STATE.battle.pair = pickPair(STATE.battle.pool); renderBattle(); }
function renderBattle() {
  const r = STATE.person, st = STATE.battle, [a, b] = st.pair;
  const lb = [...st.pool].sort((x, y) => y.rating - x.rating).slice(0, 6);
  $('#battle-wrap').innerHTML = `
    <button class="back" id="b-back">&larr; Back to ${esc(r.emoji)} ${esc(r.name)}</button>
    <div class="battle-top">
      <h1>This or That</h1>
      <div class="who">${esc(r.emoji)} for ${esc(r.name)}</div>
      <div class="battle-progress">Matchup ${st.count + 1} · ${st.pool.length} gifts in the running</div>
      ${lastResultHtml(st.last)}
      <div class="keyhint">
        <span><span class="kbd">←</span><span class="kbd">→</span> <span class="lbl">pick</span></span>
        <span><span class="kbd">↓</span> <span class="lbl">neither</span></span>
        <span><span class="kbd">Space</span> <span class="lbl">skip</span></span>
        <span><span class="kbd">U</span> <span class="lbl">undo</span></span>
      </div>
    </div>
    <div class="vs-wrap">
      ${battleCard(a, 'left')}
      <div class="vs-mid"><div class="vs-badge">vs</div></div>
      ${battleCard(b, 'right')}
    </div>
    <div class="battle-controls">
      <button class="btn ghost" id="b-undo" ${st.history && st.history.length ? '' : 'disabled'}>↶ Undo</button>
      <button class="btn red" id="b-neither">↓ Neither</button>
      <button class="btn ghost" id="b-skip">Skip pair</button>
      <button class="btn gold" id="b-refine" title="Keep top 50%, replace bottom 50% with fresh ideas">✨ Refine</button>
      <button class="btn ghost" id="b-done">Done</button>
    </div>
    <div class="fb-box">
      <label>Steer the ideas &mdash; tell me what to change</label>
      <div class="fb-row">
        <input id="fb-input" placeholder="e.g. less kitchen stuff, more outdoorsy, he already owns a YETI..." autocomplete="off">
        <button class="btn primary" id="fb-apply">Apply</button>
      </div>
    </div>
    <div class="leaderboard">
      <h3>Leading for ${esc(r.name)}</h3>
      ${lb.map((i, idx) => `<a class="lb-row ${idx === 0 ? 'top' : ''}" href="${attr(link(i))}" target="_blank" rel="noopener" title="Shop ${attr(i.title)}">
        <div class="lb-rank">${idx + 1}</div>
        ${i.image ? `<img class="lb-thumb" src="${attr(i.image)}" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
        <div class="lb-name">${esc(i.title)}</div>
        <div class="lb-elo">Elo ${Math.round(i.rating)}</div>
        <div class="lb-price">${(i.last_price || i.est_price) ? money(i.last_price || i.est_price) : ''}</div>
        <div class="lb-go">Shop &rarr;</div>
      </a>`).join('')}
    </div>`;
  $$('#battle-wrap .vs-card').forEach((c) => c.addEventListener('click', (e) => {
    if (e.target.closest('[data-mini]') || e.target.closest('a')) return;
    chooseWinner(+c.dataset.id);
  }));
  $$('#battle-wrap [data-mini]').forEach((btn) => btn.addEventListener('click', (e) => {
    e.stopPropagation(); miniAction(+btn.dataset.id, btn.dataset.mini);
  }));
  $('#b-back').onclick = () => openPerson(STATE.person.id);
  $('#b-skip').onclick = nextPair;
  $('#b-undo').onclick = undoLast;
  $('#b-refine').onclick = () => doRefine(true);
  $('#b-neither').onclick = chooseNeither;
  $('#b-done').onclick = () => openPerson(STATE.person.id);
  const fbApply = () => submitFeedback($('#fb-input').value);
  $('#fb-apply').onclick = fbApply;
  $('#fb-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fbApply(); } });
}
function battleCard(i, side) {
  const price = i.last_price || i.est_price;
  return `<div class="vs-card" data-id="${i.id}" data-side="${side}">
    <div class="vimg">
      <div class="elo-badge">Elo ${Math.round(i.rating)}</div>
      ${imgHtml(i.image, i.title, 'vi', 'vph')}
    </div>
    <div class="vbody">
      <div class="cat">${esc(i.category || i.retailer || 'Gift')}</div>
      <h3>${esc(i.title)}</h3>
      <div class="descr">${esc(i.descr)}</div>
      ${i.why ? `<div class="why">${esc(i.why)}</div>` : ''}
      <div class="vfoot">
        <span class="price">${price ? money(price) : '—'}</span>
        <span class="mini-actions">
          <a class="btn ghost sm" href="${attr(link(i))}" target="_blank" rel="noopener">View item</a>
          <button class="btn gold sm" data-mini="list" data-id="${i.id}">★</button>
          <button class="btn ghost sm" data-mini="hide" data-id="${i.id}">✕</button>
        </span>
      </div>
    </div>
  </div>`;
}
// Pull fresh, on-taste ideas in the background and merge them into the running
// battle pool, so the user never waits for generation. Silent on error.
async function scheduleRefill() {
  if (STATE.refilling || !STATE.person) return;
  STATE.refilling = true;
  const pid = STATE.person.id;
  try {
    const before = new Set((STATE.battle ? STATE.battle.pool : STATE.ideas).map((x) => x.id));
    const res = await api.post('/api/recipients/' + pid + '/generate', { rounds: 2 });
    if (!STATE.person || STATE.person.id !== pid) return; // user moved on
    const fresh = res.ideas.filter((i) => i.status === 'active' && !before.has(i.id));
    STATE.ideas = res.ideas;
    if (STATE.battle && fresh.length) {
      const have = new Set(STATE.battle.pool.map((p) => p.id));
      for (const it of fresh) if (!have.has(it.id)) STATE.battle.pool.push(it);
      toast(`✨ ${fresh.length} fresh ideas added`);
    }
  } catch (e) { /* silent; will retry on the next trigger */ }
  finally { STATE.refilling = false; }
}

async function chooseWinner(winnerId) {
  const st = STATE.battle, [a, b] = st.pair;
  const loserId = winnerId === a.id ? b.id : a.id;
  const w = st.pool.find((p) => p.id === winnerId), l = st.pool.find((p) => p.id === loserId);
  const wOld = w ? w.rating : 1500, lOld = l ? l.rating : 1500;
  st.history.push({ kind: 'rating', pair: [a, b], items: [
    { id: w.id, rating: wOld, battles: w.battles }, { id: l.id, rating: lOld, battles: l.battles } ] });
  st.count++;
  try {
    const res = await api.post('/api/battle', { winnerId, loserId });
    for (const p of st.pool) {
      if (p.id === res.winner.id) { p.rating = res.winner.rating; p.battles++; }
      if (p.id === res.loser.id) { p.rating = res.loser.rating; p.battles++; }
    }
    st.last = { type: 'win',
      win: { t: w ? w.title : '', d: Math.round(res.winner.rating - wOld) },
      lose: { t: l ? l.title : '', d: Math.round(res.loser.rating - lOld) } };
  } catch (e) { /* keep going */ }
  if (st.count % 50 === 0) scheduleRefill(); // auto top-up in the background
  nextPair();
}
async function chooseNeither() {
  const st = STATE.battle, [a, b] = st.pair;
  const aOld = a.rating, bOld = b.rating;
  st.history.push({ kind: 'rating', pair: [a, b], items: [
    { id: a.id, rating: aOld, battles: a.battles }, { id: b.id, rating: bOld, battles: b.battles } ] });
  st.count++;
  try {
    const res = await api.post('/api/battle', { neither: true, aId: a.id, bId: b.id });
    for (const p of st.pool) {
      if (res.a && p.id === res.a.id) { p.rating = res.a.rating; p.battles++; }
      if (res.b && p.id === res.b.id) { p.rating = res.b.rating; p.battles++; }
    }
    st.last = { type: 'neither',
      a: { t: a.title, d: Math.round((res.a ? res.a.rating : aOld) - aOld) },
      b: { t: b.title, d: Math.round((res.b ? res.b.rating : bOld) - bOld) } };
  } catch (e) { /* keep going */ }
  if (st.count % 50 === 0) scheduleRefill(); // auto top-up in the background
  nextPair();
}
async function submitFeedback(text) {
  text = (text || '').trim(); if (!text) return;
  const btn = $('#fb-apply'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  try {
    const res = await api.post('/api/recipients/' + STATE.person.id + '/feedback', { text });
    toast(res.purged ? `Removed ${res.purged}. Finding fresh ideas in the background...` : 'Steering saved. Finding fresh ideas in the background...');
    await openBattle(STATE.person.id); // reload the purged pool instantly
    scheduleRefill(); // pull new on-taste ideas in the background
  } catch (e) { toast('Feedback failed: ' + e.message, true); if (btn) { btn.disabled = false; btn.textContent = 'Apply'; } }
}
async function miniAction(id, act) {
  const st = STATE.battle;
  const item = st.pool.find((p) => p.id === id);
  st.history.push({ kind: 'status', pair: st.pair, id, item });
  try { await api.post(`/api/ideas/${id}/status`, { status: act === 'list' ? 'listed' : 'hidden' }); } catch (e) {}
  st.pool = st.pool.filter((p) => p.id !== id);
  STATE.ideas = STATE.ideas.map((i) => i.id === id ? { ...i, status: act === 'list' ? 'listed' : 'hidden' } : i);
  toast(act === 'list' ? '★ Added to shopping list' : 'Banished');
  if (st.pool.length < 2) { openPerson(STATE.person.id); return; }
  nextPair();
}
async function undoLast() {
  const st = STATE.battle; if (!st) return;
  const rec = st.history.pop();
  if (!rec) { toast('Nothing to undo'); return; }
  if (rec.kind === 'rating') {
    try { await api.post('/api/battle/undo', { items: rec.items }); } catch (e) {}
    for (const ri of rec.items) { const p = st.pool.find((x) => x.id === ri.id); if (p) { p.rating = ri.rating; p.battles = ri.battles; } }
    st.count = Math.max(0, st.count - 1);
  } else if (rec.kind === 'status') {
    try { await api.post('/api/ideas/' + rec.id + '/status', { status: 'active' }); } catch (e) {}
    if (rec.item && !st.pool.find((x) => x.id === rec.id)) st.pool.push(rec.item);
    STATE.ideas = STATE.ideas.map((i) => i.id === rec.id ? { ...i, status: 'active' } : i);
  }
  st.pair = rec.pair; st.last = null;
  renderBattle();
  toast('Undid last decision');
}

/* keyboard nav for battle */
document.addEventListener('keydown', (e) => {
  if (!$('#view-battle').classList.contains('active')) return;
  const st = STATE.battle; if (!st || !st.pair) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const [a, b] = st.pair;
  if (e.key === 'ArrowLeft') { e.preventDefault(); chooseWinner(a.id); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); chooseWinner(b.id); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); chooseNeither(); }
  else if (e.key === ' ') { e.preventDefault(); nextPair(); }
  else if (e.key === 'u' || e.key === 'U' || e.key === 'Backspace') { e.preventDefault(); undoLast(); }
  else if (e.key === 's' || e.key === 'S') {
    e.preventDefault(); // star the current leader of this pair
    const winner = a.rating >= b.rating ? a : b; miniAction(winner.id, 'list');
  }
});
window._goList = () => { loadList(); showView('list'); };
window._openPerson = (id) => openPerson(id);

/* ---------------- SHOPPING LIST ---------------- */
async function loadShop() {
  const data = await api.get('/api/shopping-list');
  $('#shop-totals').innerHTML = `
    <div class="total-card"><div class="lab">Still to buy</div><div class="val">${money(data.grandListed)}</div></div>
    <div class="total-card spent"><div class="lab">Already spent</div><div class="val">${money(data.grandSpent)}</div></div>
    <div class="total-card"><div class="lab">Grand total</div><div class="val">${money(data.grandListed + data.grandSpent)}</div></div>`;
  const groups = $('#shop-groups');
  if (!data.groups.length) {
    groups.innerHTML = `<div class="battle-empty"><h2>Nothing starred yet</h2>
      <p>Star gifts from a person's ideas or a head-to-head and they will show up here.</p>
      <p style="margin-top:14px"><button class="btn primary" onclick="window._goList()">Go to People</button></p></div>`;
    return;
  }
  groups.innerHTML = data.groups.map(shopGroup).join('');
  for (const g of data.groups) for (const it of g.items) drawChart(it.id);
  groups.querySelectorAll('[data-shop]').forEach((b) => b.addEventListener('click', shopAction));
  groups.querySelectorAll('[data-save-url]').forEach((inp) => inp.addEventListener('change', saveUrl));
  groups.querySelectorAll('[data-save-target]').forEach((inp) => inp.addEventListener('change', saveTarget));
}
function shopGroup(g) {
  const r = g.recipient;
  return `<div class="shop-group">
    <div class="shop-group-head">
      <div class="avatar">${esc(r.emoji)}</div>
      <h3>${esc(r.name)}</h3>
      <div class="g-tot">to buy <b>${money(g.listed)}</b> · spent <b>${money(g.spent)}</b></div>
    </div>
    ${g.items.map(shopItem).join('')}
  </div>`;
}
function shopItem(i) {
  const price = i.last_price || i.est_price, bought = i.status === 'purchased', target = i.target_price;
  const belowTarget = target && price && price <= target;
  const thumb = i.image ? `<img class="si-thumb" src="${attr(i.image)}" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=\\'si-thumb-ph\\'>🎁</div>'">` : `<div class="si-thumb-ph">🎁</div>`;
  return `<div class="shop-item ${bought ? 'bought' : ''}" data-item="${i.id}">
    ${thumb}
    <div class="si-main">
      <h4>${bought ? '✓ ' : ''}${esc(i.title)}</h4>
      <div class="descr">${esc(i.descr || '')}</div>
      <div class="si-row">
        <span class="si-price">${bought ? money(i.purchased_price || price) : (price ? money(price) : '—')}</span>
        ${bought ? '<span class="si-target">paid</span>' : target ? `<span class="si-target">target <b>${money(target)}</b>${belowTarget ? ' · at target' : ''}</span>` : ''}
      </div>
      ${bought ? '' : `<div class="si-row si-url"><input data-save-url="${i.id}" value="${attr(i.product_url || '')}" placeholder="paste the exact product URL to price-watch"></div>
      <div class="si-row"><label style="margin:0;color:var(--muted)">Target $</label>
        <input data-save-target="${i.id}" type="number" style="max-width:100px" value="${target ? Math.round(target / 100) : ''}" placeholder="opt"></div>`}
      <div class="si-actions">
        <a class="btn ghost sm" href="${attr(link(i))}" target="_blank" rel="noopener">Open store</a>
        ${bought ? `<button class="btn ghost sm" data-shop="unbuy" data-id="${i.id}">Un-buy</button>`
      : `<button class="btn primary sm" data-shop="buy" data-id="${i.id}">Mark bought</button>
         <button class="btn ghost sm" data-shop="unstar" data-id="${i.id}">Remove</button>`}
        <button class="btn ghost sm" data-shop="logprice" data-id="${i.id}">Log price</button>
      </div>
    </div>
    <div class="si-chart">
      <span class="chart-lab">Price watch</span>
      <svg class="spark" id="spark-${i.id}" viewBox="0 0 220 84" preserveAspectRatio="none"></svg>
      <span id="trend-${i.id}" class="si-target"></span>
    </div>
  </div>`;
}
async function shopAction(e) {
  const b = e.currentTarget, id = +b.dataset.id, act = b.dataset.shop;
  try {
    if (act === 'buy') {
      const row = b.closest('.shop-item'); const txt = row ? (row.querySelector('.si-price') || {}).textContent : '';
      const def = txt ? txt.replace(/[^0-9.]/g, '') : '';
      const paid = prompt('What did you pay? (dollars)', def || ''); if (paid === null) return;
      await api.post(`/api/ideas/${id}/status`, { status: 'purchased', purchased_price: Math.round((+paid || 0) * 100) });
    } else if (act === 'unbuy') await api.post(`/api/ideas/${id}/status`, { status: 'listed' });
    else if (act === 'unstar') { if (!confirm('Remove from the shopping list?')) return; await api.post(`/api/ideas/${id}/status`, { status: 'active' }); }
    else if (act === 'logprice') { const p = prompt('Current price (dollars)?'); if (p === null) return; await api.post(`/api/ideas/${id}/price`, { price: Math.round((+p || 0) * 100) }); }
    await loadShop(); toast('Updated');
  } catch (err) { toast('Error: ' + err.message, true); }
}
async function saveUrl(e) { await api.put('/api/ideas/' + (+e.target.dataset.saveUrl), { product_url: e.target.value.trim() }); toast('URL saved · tracked nightly'); }
async function saveTarget(e) { const v = e.target.value === '' ? null : Math.round((+e.target.value || 0) * 100); await api.put('/api/ideas/' + (+e.target.dataset.saveTarget), { target_price: v }); toast('Target saved'); }
async function drawChart(id) {
  try {
    const { prices } = await api.get('/api/ideas/' + id + '/prices');
    const svg = $('#spark-' + id); if (!svg) return;
    const pts = prices.filter((p) => p.ok && p.price > 0);
    const trend = $('#trend-' + id);
    if (pts.length < 2) {
      svg.innerHTML = `<text x="110" y="46" fill="#8a968f" font-size="11" text-anchor="middle">${pts.length ? 'tracking started' : 'no price data yet'}</text>`;
      if (trend) trend.textContent = pts.length ? 'Watching nightly' : ''; return;
    }
    const vals = pts.map((p) => p.price), min = Math.min(...vals), max = Math.max(...vals), range = (max - min) || 1;
    const W = 220, H = 84, pad = 8;
    const x = (i) => pad + (i / (pts.length - 1)) * (W - 2 * pad);
    const y = (v) => H - pad - ((v - min) / range) * (H - 2 * pad);
    const lineP = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
    const area = `${lineP} L${x(pts.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
    const first = vals[0], last = vals[vals.length - 1], dropped = last < first;
    const col = dropped ? '#1f5c42' : last > first ? '#a8352f' : '#b6882e';
    svg.innerHTML = `<path d="${area}" fill="${col}" opacity="0.12"></path>
      <path d="${lineP}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"></path>
      <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3.2" fill="${col}"></circle>`;
    if (trend) {
      const diff = last - first;
      trend.className = 'si-target ' + (dropped ? 'drop' : diff > 0 ? 'rise' : '');
      trend.textContent = diff === 0 ? 'flat so far' : `${dropped ? '▼' : '▲'} ${money(Math.abs(diff))} since ${new Date(pts[0].ts).toLocaleDateString()}`;
    }
  } catch (e) {}
}

/* ---------------- modal ---------------- */
function openModal(html) { $('#modal-body').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }
$('#modal-close').onclick = closeModal;
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

/* boot */
loadList();
