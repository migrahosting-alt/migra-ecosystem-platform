/**
 * MigraPilot preferences, over HTTP.
 *
 *   GET   /api/ai/preferences          the document, or the defaults
 *   PATCH /api/ai/preferences          a partial update
 *   GET   /api/ai/preferences/events   when audited settings last changed
 *
 * SCOPE IS THE AUTHORIZATION. Like every other Brain route, the consumer gateway
 * derives `x-owner-scope` server-side from a verified session and this reads it.
 * There is no user id in any path or body — a request cannot ask for somebody
 * else's preferences because there is nowhere to put the request.
 *
 * IDENTITY IS NOT HERE. No name, no email, no avatar, no provider link. MigraAuth
 * owns those, and a second copy would drift the first time one side changed.
 *
 * PERSISTENCE-ONLY BY CONSTRUCTION: the table is migration 15 and SQLite has no
 * such thing, so the seam narrows to the PostgreSQL store and yields undefined
 * rather than pretending — the same shape the anonymous quota routes use.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  AUDITED_PREFERENCE_KEYS,
  MAX_CUSTOM_INSTRUCTIONS,
} from '@migrapilot/shared-types/user-preferences';
import type { PostgresDurableStore } from './persistence/postgresStore.js';

export interface PreferencesDeps {
  /** Undefined when durable persistence is unavailable — never a silent fake. */
  store: () => PostgresDurableStore | undefined;
  now: () => number;
  newId: () => string;
}

const bad = (reply: { code: (n: number) => unknown }, status: number, code: string, error: string) => {
  reply.code(status);
  return { ok: false, code, error };
};

/**
 * The scope pair, taken from the headers the gateway derived.
 *
 * Both are required. A workspace defaulting to the owner would quietly file a
 * user's preferences under a scope that changes when org context arrives.
 */
function scopeOf(request: FastifyRequest): { owner: string; workspace: string } | undefined {
  const owner = String(request.headers['x-owner-scope'] ?? '');
  const workspace = String(request.headers['x-workspace-scope'] ?? '');
  if (!owner || !workspace) return undefined;
  return { owner, workspace };
}

export function registerPreferencesRoutes(app: FastifyInstance, deps: PreferencesDeps): void {
  app.get('/api/ai/preferences', async (request, reply) => {
    const scope = scopeOf(request);
    if (!scope) return bad(reply, 400, 'SCOPE_REQUIRED', 'Owner and workspace scope are required.');

    const store = deps.store();
    if (!store) return bad(reply, 503, 'PERSISTENCE_UNAVAILABLE', 'Durable persistence is unavailable.');

    const row = await store.getUserPreferences(scope);
    return {
      ok: true,
      preferences: row.preferences,
      // `stored: false` means these are defaults nobody has chosen yet. The UI
      // can say "using defaults" instead of implying a saved decision.
      stored: row.stored,
      updatedAt: row.updatedAt,
    };
  });

  app.patch<{ Body: Record<string, unknown> }>('/api/ai/preferences', async (request, reply) => {
    const scope = scopeOf(request);
    if (!scope) return bad(reply, 400, 'SCOPE_REQUIRED', 'Owner and workspace scope are required.');

    const patch = request.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return bad(reply, 400, 'INVALID_INPUT', 'A JSON object of preference keys is required.');
    }

    /*
     * The one field with an unbounded shape gets a bound BEFORE the merge.
     *
     * `customInstructions` is free text that ends up in a model prompt. The
     * contract truncates it, but refusing an over-long value outright is the
     * honest answer: silently storing half of what someone wrote and reporting
     * success is worse than telling them it was too long.
     */
    const instructions = (patch as { customInstructions?: unknown }).customInstructions;
    if (typeof instructions === 'string' && instructions.length > MAX_CUSTOM_INSTRUCTIONS) {
      return bad(
        reply,
        400,
        'INSTRUCTIONS_TOO_LONG',
        `Custom instructions must be ${MAX_CUSTOM_INSTRUCTIONS} characters or fewer.`,
      );
    }

    const store = deps.store();
    if (!store) return bad(reply, 503, 'PERSISTENCE_UNAVAILABLE', 'Durable persistence is unavailable.');

    const result = await store.patchUserPreferences({
      scope,
      patch,
      now: deps.now(),
      eventId: deps.newId(),
      auditedKeys: AUDITED_PREFERENCE_KEYS as readonly string[],
    });

    /*
     * The FULL document comes back, not just what was sent.
     *
     * The client reconciles against this rather than trusting its own optimistic
     * state, so a value the server clamped or rejected shows up as the value the
     * server actually holds — which is the only way an optimistic UI can be
     * honest about a partial save.
     */
    return { ok: true, preferences: result.preferences, changed: result.changed };
  });

  app.get('/api/ai/preferences/events', async (request, reply) => {
    const scope = scopeOf(request);
    if (!scope) return bad(reply, 400, 'SCOPE_REQUIRED', 'Owner and workspace scope are required.');

    const store = deps.store();
    if (!store) return bad(reply, 503, 'PERSISTENCE_UNAVAILABLE', 'Durable persistence is unavailable.');

    return { ok: true, events: await store.listPreferenceEvents(scope, 20) };
  });
}
