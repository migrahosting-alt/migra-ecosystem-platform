import 'server-only'

import { createHash, createHmac } from 'node:crypto'

/**
 * AWS Signature Version 4, for S3-compatible storage.
 *
 * WHY HAND-ROLLED. MigraPilot uses five S3 operations — GET, PUT, DELETE, HEAD
 * and list — against one bucket. `@aws-sdk/client-s3` would bring roughly fifty
 * packages and a large bundle to sign those, and every one of them is supply
 * chain this product then owns. The signing algorithm is small, fully specified,
 * and verifiable against the published AWS test vectors, which is what the tests
 * beside this file do.
 *
 * IT SIGNS, AND NOTHING ELSE. No retries, no endpoint discovery, no credential
 * chain — those belong to the caller, where their behaviour is visible.
 */

export interface Credentials {
  accessKeyId: string
  secretAccessKey: string
}

const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest()

/** `20260826T053000Z` and `20260826`, which SigV4 needs separately. */
export function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { amzDate, dateStamp: amzDate.slice(0, 8) }
}

/**
 * Percent-encode a path segment the way S3 expects.
 *
 * `encodeURIComponent` leaves `!'()*` alone and S3 does not, so a key containing
 * one would sign differently from how it is sent — a signature mismatch that
 * looks like a credential problem and is not.
 */
export function encodeS3Path(path: string): string {
  return path
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join('/')
}

export interface SignedRequest {
  method: string
  /** Absolute URL, already encoded. */
  url: string
  headers: Record<string, string>
}

export function signRequest(options: {
  method: string
  endpoint: string
  path: string
  query?: Record<string, string>
  body?: Buffer
  credentials: Credentials
  region: string
  service?: string
  now?: Date
}): SignedRequest {
  const service = options.service ?? 's3'
  const now = options.now ?? new Date()
  const { amzDate, dateStamp } = stamps(now)

  const endpoint = new URL(options.endpoint)
  const canonicalUri = encodeS3Path(options.path.startsWith('/') ? options.path : `/${options.path}`)

  // Query parameters are sorted by key, and each is encoded — S3 signs the
  // canonical form, not whatever order the caller happened to build.
  const query = options.query ?? {}
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key]!)}`)
    .join('&')

  const payloadHash = sha256Hex(options.body ?? Buffer.alloc(0))
  const host = endpoint.host

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }

  const signedHeaderNames = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort()
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]!.trim()}\n`).join('')
  const signedHeaders = signedHeaderNames.join(';')

  const canonicalRequest = [
    options.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${options.region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${options.credentials.secretAccessKey}`, dateStamp), options.region), service),
    'aws4_request',
  )
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${options.credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const url = `${endpoint.origin}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`
  return { method: options.method, url, headers }
}
