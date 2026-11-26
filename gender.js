// gender.js
'use strict';
// Lightweight, text-based gender guard for free-text gift ideas (SerpApi / LLM
// results) that carry no catalog tags. It is deliberately conservative: it only
// flags items whose wording clearly targets ONE gender, so neutral gifts
// (skillets, headphones, bourbon gear) are never excluded. Catalog items keep
// using their explicit tags; this covers everything that does not have them.

// Note on word boundaries: \bmen\b does NOT match inside "women" and \bman\b
// does NOT match inside "woman" (no boundary before the m), so the two lists do
// not bleed into each other.
const MEN_RX = /\b(men|mens|men's|man|man's|masculine|beard|cologne|aftershave|boxers|guys|him|his)\b/i;
const WOMEN_RX = /\b(women|womens|women's|woman|woman's|ladies|lady|feminine|lipstick|mascara|eyeliner|eyeshadow|makeup|cosmetic|cosmetics|handbag|purse|clutch|blouse|lingerie|bra|panties|heels|perfume|her)\b/i;

function genderWants(gender) {
  const g = String(gender || '').toLowerCase();
  // Decide female first: "female" contains "male", so a male test run on it
  // would wrongly match. Only treat as male if it is not female.
  const wantF = /female|woman|women|girl|lady|ladies|^f/.test(g);
  const wantM = !wantF && /male|man|men|boy|guy|^m/.test(g);
  return { wantM, wantF };
}

// True only when the text clearly targets the OPPOSITE gender. Items that name
// both genders, or neither, are never a mismatch.
function genderTextMismatch(text, gender) {
  const { wantM, wantF } = genderWants(gender);
  if (!wantM && !wantF) return false;
  const t = String(text || '');
  const hasW = WOMEN_RX.test(t);
  const hasM = MEN_RX.test(t);
  if (wantM) return hasW && !hasM;
  if (wantF) return hasM && !hasW;
  return false;
}

// A suffix to steer a shopping query toward the recipient's gender, so the
// results come back targeted at the source instead of filtered after the fact.
function genderQuerySuffix(gender) {
  const { wantM, wantF } = genderWants(gender);
  if (wantM) return ' for men';
  if (wantF) return ' for women';
  return '';
}

module.exports = { genderWants, genderTextMismatch, genderQuerySuffix };
