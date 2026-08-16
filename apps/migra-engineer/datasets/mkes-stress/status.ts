/**
 * MKES_STRESS readiness.
 *
 *   node --import tsx status.ts
 *
 * Reports what is present and what is missing, and refuses to imply the set can
 * score anything until its references exist.
 */

import { MANIFEST, awaitingTranscript, readyToEvaluateText, speechCases, unreviewedTakes } from './manifest.v1'
import { suspiciousDuplicates } from './recordings'

const pad = (s: string, n: number): string => s.padEnd(n)
const secs = (ms?: number): string => (ms === undefined ? '   —  ' : `${(ms / 1000).toFixed(1)}s`.padStart(6))

console.log(`\n${MANIFEST.suite} ${MANIFEST.version}   language=${MANIFEST.language}`)
console.log(`role: ${MANIFEST.datasetRole}   trainingEligible=false on every entry`)
console.log(`source (read-only): ${MANIFEST.sourceDirectory}\n`)

for (const entry of MANIFEST.entries) {
  const text = entry.kind === 'speech' ? entry.transcriptStatus : 'n/a (control)'
  console.log(`${pad(entry.id, 20)}${pad(text, 18)}${entry.purpose}`)
  for (const v of entry.variants) {
    console.log(`    ${pad(v.condition, 10)}${pad(v.status, 10)}${secs(v.durationMs)}  ${v.filename}`)
  }
}

const cases = speechCases()
const noText = awaitingTranscript()
const takes = MANIFEST.entries.flatMap((e) => e.variants)

console.log(`\nspeech cases:        ${cases.length}`)
console.log(`acoustic controls:   ${MANIFEST.entries.length - cases.length}`)
console.log(`recordings:          ${takes.filter((t) => t.status !== 'pending').length}/${takes.length} received`)
console.log(`transcripts:         ${cases.length - noText.length}/${cases.length} authored`)
console.log(`takes reviewed:      ${takes.length - unreviewedTakes().length}/${takes.length} by a human`)

const total = takes.reduce((sum, t) => sum + (t.durationMs ?? 0), 0)
console.log(`total audio:         ${(total / 1000 / 60).toFixed(1)} minutes`)

if (noText.length) {
  console.log(`\n⚠ ${noText.length} reference transcript(s) NOT SUPPLIED.`)
  console.log('  Ground truth for a held-out benchmark. Authored, never generated.')
  console.log('  Missing: ' + noText.map((c) => c.id).join(', '))
}

const dupes = suspiciousDuplicates()
if (dupes.length) {
  console.log('\n⚠ identical byte length AND duration across different takes:')
  for (const group of dupes) console.log('  ' + group.join('  ==  '))
  console.log('  Not necessarily wrong — two exports can genuinely match — but worth')
  console.log('  a human glance before the set is frozen, in case a take was exported')
  console.log('  from the wrong region.')
}

const control = MANIFEST.entries.find((e) => e.kind === 'acoustic-control')
if (control && control.kind === 'acoustic-control' && !control.expectation.confirmedByHuman) {
  console.log(`\n⚠ ${control.id} expectation is UNCONFIRMED.`)
  console.log('  Expected to contain no speech, but nobody has listened. The expected')
  console.log('  transcript stays null until someone does — asserting "empty" for an')
  console.log('  unheard file would be inventing the ground truth.')
}

console.log(`\ntext evaluation ready:     ${readyToEvaluateText() ? 'YES' : 'NO — references missing'}`)
console.log(`acoustic evaluation ready: NO — takes not yet reviewed or consent-validated\n`)
