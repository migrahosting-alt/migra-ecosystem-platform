/**
 * MKES_STRESS readiness.
 *
 *   node --import tsx status.ts
 *
 * Reports exactly what is present and what is missing, and refuses to imply the
 * set can score anything until its references exist.
 */

import { MANIFEST, awaitingAudio, awaitingTranscript, readyToEvaluateText } from './manifest.v1'

const pad = (s: string, n: number): string => s.padEnd(n)

console.log(`\n${MANIFEST.suite} ${MANIFEST.version}   language=${MANIFEST.language}`)
console.log(`role: ${MANIFEST.datasetRole}  (trainingEligible=false on every item)\n`)

console.log(pad('ID', 20) + pad('TEXT', 18) + pad('AUDIO', 12) + 'FOCUS')
for (const i of MANIFEST.items) {
  console.log(
    pad(i.id, 20) + pad(i.transcriptStatus, 18) + pad(i.audio.status, 12) + i.purpose,
  )
}

const noText = awaitingTranscript()
const noAudio = awaitingAudio()

console.log(`\ntranscripts present: ${MANIFEST.items.length - noText.length}/${MANIFEST.items.length}`)
console.log(`recordings present:  ${MANIFEST.items.length - noAudio.length}/${MANIFEST.items.length}`)

if (noText.length) {
  console.log(`\n⚠ ${noText.length} reference transcript(s) NOT SUPPLIED.`)
  console.log('  These slots are prepared and deliberately empty. They are the ground')
  console.log('  truth for a held-out benchmark and must be authored, never generated.')
  console.log('  Missing: ' + noText.map((i) => i.id).join(', '))
}

if (noAudio.length) {
  console.log(`\n⏳ ${noAudio.length} recording(s) pending. Expected filenames:`)
  for (const i of noAudio) console.log(`  ${pad(i.id, 20)} ${i.audio.filename}`)
}

console.log(
  `\ntext evaluation ready: ${readyToEvaluateText() ? 'YES' : 'NO — references missing'}`,
)
console.log('acoustic evaluation ready: NO — pending audio\n')
