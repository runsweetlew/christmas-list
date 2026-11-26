'use strict';
// One-time cleanup: remove already-generated gift ideas whose wording clearly
// targets the opposite gender from the recipient, using the SAME guard the live
// app now applies to new ideas (gender.js). Only touches status='active' pool
// items; never removes listed/purchased (deliberately chosen) or hidden (already
// banished) ideas. Dry-run by default; pass --apply to actually delete.
const { db } = require('../db');
const { genderTextMismatch, genderWants } = require('../gender');

const APPLY = process.argv.includes('--apply');

const recipients = db.prepare('SELECT id, name, gender FROM recipients').all();
const activeFor = db.prepare("SELECT id, title, category, descr FROM ideas WHERE recipient_id = ? AND status = 'active'");
const delPrice = db.prepare('DELETE FROM price_history WHERE idea_id = ?');
const delIdea = db.prepare('DELETE FROM ideas WHERE id = ?');

let totalFlagged = 0, totalDeleted = 0, recipientsTouched = 0;

for (const r of recipients) {
  const { wantM, wantF } = genderWants(r.gender);
  if (!wantM && !wantF) continue; // no/neutral gender -> nothing to purge
  const ideas = activeFor.all(r.id);
  const bad = ideas.filter((i) => genderTextMismatch((i.title || '') + ' ' + (i.category || '') + ' ' + (i.descr || ''), r.gender));
  if (!bad.length) continue;
  recipientsTouched++;
  totalFlagged += bad.length;
  console.log(`\n${r.name} (${r.gender}) — ${bad.length} of ${ideas.length} active ideas flagged:`);
  for (const b of bad) console.log(`  - [${b.id}] ${b.title}${b.category ? '  ·  ' + b.category : ''}`);
  if (APPLY) {
    const tx = db.transaction(() => {
      for (const b of bad) { delPrice.run(b.id); delIdea.run(b.id); totalDeleted++; }
    });
    tx();
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Recipients with flagged items: ${recipientsTouched}`);
console.log(`Opposite-gender active ideas flagged: ${totalFlagged}`);
if (APPLY) console.log(`DELETED: ${totalDeleted}`);
else console.log(`DRY RUN — nothing deleted. Re-run with --apply to delete.`);
