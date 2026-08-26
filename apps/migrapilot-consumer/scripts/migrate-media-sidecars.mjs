#!/usr/bin/env node
/**
 * Migrate `<id>.meta.json` sidecars into object storage.
 *
 * WHY THIS EXISTS. The first media migration moved image BYTES and nothing
 * else. Object storage held seven `.png` files and zero sidecars, so every
 * metadata read fell back to local disk — invisible while local was still
 * authoritative, and a split-brain the moment writes cut over: pictures would
 * still render while provenance, dimensions, MIME and origin silently vanished.
 * An artifact is not portable until its record travels with its bytes.
 *
 * PLAIN JAVASCRIPT, on purpose: this runs on the production host against the
 * live service environment, where `tsx` is not installed and adding a
 * toolchain to perform a migration would be its own risk.
 *
 * Idempotent. An artifact whose sidecar is already present AND hash-identical
 * is counted as verified and skipped, so a resumed or repeated run is safe.
 */

import { createHash, createHmac } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import http from 'node:http'
import https from 'node:https'

const DRY_RUN = process.argv.includes('--dry-run')

const env = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required but not set.`)
  return value
}

const IMAGE_ROOT = process.env.IMAGE_ROOT ?? '/var/lib/migrapilot/images'
const ENDPOINT = env('MIGRAPILOT_MEDIA_ENDPOINT')
const BUCKET = env('MIGRAPILOT_MEDIA_BUCKET')
const PREFIX = process.env.MIGRAPILOT_MEDIA_PREFIX ?? 'migrapilot/media'
const REGION = process.env.MIGRAPILOT_MEDIA_REGION ?? 'us-east-1'
const ACCESS_KEY = env('MIGRAPILOT_MEDIA_ACCESS_KEY')
const SECRET_KEY = env('MIGRAPILOT_MEDIA_SECRET_KEY')
const BRAIN_BASE_URL = process.env.BRAIN_BASE_URL ?? 'http://127.0.0.1:3988'

/*
 * A SEPARATE destination from the image bytes.
 *
 * The ledger is unique on (scope, artifact_id, destination_provider), and the
 * sidecar is a different object with a different hash reaching a different key.
 * Recording it under the same destination as the `.png` would overwrite the
 * bytes' proof with the metadata's — one row claiming to attest two objects,
 * and no way to answer "did the metadata actually make it?".
 */
const BYTES_DESTINATION = 'minio:migrapilot-artifacts'
const META_DESTINATION = `${BYTES_DESTINATION}:meta`

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
const hmac = (key, value) => createHmac('sha256', key).update(value).digest()

/** `encodeURIComponent` leaves `!'()*` alone; S3 expects them encoded. */
const encodePath = (path) =>
  path.split('/').map((segment) =>
    encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
  ).join('/')

function signedRequest(method, key, body) {
  const url = new URL(`${ENDPOINT}/${BUCKET}/${encodePath(key)}`)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256(body ?? Buffer.alloc(0))
  const host = url.host

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [
    method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${REGION}/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(Buffer.from(canonicalRequest))].join('\n')
  let signingKey = hmac(`AWS4${SECRET_KEY}`, dateStamp)
  for (const part of [REGION, 's3', 'aws4_request']) signingKey = hmac(signingKey, part)
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex')

  return {
    url,
    headers: {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      ...(body ? { 'content-length': String(body.length), 'content-type': 'application/json' } : {}),
    },
  }
}

function send(method, key, body) {
  const { url, headers } = signedRequest(method, key, body)
  const agent = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const request = agent.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method, headers, timeout: 30_000 },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }))
      },
    )
    request.on('timeout', () => request.destroy(new Error('timed out')))
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

/**
 * Record the proof in the durable ledger.
 *
 * Postgres is the authority; the object copy is evidence only. This is written
 * AFTER the read-back verification, never before — a ledger entry that runs
 * ahead of the thing it attests is not a record, it is a guess.
 */
async function recordInLedger(ownerScope, artifactId, entry) {
  if (!ownerScope) return { ok: false, detail: 'sidecar carries no ownerScope' }
  const response = await fetch(
    `${BRAIN_BASE_URL}/api/ai/media/migrations/${encodeURIComponent(artifactId)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-owner-scope': ownerScope },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(15_000),
    },
  )
  const payload = await response.json().catch(() => ({}))
  return { ok: response.ok && payload.ok === true, detail: JSON.stringify(payload).slice(0, 160) }
}

async function main() {
  const scopes = await readdir(IMAGE_ROOT, { withFileTypes: true })
  const results = { verified: 0, copied: 0, skipped: 0, failed: 0 }
  const failures = []

  for (const scopeDir of scopes) {
    if (!scopeDir.isDirectory()) continue
    const scope = scopeDir.name
    const entries = await readdir(join(IMAGE_ROOT, scope))

    for (const entry of entries) {
      if (!entry.endsWith('.meta.json')) continue
      const artifactId = entry.slice(0, -'.meta.json'.length)
      const localPath = join(IMAGE_ROOT, scope, entry)
      const local = await readFile(localPath)
      const localHash = sha256(local)

      /*
       * THE SCOPE IS RE-DERIVED AND CHECKED, never trusted from the path.
       * A content-addressed id is not globally unique once ownership is part of
       * the storage identity — migrating one scope while reading another is
       * exactly how an earlier migration produced a false proof.
       */
      let record
      try {
        record = JSON.parse(local.toString('utf8'))
      } catch (error) {
        failures.push(`${scope}/${artifactId}: sidecar is not valid JSON (${error.message})`)
        results.failed += 1
        continue
      }
      if (record.ownerScope) {
        const derived = sha256(Buffer.from(record.ownerScope)).slice(0, 32)
        if (derived !== scope) {
          failures.push(`${scope}/${artifactId}: ownerScope hashes to ${derived}, not the directory it sits in`)
          results.failed += 1
          continue
        }
      }
      if (record.id !== artifactId) {
        failures.push(`${scope}/${artifactId}: sidecar claims id ${record.id}`)
        results.failed += 1
        continue
      }

      const key = `${PREFIX}/${scope}/${entry}`

      const ledgerEntry = (at) => ({
        sourceProvider: 'local-filesystem',
        sourceKey: `${scope}/${entry}`,
        destinationProvider: META_DESTINATION,
        destinationKey: key,
        expectedHash: localHash,
        verifiedHash: localHash,
        status: 'verified',
        copiedAt: at,
        verifiedAt: at,
      })

      const existing = await send('GET', key)
      if (existing.status === 200 && sha256(existing.body) === localHash) {
        results.verified += 1
        if (!DRY_RUN) {
          const led = await recordInLedger(record.ownerScope, artifactId, ledgerEntry(Date.now()))
          if (!led.ok) {
            failures.push(`${scope}/${artifactId}: ledger write failed — ${led.detail}`)
            results.failed += 1
            continue
          }
        }
        console.log(`  already verified  ${scope}/${artifactId}`)
        continue
      }

      if (DRY_RUN) {
        results.skipped += 1
        console.log(`  would copy        ${scope}/${artifactId}`)
        continue
      }

      const put = await send('PUT', key, local)
      if (put.status !== 200 && put.status !== 204) {
        failures.push(`${scope}/${artifactId}: PUT returned ${put.status}`)
        results.failed += 1
        continue
      }

      // Read back from the SERVER and re-hash. A successful PUT is not proof
      // that the bytes now readable are the bytes that were sent.
      const readBack = await send('GET', key)
      if (readBack.status !== 200) {
        failures.push(`${scope}/${artifactId}: readback returned ${readBack.status}`)
        results.failed += 1
        continue
      }
      const readBackHash = sha256(readBack.body)
      if (readBackHash !== localHash) {
        failures.push(`${scope}/${artifactId}: hash mismatch ${readBackHash} != ${localHash}`)
        results.failed += 1
        continue
      }

      // And the CONTENT, not only the digest: the fields that would silently
      // vanish are the point of the exercise.
      const round = JSON.parse(readBack.body.toString('utf8'))
      for (const field of ['id', 'mime', 'bytes', 'width', 'height', 'sha256', 'ownerScope']) {
        if (JSON.stringify(round[field]) !== JSON.stringify(record[field])) {
          failures.push(`${scope}/${artifactId}: field ${field} did not survive the round trip`)
          results.failed += 1
        }
      }

      const led = await recordInLedger(record.ownerScope, artifactId, ledgerEntry(Date.now()))
      if (!led.ok) {
        failures.push(`${scope}/${artifactId}: ledger write failed — ${led.detail}`)
        results.failed += 1
        continue
      }

      results.copied += 1
      console.log(`  copied + verified + recorded ${scope}/${artifactId}  ${localHash.slice(0, 16)}`)
    }
  }

  console.log(
    `\ncopied=${results.copied} already-verified=${results.verified} ` +
    `would-copy=${results.skipped} failed=${results.failed}`,
  )
  for (const failure of failures) console.error(`  FAILED ${failure}`)
  process.exit(results.failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
