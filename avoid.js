// avoid.js
'use strict';
// Parsing for the dedicated "never suggest (avoid)" field. Unlike free-text
// steering notes, EVERY term listed here is an absolute avoid - no "no"/"less"
// phrasing required. Used to filter the pool, purge existing ideas, and tell the
// LLM what to steer clear of.

// Filler that carries no avoid meaning on its own.
const STOP = new Set(['the', 'and', 'but', 'for', 'with', 'without', 'any', 'all', 'some', 'too', 'much',
  'many', 'more', 'less', 'fewer', 'not', 'nor', 'dont', 'don', 'nothing', 'stuff', 'things', 'thing',
  'item', 'items', 'gift', 'gifts', 'idea', 'ideas', 'stuff', 'kind', 'type', 'avoid', 'skip', 'hate',
  'please', 'just', 'really', 'into', 'about', 'that', 'this', 'those', 'these', 'him', 'her', 'them']);

function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Split on commas/newlines/semicolons, then collect meaningful words (>=3 chars,
// not filler), lowercased and de-duplicated, in first-seen order.
function avoidFieldTerms(text) {
  const out = [];
  const seen = new Set();
  for (const clause of String(text || '').toLowerCase().split(/[,\n;]+/)) {
    for (const w of clause.split(/[^a-z]+/)) {
      if (w.length >= 3 && !STOP.has(w) && !seen.has(w)) { seen.add(w); out.push(w); }
    }
  }
  return out;
}

function buildAvoidRx(terms) {
  if (!terms || !terms.length) return null;
  return new RegExp('\\b(' + terms.map(escapeRx).join('|') + ')', 'i');
}

module.exports = { avoidFieldTerms, buildAvoidRx, escapeRx };
