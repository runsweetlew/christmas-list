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

function buildPrompt(person, avoidTitles, liked) {
  const kw = (person.keywords || '').trim();
  const wish = (person.wishlist || '').trim();
  const fb = (person.feedback || '').trim();
  const avoid = (avoidTitles || []).slice(0, 120);
  const likes = (liked || []).slice(0, 20);
  return [
    `You are a sharp, tasteful personal gift concierge building a Christmas shopping list.`,
    `Propose genuinely good, specific, and somewhat novel gift ideas for ONE person.`,
    ``,
    `PERSON`,
    `- Who: ${person.name} (${person.relationship || 'someone'})`,
    person.age ? `- Age: ${person.age}` : '',
    person.gender ? `- Gender: ${person.gender}` : '',
    kw ? `- Interests / keywords: ${kw}` : '',
    wish ? `- WHAT THEY SAID THEY WANT (weight this heavily, go deep to match it): ${wish}` : '',
    fb ? `- SHOPPER FEEDBACK / STEERING (obey this strongly, it reflects what has been liked or rejected so far): ${fb}` : '',
    likes.length ? `- THESE WON the head-to-head ranking (the recipient's taste clearly leans this way). Propose NEW ideas in the same spirit: similar vibe, brands, category feel, quality and price level, or excellent adjacent picks. Do NOT repeat them: ${likes.join('; ')}` : '',
    `- Budget per gift: ${dollars(person.budget_min, person.budget_max)}`,
    ``,
    `RULES`,
    `- Return specific, real, buyable product ideas (name real product categories, lines, or models). Avoid vague ideas like "a nice sweater".`,
    `- If a wishlist is given, make most ideas clearly satisfy it, plus a few inspired adjacent surprises.`,
    `- Mix price points inside the budget. No duplicates. Be varied across categories.`,
    `- Favor interesting / novel finds over the most obvious cliches, but stay practical and giftable.`,
    avoid.length ? `- Do NOT repeat any of these already-seen ideas: ${avoid.join('; ')}` : '',
    ``,
    `Return STRICT JSON only, no prose, shaped exactly as:`,
    `{"ideas":[{"title":"...","descr":"one punchy sentence on what it is","category":"e.g. Outdoors","est_price":12900,"retailer":"Amazon","search_query":"exact words to search a store for this","why":"one line on why it fits this person"}]}`,
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

async function callGroq(prompt) {
  if (!GROQ_KEY) return null;
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
  if (!res.ok) throw new Error('groq ' + res.status + ' ' + (await res.text()).slice(0, 300));
  const j = await res.json();
  return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
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
async function generateIdeas(person, avoidTitles, liked) {
  const prompt = buildPrompt(person, avoidTitles, liked);
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
