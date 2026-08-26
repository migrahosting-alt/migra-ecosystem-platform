import 'server-only'

import type { MigrationRecord } from './migrationLedger'

/**
 * The authoritative migration ledger, in the Brain's PostgreSQL.
 *
 * A MIGRATION AND RECONCILIATION CLIENT — NOT A PERSISTENCE DEPENDENCY. Serving
 * bytes must never require this to be reachable. Dual-read tries object storage
 * and falls back to local without consulting any ledger, deliberately: migration
 * state is the truth about where bytes have been moved, not a precondition for
 * handing them to a user. If the Brain is down, media still serves.
 *
 * WHY IT GOES THROUGH THE BRAIN. The consumer has no database credentials and
 * should not get any. The Brain is the durable authority, and that boundary is
 * what keeps "who may write what" answerable in one place.
 *
 * SCOPE TRAVELS AS THE OWNER, NOT THE BUCKET. The Brain derives the media bucket
 * itself from the verified owner scope, so this client cannot name a bucket it
 * does not own — and the round trip proves both derivations agree.
 */

export interface BrainLedgerOptions {
  brainBaseUrl: string
  /** The artifact owner, e.g. `user:<sub>` — the Brain hashes it into a bucket. */
  ownerScope: string
  workspaceScope?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface AuthoritativeRecord {
  scope: string
  artifactId: string
  status: 'pending' | 'copied' | 'verified' | 'failed'
  expectedHash: string
  verifiedHash?: string
  verifiedAt?: number
  lastVerifiedAt?: number
  lastAttemptAt?: number
  attempts: number
}

export class BrainMigrationLedger {
  constructor(private readonly options: BrainLedgerOptions) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-owner-scope': this.options.ownerScope,
      'x-workspace-scope': this.options.workspaceScope ?? this.options.ownerScope,
    }
  }

  private url(path: string): string {
    return `${this.options.brainBaseUrl.replace(/\/$/, '')}${path}`
  }

  private call(path: string, init: RequestInit): Promise<Response> {
    const doFetch = this.options.fetchImpl ?? fetch
    return doFetch(this.url(path), {
      ...init,
      headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
    })
  }

  /** Write migration state. Throws on refusal — a silent failure here would make
   *  the authority quietly diverge from what actually happened. */
  async record(entry: MigrationRecord & { sourceKey?: string }): Promise<void> {
    const response = await this.call(`/api/ai/media/migrations/${encodeURIComponent(entry.artifactId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        sourceProvider: entry.sourceProvider,
        sourceKey: entry.sourceKey ?? entry.destinationKey,
        destinationProvider: entry.destinationProvider,
        destinationKey: entry.destinationKey,
        expectedHash: entry.expectedHash,
        ...(entry.verifiedHash ? { verifiedHash: entry.verifiedHash } : {}),
        status: entry.status,
        ...(entry.status === 'verified' ? { verifiedAt: entry.migratedAt, lastVerifiedAt: entry.migratedAt } : {}),
        copiedAt: entry.migratedAt,
        ...(entry.error ? { lastError: entry.error } : {}),
      }),
    })
    if (!response.ok) {
      throw new Error(`the Brain refused the migration record (${response.status})`)
    }
  }

  /** Current authoritative state, or null when this artifact was never migrated. */
  async get(artifactId: string, destinationProvider: string): Promise<AuthoritativeRecord | null> {
    const response = await this.call(
      `/api/ai/media/migrations/${encodeURIComponent(artifactId)}?destination=${encodeURIComponent(destinationProvider)}`,
      { method: 'GET' },
    )
    // 404 means NOT MIGRATED — a fact, distinct from a failure to ask.
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`the Brain could not answer (${response.status})`)
    const body = (await response.json()) as { migration?: AuthoritativeRecord }
    return body.migration ?? null
  }

  async isVerified(artifactId: string, destinationProvider: string): Promise<boolean> {
    const record = await this.get(artifactId, destinationProvider)
    return record?.status === 'verified'
  }
}
