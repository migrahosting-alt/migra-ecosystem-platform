import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';

import {
  getMediaMigration, listUnverifiedMediaMigrations, recordMediaMigration,
  summariseMediaMigrations, type MediaMigrationStatus,
} from '../persistence/postgres/mediaMigrationRepo.js';

/**
 * Migration state for media artifacts, over HTTP.
 *
 * WHY THE CONSUMER CANNOT REACH POSTGRES DIRECTLY. It has no database
 * credentials and should not get any: the Brain is the durable authority, and
 * that boundary is what keeps "who may write what" answerable in one place.
 * These routes are the narrow opening for exactly the operations the consumer
 * needs — not a generic table API, which would make the boundary decorative.
 *
 * 🚨 SCOPE IS DERIVED HERE, NEVER ACCEPTED FROM THE BODY. The media bucket is a
 * hash of the owner scope, and the owner scope comes from the request's verified
 * ownership header — the same path artifacts themselves use. A caller that could
 * name its own bucket could read or rewrite another account's migration state,
 * which is exactly the identity confusion that already produced one false proof.
 */

export interface MediaMigrationRouteDeps {
  transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  now?: () => number;
}

const headerValue = (request: FastifyRequest, name: string): string | undefined => {
  const h = request.headers[name];
  return Array.isArray(h) ? h[0] : h;
};

/**
 * The caller's media bucket, computed from their verified owner scope.
 *
 * Must stay identical to the consumer's derivation, or the two would disagree
 * about which bucket an artifact lives in and every lookup would miss.
 */
export function mediaScopeFor(owner: string): string {
  return createHash('sha256').update(owner).digest('hex').slice(0, 32);
}

const ARTIFACT_ID = /^img_[0-9a-f]{32}$/;
const STATUSES: readonly MediaMigrationStatus[] = ['pending', 'copied', 'verified', 'failed'];

export function registerMediaMigrationRoutes(app: FastifyInstance, deps: MediaMigrationRouteDeps): void {
  const now = deps.now ?? (() => Date.now());

  const scopeOf = (request: FastifyRequest): string | null => {
    const owner = headerValue(request, 'x-owner-scope');
    // No owner means no bucket. Defaulting would put one caller's migration
    // state in a namespace shared with everyone who also failed to identify.
    return owner ? mediaScopeFor(owner) : null;
  };

  /** Record or update the state of one migration. */
  app.put<{
    Params: { artifactId: string };
    Body: {
      sourceProvider?: string; sourceKey?: string;
      destinationProvider?: string; destinationKey?: string;
      expectedHash?: string; verifiedHash?: string;
      status?: string; copiedAt?: number; verifiedAt?: number; lastVerifiedAt?: number;
      lastError?: string; correlationId?: string;
    };
  }>('/api/ai/media/migrations/:artifactId', async (request, reply) => {
    const scope = scopeOf(request);
    if (!scope) {
      reply.code(400);
      return { ok: false, code: 'NO_SCOPE', error: 'An owner scope is required.' };
    }
    const { artifactId } = request.params;
    if (!ARTIFACT_ID.test(artifactId)) {
      reply.code(400);
      return { ok: false, code: 'BAD_ARTIFACT', error: 'artifactId must be a canonical img_ ref.' };
    }
    const body = request.body ?? {};
    const status = body.status as MediaMigrationStatus | undefined;
    if (!status || !STATUSES.includes(status)) {
      reply.code(400);
      return { ok: false, code: 'BAD_STATUS', error: `status must be one of ${STATUSES.join(', ')}.` };
    }
    if (!body.sourceProvider || !body.destinationProvider || !body.destinationKey || !body.expectedHash) {
      reply.code(400);
      return {
        ok: false, code: 'INVALID_INPUT',
        error: 'sourceProvider, destinationProvider, destinationKey and expectedHash are required.',
      };
    }

    const at = now();
    await deps.transaction((client) =>
      recordMediaMigration(client, {
        scope,
        artifactId,
        sourceProvider: body.sourceProvider!,
        sourceKey: body.sourceKey ?? body.destinationKey!,
        destinationProvider: body.destinationProvider!,
        destinationKey: body.destinationKey!,
        expectedHash: body.expectedHash!,
        verifiedHash: body.verifiedHash,
        status,
        copiedAt: body.copiedAt,
        verifiedAt: body.verifiedAt,
        lastVerifiedAt: body.lastVerifiedAt,
        lastError: body.lastError,
        correlationId: body.correlationId,
        at,
      }),
    );
    return { ok: true, scope, artifactId, status };
  });

  /** Current state for one artifact against one destination. */
  app.get<{ Params: { artifactId: string }; Querystring: { destination?: string } }>(
    '/api/ai/media/migrations/:artifactId',
    async (request, reply) => {
      const scope = scopeOf(request);
      const destination = request.query?.destination;
      if (!scope || !destination) {
        reply.code(400);
        return { ok: false, code: 'INVALID_INPUT', error: 'An owner scope and ?destination are required.' };
      }
      const record = await deps.transaction((client) =>
        getMediaMigration(client, scope, request.params.artifactId, destination),
      );
      if (!record) {
        // Absent is a fact, and distinct from unverified — the caller may not
        // have migrated this artifact at all.
        reply.code(404);
        return { ok: false, code: 'NOT_MIGRATED', scope, artifactId: request.params.artifactId };
      }
      return { ok: true, migration: record, verified: record.status === 'verified' };
    },
  );

  /**
   * A bounded view for reconciliation: what is left, and what needs attention.
   *
   * Deliberately not a general query surface. Two questions are answerable —
   * counts by status, and the oldest unverified records — because those are the
   * two a migration actually asks.
   */
  app.get<{ Querystring: { limit?: string } }>('/api/ai/media/migrations', async (request, reply) => {
    const scope = scopeOf(request);
    if (!scope) {
      reply.code(400);
      return { ok: false, code: 'NO_SCOPE', error: 'An owner scope is required.' };
    }
    const limit = Math.min(500, Math.max(1, Number(request.query?.limit ?? 100) || 100));
    const { summary, unverified } = await deps.transaction(async (client) => ({
      summary: await summariseMediaMigrations(client),
      unverified: await listUnverifiedMediaMigrations(client, limit),
    }));
    return {
      ok: true,
      summary,
      // Filtered to the caller's own scope: the summary is operational, the
      // records are theirs.
      unverified: unverified.filter((m) => m.scope === scope),
    };
  });
}
