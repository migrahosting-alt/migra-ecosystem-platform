// mp-0009 — a file the conversation lost must be named as lost. © MigraTeck LLC.
//
// 🚨 MEASURED ON STAGING. A lease summary was attached, discussed, then deleted
// from the library. Asked "In the lease document, which year is the rent
// review?", the answer was:
//
//     "The term of the document is 2026 (vendor_terms.md:1-2)."
//
// A DIFFERENT file, cited, with nothing anywhere saying the lease was gone.
// Reconciliation had dropped the deleted file from the available set — correctly,
// it is gone — and the narrowing rules then picked another document and answered
// from it. A confident answer about the wrong document is worse than a refusal,
// because the citation invites the reader to trust it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missingFileEvidence } from './turnGrounding'

test('a conversation that lost nothing says nothing', () => {
  // A preamble on every ordinary turn is noise in every prompt that never
  // needed it.
  assert.equal(missingFileEvidence([]), null)
  assert.equal(missingFileEvidence(['   ']), null)
})

test('🚨 a lost file is named, and substitution is forbidden', () => {
  const text = missingFileEvidence(['lease_summary.md'])
  assert.ok(text, 'a lost file produced no disclosure')
  assert.match(text, /lease_summary\.md/, 'the file was not named')
  assert.match(text, /no longer available/i, 'the model was not told to say it is gone')
  assert.match(text, /not answer about it from a different document/i, 'substitution was not forbidden')
})

test('the disclosure does NOT depend on the prompt naming the file', () => {
  /*
   * The load-bearing decision. "the lease document" does not match
   * `lease_summary.md` by stem or by spacing, so a disclosure gated on name
   * matching would have stayed silent on the exact case that produced the
   * defect. This function never sees the prompt, and that is deliberate.
   */
  assert.equal(missingFileEvidence.length, 1, 'the evidence must depend on the missing set alone')
})

test('several lost files are all named, deduplicated', () => {
  const text = missingFileEvidence(['a_report.pdf', 'b_notes.md', 'a_report.pdf'])
  assert.ok(text)
  assert.match(text, /a_report\.pdf/)
  assert.match(text, /b_notes\.md/)
  assert.equal(text.match(/a_report\.pdf/g)?.length, 1, 'a duplicate was listed twice')
})
