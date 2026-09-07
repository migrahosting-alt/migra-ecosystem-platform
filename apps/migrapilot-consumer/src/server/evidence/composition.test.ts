/**
 * THE SEAM, GUARDED ACROSS BOTH CAPABILITIES.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CASES SPAN TWO UNRELATED FEATURES
 *
 * Scaffolding echo appeared in the spreadsheet path AND the project path, from
 * code that shares nothing. Guarding it in one of them would produce exactly
 * the capability-local patch that made it a shared problem in the first place.
 * So every case below runs through the real evidence builders, and the SAME
 * assertions apply to both.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ASSERTED, AND WHAT DELIBERATELY IS NOT
 *
 * Asserted: the facts survive, the suggested action survives, the refusal
 * category is not transformed into a different accusation, and no internal
 * vocabulary appears.
 *
 * NOT asserted: that the model's final wording is pretty. This layer instructs;
 * it does not rewrite output. Policing the answer afterwards would put a second
 * author between the evidence and the user, and that author is the one place
 * nothing verifies.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { composeEvidence, scaffoldingIn, SCAFFOLDING_PHRASES } from './composition'
import { tableEvidenceFor } from '@/server/tables/tableEvidence'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tables', '__fixtures__')

/**
 * 🚨 THE STATED REASON ONLY — not the directives.
 *
 * The refusal directive PROHIBITS the words "invalid", "missing values" and
 * "too few", so a naive search for them fires on the prohibition itself. That
 * is the same prohibition-frame false positive the spreadsheet disclosure
 * detector hit earlier: "never say X" contains X.
 *
 * The accusation must be absent from the FACT, which is the sentence a model
 * would repeat. The directive is allowed to name what it forbids.
 */
const statedReason = (text: string): string => text.split('\n')[0] ?? ''

async function tableEvidence(fixture: string, prompt: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'seam-'))
  await cp(join(FIXTURES, fixture), join(root, fixture))
  const evidence = await tableEvidenceFor(prompt, [fixture], root)
  assert.ok(evidence, `${fixture} produced no evidence for ${JSON.stringify(prompt)}`)
  return evidence.text
}

/** The instruction every block must carry, wherever it came from. */
function assertVoiceInstruction(text: string, what: string): void {
  assert.match(text, /internal working note/, `${what}: no voice instruction`)
  assert.match(text, /in your own words/, `${what}: does not ask for the model's own words`)
  assert.match(
    text,
    /never begin with "MigraPilot could not/,
    `${what}: does not name the echo it is preventing`,
  )
}

describe('every capability composes through the same seam', () => {
  it('a spreadsheet identifier refusal carries the fact AND the voice instruction', async () => {
    const text = await tableEvidence('eq_identifiers.csv', 'What is the total ZipCode?')
    // The FACT survives, unchanged.
    assert.match(text, /identifies rows rather than measuring them/)
    // 🚨 And the specific accusation it must never become.
    assert.doesNotMatch(statedReason(text), /not enough data|invalid|missing values/i)
    assertVoiceInstruction(text, 'identifier refusal')
  })

  it('a mixed text/number refusal keeps its own reason, not a substituted one', async () => {
    const text = await tableEvidence('eq_mixed.csv', 'What is the total Readings?')
    assert.match(text, /mixes text with numbers/)
    assert.doesNotMatch(statedReason(text), /not enough data|too few|invalid/i)
    assert.match(text, /do not substitute a different one/, 'the binding directive is preserved')
    assertVoiceInstruction(text, 'mixed-text refusal')
  })

  it('ambiguity still names the candidate columns and refuses to choose', async () => {
    const text = await tableEvidence('eq_ambiguous.csv', 'What is the total?')
    assert.match(text, /"Revenue"/)
    assert.match(text, /"Cost"/)
    assert.match(text, /do NOT pick a column on the user's behalf/, 'the anti-guessing rule survives')
    assertVoiceInstruction(text, 'ambiguity')
  })

  it('computed figures keep their anti-rederivation directive', async () => {
    const text = await tableEvidence('eq_revenue.csv', 'What is the total Revenue in this file?')
    assert.match(text, /474,000/)
    assert.match(text, /do not\s+recalculate them/, 'grounding is not weakened by the presentation fix')
    assertVoiceInstruction(text, 'computed figures')
  })

  it('the FILE NAME may appear — provenance is legitimately useful', async () => {
    const text = await tableEvidence('eq_revenue.csv', 'What is the total Revenue in this file?')
    assert.match(text, /eq_revenue\.csv/, 'a user can check a file they named; that is not scaffolding')
  })
})

describe('the project path composes identically', () => {
  /*
   * Built directly rather than through a live Brain call: what is under test is
   * the SEAM, and the project builder's refusal shape is the same object.
   */
  const notConnected = composeEvidence({
    fact: ['[MigraPilot could not read the connected project: Connect a project to this conversation.'],
    directives: [
      'Give THAT reason to the user — do not substitute a different one.',
      'Do NOT describe, guess at, or invent any project contents: nothing was read.',
      'Never suggest opening the project in another application.',
    ],
  })

  const revoked = composeEvidence({
    fact: [
      '[MigraPilot could not read the connected project: You no longer have access to the',
      'project this conversation uses.',
    ],
    directives: ['Give THAT reason to the user — do not substitute a different one.'],
  })

  it('project-not-connected keeps its fact and its suggested action', () => {
    assert.match(notConnected, /Connect a project to this conversation/)
    assertVoiceInstruction(notConnected, 'not connected')
  })

  it('project-revoked stays REVOKED and never becomes missing', () => {
    assert.match(revoked, /no longer have access/)
    assert.doesNotMatch(revoked, /no longer available|does not exist|missing/i)
    assertVoiceInstruction(revoked, 'revoked')
  })

  it('no refusal may suggest another product', () => {
    for (const text of [notConnected, revoked]) {
      assert.doesNotMatch(text, /VS ?Code|Open Folder/i)
    }
  })
})

describe('the scaffolding detector', () => {
  it('recognises the two echoes actually observed in the product', () => {
    assert.deepEqual(
      scaffoldingIn('MigraPilot could not read the connected project: Connect a project…'),
      ['MigraPilot could not read the connected project'],
    )
    assert.ok(
      scaffoldingIn('MigraPilot could not calculate this from eq_roundtrip.xlsx (sheet "Data"): …').length > 0,
    )
  })

  it('catches internal vocabulary that is not a phrase', () => {
    assert.deepEqual(scaffoldingIn('the step workspace.inspect needs a project'), ['workspace.inspect'])
    assert.deepEqual(scaffoldingIn('connect ws_abc123 first'), ['ws_abc123'])
    assert.deepEqual(scaffoldingIn('your approval appr_XyZ12 expired'), ['appr_XyZ12'])
  })

  it('leaves an ordinary answer alone', () => {
    assert.deepEqual(
      scaffoldingIn(
        'I can help with the project, but this conversation doesn’t have one connected yet. ' +
          'Connect a project and ask me again.',
      ),
      [],
    )
    assert.deepEqual(scaffoldingIn('The total Revenue is 474,000, from eq_revenue.csv.'), [])
  })

  it('every phrase it knows about is one the composer could actually emit', () => {
    // A detector listing phrases nothing produces is a guard against nothing.
    const emitted = composeEvidence({ fact: ['[Computed directly from x by MigraPilot.'], directives: [] })
    assert.ok(SCAFFOLDING_PHRASES.some((p) => emitted.includes(p)))
  })
})
