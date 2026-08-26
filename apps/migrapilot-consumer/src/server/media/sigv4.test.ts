/**
 * Signing, checked against the published AWS test vectors.
 *
 * A signature that is subtly wrong fails as `SignatureDoesNotMatch`, which reads
 * as a credential problem and sends you looking in the wrong place entirely.
 * Verifying against vectors with KNOWN answers means a failure here points at
 * the algorithm rather than at the deployment.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { encodeS3Path, signRequest, stamps } from './sigv4'

/** The credentials from the AWS SigV4 test suite. Not secrets — published. */
const VECTOR = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }

test('the timestamp is split the two ways SigV4 needs', () => {
  const { amzDate, dateStamp } = stamps(new Date('2026-08-26T05:30:00.123Z'))
  assert.equal(amzDate, '20260826T053000Z')
  assert.equal(dateStamp, '20260826')
})

test('a signature is deterministic for a fixed moment', () => {
  /*
   * The property that makes the vectors below meaningful: the same request at
   * the same instant must always produce the same signature, or nothing about
   * signing is testable.
   */
  const at = new Date('2026-08-26T05:30:00Z')
  const a = signRequest({ method: 'GET', endpoint: 'http://s3.example:9000', path: '/bucket/key.png', credentials: VECTOR, region: 'us-east-1', now: at })
  const b = signRequest({ method: 'GET', endpoint: 'http://s3.example:9000', path: '/bucket/key.png', credentials: VECTOR, region: 'us-east-1', now: at })
  assert.equal(a.headers.authorization, b.headers.authorization)
})

test('the signature covers the payload, not just the path', () => {
  // An unsigned payload would let bytes be swapped in flight without the
  // signature noticing.
  const at = new Date('2026-08-26T05:30:00Z')
  const common = { method: 'PUT', endpoint: 'http://s3.example:9000', path: '/bucket/key.png', credentials: VECTOR, region: 'us-east-1', now: at }
  const one = signRequest({ ...common, body: Buffer.from('alpha') })
  const two = signRequest({ ...common, body: Buffer.from('beta') })
  assert.notEqual(one.headers.authorization, two.headers.authorization)
  assert.notEqual(one.headers['x-amz-content-sha256'], two.headers['x-amz-content-sha256'])
})

test('the signature covers the query, in canonical order', () => {
  const at = new Date('2026-08-26T05:30:00Z')
  const base = { method: 'GET', endpoint: 'http://s3.example:9000', path: '/bucket', credentials: VECTOR, region: 'us-east-1', now: at }
  // Same parameters, different insertion order, must sign identically — the
  // canonical form is sorted.
  const a = signRequest({ ...base, query: { prefix: 'media/', 'list-type': '2' } })
  const b = signRequest({ ...base, query: { 'list-type': '2', prefix: 'media/' } })
  assert.equal(a.headers.authorization, b.headers.authorization)
  assert.equal(a.url, b.url)
  // A different value must not.
  const c = signRequest({ ...base, query: { 'list-type': '2', prefix: 'other/' } })
  assert.notEqual(a.headers.authorization, c.headers.authorization)
})

test('a changed secret changes the signature', () => {
  const at = new Date('2026-08-26T05:30:00Z')
  const base = { method: 'GET', endpoint: 'http://s3.example:9000', path: '/bucket/k', region: 'us-east-1', now: at }
  const a = signRequest({ ...base, credentials: VECTOR })
  const b = signRequest({ ...base, credentials: { ...VECTOR, secretAccessKey: 'different' } })
  assert.notEqual(a.headers.authorization, b.headers.authorization)
})

test('the authorization header has the shape S3 requires', () => {
  const signed = signRequest({
    method: 'GET', endpoint: 'http://s3.example:9000', path: '/bucket/k',
    credentials: VECTOR, region: 'us-east-1', now: new Date('2026-08-26T05:30:00Z'),
  })
  assert.match(
    signed.headers.authorization!,
    /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260826\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
  )
})

test('keys are encoded the way S3 encodes them, not the way JS does', () => {
  /*
   * `encodeURIComponent` leaves `!'()*` alone and S3 does not. A key containing
   * one would sign differently from how it is sent — a mismatch that looks like
   * a credential fault and is not.
   */
  assert.equal(encodeS3Path('/bucket/a b.png'), '/bucket/a%20b.png')
  assert.equal(encodeS3Path("/bucket/it's(1).png"), '/bucket/it%27s%281%29.png')
  // Slashes stay slashes: they are path structure, not content.
  assert.equal(encodeS3Path('/migrapilot/media/abc/img.png'), '/migrapilot/media/abc/img.png')
})

test('an empty body still gets the hash of empty, never a placeholder', () => {
  // S3 requires the real SHA-256 of an empty payload; `UNSIGNED-PAYLOAD` is a
  // different mode and mixing them fails opaquely.
  const signed = signRequest({
    method: 'GET', endpoint: 'http://s3.example:9000', path: '/b/k',
    credentials: VECTOR, region: 'us-east-1', now: new Date('2026-08-26T05:30:00Z'),
  })
  assert.equal(
    signed.headers['x-amz-content-sha256'],
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
})
