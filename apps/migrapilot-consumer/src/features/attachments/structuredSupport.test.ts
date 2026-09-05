/**
 * The `structured` support level, and the capability questions that replaced a
 * single overloaded flag.
 *
 * 🚨 WHAT THIS PREVENTS. `.xlsx` sat at `unsupported` while a working table
 * reader for it existed, and the only alternative was `indexed` — which would
 * have claimed prose retrieval the Brain cannot do over a zip container. One
 * boolean was being asked two independent questions: can this be searched, and
 * can this be analysed. The tests below pin them apart.
 *
 * The failure being guarded is not "xlsx is rejected". It is a product that
 * accepts a workbook and then describes it to the user as though its text had
 * been read.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ATTACHABLE_EXTENSIONS,
  ATTACHMENT_TYPES,
  DOCUMENT_EXTENSIONS,
  DOCUMENT_PICKER_ACCEPT,
  INDEXED_EXTENSIONS,
  STRUCTURED_ONLY_EXTENSIONS,
  canAnalyzeStructurally,
  canAttach,
  canIndex,
  canUseForVision,
  refusalFor,
} from './capability'

describe('the four capability questions', () => {
  it('xlsx is analysable but NOT indexed', () => {
    assert.equal(canAttach('xlsx'), true, 'must be uploadable')
    assert.equal(canAnalyzeStructurally('xlsx'), true, 'must reach the table layer')
    assert.equal(canIndex('xlsx'), false, '🚨 must never claim prose retrieval')
    assert.equal(canUseForVision('xlsx'), false)
  })

  it('csv is BOTH indexed and analysable, which one flag could not express', () => {
    for (const ext of ['csv', 'tsv']) {
      assert.equal(canIndex(ext), true, ext)
      assert.equal(canAnalyzeStructurally(ext), true, ext)
    }
  })

  it('an indexed document is not automatically analysable', () => {
    for (const ext of ['pdf', 'docx', 'txt', 'md']) {
      assert.equal(canIndex(ext), true, ext)
      assert.equal(canAnalyzeStructurally(ext), false, `${ext} is not a table`)
    }
  })

  it('only images can be used for vision', () => {
    assert.equal(canUseForVision('png'), true)
    for (const ext of ['csv', 'xlsx', 'pdf', 'txt']) {
      assert.equal(canUseForVision(ext), false, ext)
    }
  })

  it('formats with no reader stay unattachable', () => {
    for (const ext of ['xls', 'ods', 'pptx', 'zip']) {
      assert.equal(canAttach(ext), false, ext)
      assert.equal(canAnalyzeStructurally(ext), false, ext)
    }
  })
})

describe('the derived lists cannot disagree with each other', () => {
  it('the picker offers exactly what can be attached', () => {
    for (const ext of ATTACHABLE_EXTENSIONS) {
      assert.ok(DOCUMENT_PICKER_ACCEPT.includes(`.${ext}`), `picker hides ${ext}`)
    }
    // The drift this file exists to end: offering a type the store refuses.
    for (const entry of DOCUMENT_PICKER_ACCEPT.split(',')) {
      const ext = entry.replace(/^\./, '')
      assert.equal(canAttach(ext), true, `picker offers ${ext}, which cannot be attached`)
    }
  })

  it('the document store accepts every attachable document-pipeline type', () => {
    assert.ok(DOCUMENT_EXTENSIONS.includes('xlsx'), 'store would refuse a file the picker offers')
    for (const ext of DOCUMENT_EXTENSIONS) {
      assert.equal(canAttach(ext), true, `store accepts ${ext}, which is not attachable`)
    }
  })

  it('structured-only is exactly the attachable-but-not-indexed set', () => {
    const expected = ATTACHABLE_EXTENSIONS.filter((e) => !canIndex(e)).sort()
    assert.deepEqual([...STRUCTURED_ONLY_EXTENSIONS].sort(), expected)
    assert.ok(STRUCTURED_ONLY_EXTENSIONS.includes('xlsx'))
    // And it must not have leaked into the indexed list.
    assert.ok(!INDEXED_EXTENSIONS.includes('xlsx'), '🚨 xlsx is being reported as indexed')
  })

  it('every non-unsupported type declares a pipeline', () => {
    for (const t of ATTACHMENT_TYPES) {
      if (t.support === 'unsupported') continue
      assert.ok(t.pipeline, `${t.ext} is accepted with no pipeline`)
    }
  })
})

describe('what the user is told', () => {
  it('the xlsx copy states the boundary instead of denying the capability', () => {
    const copy = refusalFor('budget.xlsx')
    assert.match(copy, /analys/i, copy)
    assert.match(copy, /tables|totals|columns|sheets/i, copy)
    // The old message claimed spreadsheet reading was not enabled at all. It is.
    assert.ok(!/not enabled yet/i.test(copy), `stale copy: ${copy}`)
    // And it must not imply search works.
    assert.match(copy, /not available yet|cannot|search/i, copy)
  })

  it('formats with genuinely no reader still point somewhere useful', () => {
    for (const name of ['old.xls', 'sheet.ods']) {
      const copy = refusalFor(name)
      assert.match(copy, /\.xlsx|CSV/i, `${name}: ${copy}`)
    }
  })

  it('never promises indexing for a structured file', () => {
    const copy = refusalFor('budget.xlsx').toLowerCase()
    for (const word of ['indexed', 'searchable', 'full-text']) {
      assert.ok(!copy.includes(word), `copy claims ${word}: ${copy}`)
    }
  })
})
