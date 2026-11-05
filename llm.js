'use strict';
// Gift-idea generator. Uses Groq (OpenAI-compatible) as primary, Gemini as
// fallback. Reads keys from env (passed in via .llm-env). Returns an array of
// normalized idea objects. Never throws to the caller; returns [] on failure.

const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

function dollars(min, max) {
  return `$${Math.round((min || 0) / 100)} to $${Math.round((max || 20000) / 100)}`;
}

function buildPrompt(person, avoidTitles, liked, rejected) {
  const kw = (person.keywords || '').trim();
  const wish = (person.wishlist || '').trim();
  const fb = (person.feedback || '').trim();
  const latest = fb ? fb.split('|').map((s) => s.trim()).filter(Boolean).pop() : '';
  const avoid = (avoidTitles || []).slice(-40); // most recent, to keep the prompt tight
  const likes = (liked || []).slice(0, 14);
  const rejTitles = ((rejected && rejected.titles) || []).slice(0, 16);
  const rejCats = ((rejected && rejected.cats) || []).slice(0, 8);
  return [
    `You are a sharp, tasteful personal gift concierge. Propose genuinely good, SPECIFIC, somewhat novel gift ideas for ONE person.`,
    `Quality and precise fit matter far more than quantity. Obey the SHOPPER STEERING below exactly, above everything else.`,
    ``,
    `RECIPIENT`,
    `- Who: ${person.name} (${person.relationship || 'someone'})`,
    person.age ? `- Age: ${person.age}` : '',
    person.gender ? `- Gender: ${person.gender}` : '',
    kw ? `- General interests: ${kw}` : '',
    wish ? `- What they want (wishlist): ${wish}` : '',
    `- Budget per gift: ${dollars(person.budget_min, person.budget_max)}`,
    ``,
    latest ? `SHOPPER STEERING (HIGHEST PRIORITY, follow precisely; if anything conflicts, the most recent instruction wins):` : '',
    latest ? `>>> ${latest} <<<` : '',
    fb && fb !== latest ? `Earlier steering (context, lower priority): ${fb}` : '',
    ``,
    likes.length ? `LEAN TOWARD (these won head-to-head; propose fresh ideas in the same spirit, not copies): ${likes.join('; ')}` : '',
    (rejTitles.length || rejCats.length) ? `AVOID (the shopper has rejected these; do NOT suggest them, and go light on these whole categories unless the steering explicitly asks for them):` : '',
    rejCats.length ? `- avoid categories: ${rejCats.join(', ')}` : '',
    rejTitles.length ? `- avoid items like: ${rejTitles.join('; ')}` : '',
    ``,
    `RULES`,
    `- SHOPPER STEERING wins over general interests. If it says "less X" or "no X", exclude X and anything adjacent to X entirely, even if X is in their interests.`,
    `- Be concrete: real brands, lines, or models (e.g. "Benchmade Bugout knife"), never vague ("a nice gadget").`,
    `- BESPOKE AND INTERESTING: favor distinctive, memorable, non-obvious gifts, independent makers, well-designed cult items, limited or personalized pieces, experiences, and clever upgrades to what they love. Avoid the generic first-page-of-Amazon picks and holiday cliches. Aim to make the shopper say "oh, that's a great idea" rather than "yeah, obviously."`,
    `- Vary across different categories within what the steering allows. Mix price points across the budget, including a couple of standout splurges.`,
    avoid.length ? `- Do NOT repeat these already-shown ideas: ${avoid.join('; ')}` : '',
    ``,
    `Return STRICT JSON only, no prose, shaped exactly as:`,
    `{"ideas":[{"title":"...","descr":"one punchy sentence on what it is","category":"e.g. Outdoors","est_price":12900,"retailer":"Amazon","search_query":"exact words to search a store for this","why":"one line on why it fits this person and the steering"}]}`,
    `est_price is an integer in CENTS. Return 10 ideas.`
  ].filter(Boolean).join('\n');
}

function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGroq(prompt) {
  if (!GROQ_KEY) return null;
  // Groq free tier is ~8k tokens/min; parallel rounds can trip a 429. Retry with
  // the server-suggested backoff so bursts recover instead of failing.
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.9,
        messages: [
          { role: 'system', content: 'You output only strict JSON. No markdown, no commentary.' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (res.status === 429) {
      const body = await res.text();
      const m = body.match(/try again in ([\d.]+)\s*(ms|s)/i);
      let wait = 1400;
      if (m) wait = m[2].toLowerCase() === 's' ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
      wait = Math.min(9000, Math.max(500, wait)) + 400 * attempt;
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error('groq ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const j = await res.json();
    return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  }
  throw new Error('groq rate-limited after retries');
}

async function callGemini(prompt) {
  if (!GEMINI_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, responseMimeType: 'application/json' }
    })
  });
  if (!res.ok) throw new Error('gemini ' + res.status + ' ' + (await res.text()).slice(0, 300));
  const j = await res.json();
  return j.candidates && j.candidates[0] && j.candidates[0].content &&
    j.candidates[0].content.parts && j.candidates[0].content.parts[0].text;
}

function amazonSearch(q) {
  return 'https://www.amazon.com/s?k=' + encodeURIComponent(q || '');
}

function normalize(raw, person) {
  if (!raw || !Array.isArray(raw.ideas)) return [];
  const out = [];
  for (const it of raw.ideas) {
    const title = String(it.title || '').trim().slice(0, 140);
    if (!title) continue;
    let price = parseInt(it.est_price, 10);
    if (isNaN(price) || price < 0) price = 0;
    if (price > 0 && price < 100) price = price * 100; // model sometimes returns dollars
    const q = String(it.search_query || title).trim();
    out.push({
      title,
      descr: String(it.descr || '').trim().slice(0, 300),
      category: String(it.category || '').trim().slice(0, 60),
      est_price: price,
      retailer: String(it.retailer || 'Amazon').trim().slice(0, 40),
      search_url: /^https?:\/\//i.test(it.search_url) ? it.search_url : amazonSearch(q),
      why: String(it.why || '').trim().slice(0, 240),
      source: 'ai'
    });
  }
  return out;
}

// Generate ideas. Returns { ideas: [...], provider: 'groq'|'gemini'|'none', error? }
async function generateIdeas(person, avoidTitles, liked, rejected) {
  const prompt = buildPrompt(person, avoidTitles, liked, rejected);
  // Try Groq, then Gemini.
  for (const [name, fn] of [['groq', callGroq], ['gemini', callGemini]]) {
    try {
      const text = await fn(prompt);
      if (!text) continue;
      const parsed = extractJson(text);
      const ideas = normalize(parsed, person);
      if (ideas.length) return { ideas, provider: name };
    } catch (e) {
      console.error('[llm] ' + name + ' failed:', e.message);
    }
  }
  return { ideas: [], provider: 'none', error: 'no LLM available or all failed' };
}

module.exports = { generateIdeas, amazonSearch };
