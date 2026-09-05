/**
 * The production Case 10 failure, pinned.
 *
 * 🚨 THE EXACT TURN THAT FAILED. Attached `matrix_sales.xlsx`, asked
 * "Summarize the document for me.", and the product replied "I cannot summarize
 * a document as no document was provided" — false, about a file whose chip was
 * on screen.
 *
 * It passed every local run because the decision was gated on
 * `assessDocumentIntent(prompt, grounded)`, and that helper goes quiet the
 * moment an account owns an approved index. Every real account has one; no fresh
 * test account does. The local rig cannot even build one — the Brain indexes
 * from its own filesystem and cannot see a local upload root — so no amount of
 * local UI testing could have produced the production state.
 *
 * These tests therefore assert the DECISION with the index state that only
 * production has, which is the one thing the browser harness could not reach.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { asksOfDocument, decideAttachmentState, structuredOnly } from './attachmentState'

const XLSX = ['matrix_sales.xlsx']

describe('the exact production failure', () => {
  it('"Summarize the document for me." over an .xlsx is structured_only', () => {
    const state = decideAttachmentState({
      prompt: 'Summarize the document for me.',
      activeFiles: XLSX,
    })
    assert.equal(state.kind, 'structured_only', JSON.stringify(state))
    assert.deepEqual(state.kind === 'structured_only' ? state.files : [], XLSX)
  })

  it('stays structured_only however the account is indexed', () => {
    /*
     * The decision takes no index state at all, which is the fix. Previously the
     * caller passed `grounded` into the intent helper and an indexed account
     * silently skipped this branch.
     */
    for (const prompt of [
      'Summarize the document for me.',
      'Summarise this document.',
      'What does the file say?',
      'Summarise the written commentary and narrative paragraphs inside this document.',
      'Tell me what my spreadsheet contains',
    ]) {
      const state = decideAttachmentState({ prompt, activeFiles: XLSX })
      assert.equal(state.kind, 'structured_only', `${prompt} -> ${JSON.stringify(state)}`)
    }
  })

  it('a TABLE question is answered, never refused', () => {
    // The opposite failure, also seen in production: a total refused as prose.
    const state = decideAttachmentState({
      prompt: 'What is the total Revenue?',
      activeFiles: XLSX,
      hasTableEvidence: true,
    })
    assert.equal(state.kind, 'indexed', JSON.stringify(state))
  })

  it('computed figures outrank every refusal', () => {
    // Even a prose-shaped prompt: if the deterministic layer produced numbers,
    // the question was answerable and nothing may speak over them.
    const state = decideAttachmentState({
      prompt: 'Summarize the document for me.',
      activeFiles: XLSX,
      hasTableEvidence: true,
    })
    assert.equal(state.kind, 'indexed')
  })
})

describe('the four states stay distinct', () => {
  it('absent — asks of a document, nothing attached', () => {
    const state = decideAttachmentState({ prompt: 'Summarize the document for me.', activeFiles: [] })
    assert.equal(state.kind, 'absent')
  })

  it('absent does NOT fire for a question that is not about a file', () => {
    for (const prompt of ['How do I write a runbook?', 'What is a spreadsheet?', 'hello', 'here']) {
      const state = decideAttachmentState({ prompt, activeFiles: [] })
      assert.equal(state.kind, 'indexed', `${prompt} -> ${JSON.stringify(state)}`)
    }
  })

  it('indexed — a real document is attached', () => {
    const state = decideAttachmentState({
      prompt: 'Summarize the document for me.',
      activeFiles: ['report.pdf'],
    })
    assert.equal(state.kind, 'indexed')
  })

  it('structured_only — every attachment is table-only', () => {
    const state = decideAttachmentState({
      prompt: 'Summarize the document for me.',
      activeFiles: ['a.xlsx', 'b.xlsx'],
    })
    assert.equal(state.kind, 'structured_only')
  })

  it('a MIXED set is not structured_only — the pdf can still answer', () => {
    const state = decideAttachmentState({
      prompt: 'Summarize the document for me.',
      activeFiles: ['matrix_sales.xlsx', 'report.pdf'],
    })
    assert.equal(state.kind, 'indexed', JSON.stringify(state))
  })

  it('unreadable — attached, indexable, and holding nothing', () => {
    const state = decideAttachmentState({
      prompt: 'Summarize the document for me.',
      activeFiles: ['empty.txt'],
      unreadableFiles: ['empty.txt'],
    })
    assert.equal(state.kind, 'unreadable')
  })

  it('a CSV is indexed, not structured_only — it is both', () => {
    // csv is analysable AND retrievable, so a prose question about one is fine.
    const state = decideAttachmentState({
      prompt: 'Summarize the document for me.',
      activeFiles: ['sales.csv'],
    })
    assert.equal(state.kind, 'indexed', JSON.stringify(state))
  })
})

describe('the helpers', () => {
  it('asksOfDocument reads the question, not the library', () => {
    assert.equal(asksOfDocument('Summarize the document for me.'), true)
    assert.equal(asksOfDocument('What is the total Revenue?'), false)
    assert.equal(asksOfDocument('here'), false)
    assert.equal(asksOfDocument('How do I write a runbook?'), false)
  })

  it('structuredOnly selects table-only files', () => {
    assert.deepEqual(structuredOnly(['a.xlsx', 'b.pdf', 'c.csv', 'd.xlsx']), ['a.xlsx', 'd.xlsx'])
  })
})
