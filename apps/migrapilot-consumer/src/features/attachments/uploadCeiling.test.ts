import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, attachmentCapability } from './capability'
import { isPermanentRejection, outcomeOfIndex, outcomeOfUpload } from './outcome'
import { rejectionFor } from './filename'

/**
 * The upload ceiling, and the promise that every layer means the same thing by it.
 *
 * 🚨 THE DEFECT THESE GUARD. The app advertised 1024 MB while nginx refused
 * anything over 32 MB, so an oversized file died at a hop the app could not see
 * and was reported as a network fault. The cure is one constant that everything
 * derives from — and tests that fail if a second number reappears anywhere.
 */

const source = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

test('one constant governs the ceiling, and storage derives from it', () => {
  const storage = source('src/server/files/storage.ts')

  // The literal must not come back. A hand-written number here is exactly how
  // the client and the server drifted apart the first time.
  assert.match(storage, /MAX_FILE_BYTES = megabytes\(process\.env\.MIGRAPILOT_MAX_FILE_MB, MAX_UPLOAD_MB\)/,
    'storage must take its ceiling from the capability contract')
  assert.match(storage, /import \{[^}]*MAX_UPLOAD_MB[^}]*\} from '@\/features\/attachments\/capability'/)
})

test('the ceiling the API advertises is the ceiling the contract defines', () => {
  assert.equal(attachmentCapability().maxUploadBytes, MAX_UPLOAD_BYTES)
  assert.equal(MAX_UPLOAD_BYTES, MAX_UPLOAD_MB * 1024 * 1024)
})

/*
 * 🚨 THE PROXY IS THE NARROWEST HOP, AND THIS IS THE ONE FACT THE APP CANNOT
 * CHECK AT RUNTIME. If `client_max_body_size` on VM102 is ever lowered below
 * this constant, uploads between the two numbers will 413 at the proxy and the
 * app will have promised something the transport will not carry. The value is
 * asserted here so that changing it is a deliberate act with a visible
 * counterpart in the nginx config, recorded in docs/migrapilot/large-media-uploads.md.
 */
test('the declared ceiling matches what the proxy is configured to carry', () => {
  assert.equal(MAX_UPLOAD_MB, 256,
    'raising this requires raising client_max_body_size on VM102 FIRST')
})

test('a file over the ceiling is refused in the browser, naming both sizes', () => {
  const limits = { allowedExtensions: ['pdf'], maxFileBytes: MAX_UPLOAD_BYTES }
  const rejection = rejectionFor({ name: 'huge.pdf', size: MAX_UPLOAD_BYTES + 1 }, limits)

  assert.equal(rejection?.code, 'too_large')
  // Both numbers, because "limited to 256 MB" alone does not tell the user
  // whether their file is over by a little or by tenfold.
  assert.match(rejection!.message, /300 MB|257 MB|\d+ MB\. Files are limited to 256 MB\./)
  assert.match(rejection!.message, /Files are limited to 256 MB\./)
})

test('a file at exactly the ceiling is accepted by the client pre-check', () => {
  const limits = { allowedExtensions: ['pdf'], maxFileBytes: MAX_UPLOAD_BYTES }
  assert.equal(rejectionFor({ name: 'exact.pdf', size: MAX_UPLOAD_BYTES }, limits), null,
    'the limit is inclusive; one byte over is what fails')
  assert.notEqual(rejectionFor({ name: 'over.pdf', size: MAX_UPLOAD_BYTES + 1 }, limits), null)
})

/*
 * 🚨 RETRY MUST NOT BE OFFERED FOR BYTES THAT CANNOT PASS.
 *
 * Every failed chip used to carry Retry. A file rejected for being too large was
 * therefore invited to send identical bytes at an unchanged limit — it could only
 * fail again, and the button crowded out the action that would actually help.
 */
test('failures the same bytes can never survive are terminal', () => {
  for (const code of ['too_large', 'unsupported_type', 'empty_file']) {
    assert.equal(isPermanentRejection(code), true, `${code} must not offer Retry`)
    const outcome = outcomeOfUpload({ rejected: [{ name: 'f.pdf', error: code, message: 'nope' }] })
    assert.equal(outcome.state, 'failed')
    assert.equal('retryable' in outcome && outcome.retryable, false)
  }
})

test('failures that describe a moment stay retryable', () => {
  // A full library or a failed write may genuinely succeed on another attempt —
  // the first after deleting files, the second after the moment passes.
  for (const code of ['library_full', 'too_many', 'write_failed']) {
    assert.equal(isPermanentRejection(code), false, `${code} may be retried`)
    const outcome = outcomeOfUpload({ rejected: [{ name: 'f.pdf', error: code, message: 'nope' }] })
    assert.equal('retryable' in outcome && outcome.retryable, true)
  }

  // An unknown code from a newer server must not be assumed terminal: silently
  // withholding Retry is the worse failure of the two.
  assert.equal(isPermanentRejection('something_new'), false)
  assert.equal(isPermanentRejection(undefined), false)
})

test('the chip hides Retry only when the failure is terminal', () => {
  const chips = source('src/features/attachments/AttachmentChips.tsx')

  // `!== false`, never `=== true` — an attachment that predates the field must
  // keep its button rather than silently lose it.
  assert.match(chips, /bad && attachment\.retryable !== false && \(/)
  assert.match(chips, /bad && attachment\.retryable === false && onChooseAnother && \(/)
  assert.match(chips, /Choose another file/)
})

test('the hook refuses a retry the UI would not have offered', () => {
  const hook = source('src/features/attachments/useAttachments.ts')
  assert.match(hook, /attachment\.retryable === false\) return/,
    'hiding the button is presentation; the rule must also live in the hook')
})

/*
 * 🚨 "TOO LARGE TO PARSE" IS NOT "NOTHING TO READ".
 *
 * A file above the extraction ceiling is absent from `chunkCounts`, which the
 * client read as zero chunks and explained as "No readable content was found" —
 * false for a 100 MB PDF dense with text. Raising transport to 256 MB turns this
 * band from a few megabytes wide into most of what can be uploaded.
 */
test('a file too large to parse is told so, not told it was empty', () => {
  const outcome = outcomeOfIndex(
    true,
    { searchable: true, chunkCounts: {}, tooLargeToProcess: ['big.pdf'] },
    'big.pdf',
  )
  assert.equal(outcome.state, 'unsearchable')
  assert.match((outcome as { reason: string }).reason, /too large for MigraPilot to read/)
  assert.doesNotMatch((outcome as { reason: string }).reason, /No readable content/)
})

test('a genuinely empty file still says so', () => {
  const outcome = outcomeOfIndex(
    true,
    { searchable: true, chunkCounts: {}, tooLargeToProcess: [] },
    'blank.txt',
  )
  assert.equal(outcome.state, 'unsearchable')
  assert.match((outcome as { reason: string }).reason, /No readable content/)
})

test('a large PDF is sent to the background reader, not skipped', () => {
  const route = source('src/app/api/files/index/route.ts')

  /*
   * 🚨 THE LINE THAT MADE A 35.5 MB PDF A DEAD OBJECT.
   *
   * `if (file.tooLargeToProcess) continue` sat in the escalation loop, so a
   * document above the SYNCHRONOUS parser's ceiling was never handed to the
   * background reader that could have read it a page at a time. The ceiling
   * protects the in-request parser; it was never a claim that the file is
   * unreadable.
   */
  const loop = route.slice(route.indexOf('for (const file of library)'))
  const body = loop.slice(0, loop.indexOf('\n  }') + 4)
  assert.doesNotMatch(body, /tooLargeToProcess\) continue/,
    'size must no longer exclude a PDF from background reading')
  assert.match(body, /requestProcessing\(/, 'oversized PDFs are enqueued for the background reader')
})

test('"too large to read" is not said about a file being read', () => {
  const route = source('src/app/api/files/index/route.ts')
  // PDFs have a background reader, so they are never reported as unreadable for
  // size; anything currently in a job is excluded too, whatever its type.
  assert.match(route, /\.filter\(\(file\) => file\.tooLargeToProcess && !\/\\\.pdf\$\/i\.test\(file\.name\) && !processing\.has\(file\.name\)\)/)
  assert.match(route, /\n    tooLargeToProcess,/, 'and returns it to the client')
  assert.match(route, /\n    processing: \[\.\.\.processing\],/, 'along with what is actively being read')
})

test('being read beats every other explanation for having no chunks', () => {
  // A document in a job has no chunks yet, which is indistinguishable from one
  // that yielded nothing — and the wrong reading tells the user to give up on a
  // file that is minutes from working.
  const outcome = outcomeOfIndex(
    true,
    { searchable: true, chunkCounts: {}, tooLargeToProcess: ['big.pdf'], processing: ['big.pdf'] },
    'big.pdf',
  )
  assert.equal(outcome.state, 'processing')
  assert.match((outcome as { reason: string }).reason, /Reading this document/)
})
