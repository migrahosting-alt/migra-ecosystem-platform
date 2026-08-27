/**
 * Readiness as an API: enqueue a document, ask how it is going.
 *
 * The consumer owns the files and the UI; the Brain owns the work and the state.
 * These routes are the seam, and they are deliberately thin — the consumer must
 * never compute progress itself, because a client-side guess drifts from the job
 * and a user reloading would see two different truths.
 */

import type { FastifyInstance } from 'fastify';

import { scopeFrom } from '../memory/memoryRoutes.js';
import type { DocumentJobRunner } from './documentJobs.js';
import type { DocumentReadiness } from './documentReadiness.js';
import { describeState, isReadable, SEQUENCE_LIMITED_NOTE } from './documentReadiness.js';

export interface DocumentReadinessStore {
  read(scope: { ownerScope: string; workspaceScope: string }, fileName: string): Promise<DocumentReadiness | undefined>;
  list(scope: { ownerScope: string; workspaceScope: string }): Promise<DocumentReadiness[]>;
  remove(scope: { ownerScope: string; workspaceScope: string }, fileName: string): Promise<void>;
}

/** The engine's scope shape, mapped to the persistence one. */
const scoped = (request: Parameters<typeof scopeFrom>[0]) => {
  const s = scopeFrom(request);
  return { ownerScope: s.owner, workspaceScope: s.workspace };
};

/**
 * Presented form: the state, plus the one sentence describing it.
 *
 * The sentence is built HERE rather than in the consumer so a new state cannot
 * ship with the UI still rendering a blank — the wording lives beside the states
 * it describes.
 */
function present(readiness: DocumentReadiness) {
  return {
    ...readiness,
    description: describeState(readiness),
    readable: isReadable(readiness.state),
    /*
     * Terminal states must stop the client polling. Sending this explicitly
     * saves every caller from re-deriving the rule and getting it subtly wrong —
     * a poll that never stops is a background request storm nobody notices.
     */
    polling: readiness.state === 'processing' || readiness.state === 'stored',
    /*
     * The caveat text travels WITH the state, so there is one definition of it.
     * A copy in the consumer would drift from the behaviour it describes the
     * first time either is edited, and a warning that no longer matches what the
     * system does is worse than none.
     *
     * Present only when it could ever apply; whether it is SHOWN is the caller's
     * decision, made per question.
     */
    ...(readiness.sequenceComplete === false ? { sequenceNote: SEQUENCE_LIMITED_NOTE } : {}),
  };
}

export function registerDocumentRoutes(
  app: FastifyInstance,
  runner: DocumentJobRunner,
  store: DocumentReadinessStore,
): void {
  /** Everything this scope knows about, for the Files list. */
  app.get('/api/ai/documents', async (request) => {
    const all = await store.list(scoped(request));
    return { ok: true, documents: all.map(present) };
  });

  app.get<{ Params: { name: string } }>('/api/ai/documents/:name', async (request, reply) => {
    const readiness = await store.read(scoped(request), decodeURIComponent(request.params.name));
    if (!readiness) {
      /*
       * No record is NOT an error. A text-layer PDF is read inside the request
       * and never enters this table, so 404-ing here would make the consumer
       * treat an ordinary document as broken.
       */
      reply.code(404);
      return { ok: false, code: 'NO_PROCESSING_RECORD' };
    }
    return { ok: true, document: present(readiness) };
  });

  /**
   * Accept a document for background reading.
   *
   * Returns as soon as the pending state is DURABLE. The work takes minutes; the
   * request must not.
   */
  app.post<{ Body: { fileName?: string; path?: string } }>('/api/ai/documents/process', async (request, reply) => {
    const fileName = request.body?.fileName;
    const path = request.body?.path;
    if (!fileName || !path) {
      reply.code(400);
      return { ok: false, code: 'BAD_REQUEST', error: 'fileName and path are required.' };
    }

    const scope = scoped(request);
    const existing = await store.read(scope, fileName);
    /*
     * A second upload of a document already being read must not start the work
     * again. Nine minutes of CPU spent twice would be bad; two jobs racing on one
     * readiness row would be worse, because the loser overwrites the winner's
     * progress and the user watches the stage go backwards.
     */
    if (existing && (existing.state === 'processing' || existing.state === 'stored')) {
      return { ok: true, document: present(existing), alreadyQueued: true };
    }

    await runner.enqueue(scope, fileName, path);
    const queued = await store.read(scope, fileName);
    return { ok: true, document: queued ? present(queued) : { fileName, state: 'processing' }, alreadyQueued: false };
  });

  /** Deleting a document must take its readiness with it. */
  app.delete<{ Params: { name: string } }>('/api/ai/documents/:name', async (request) => {
    await store.remove(scoped(request), decodeURIComponent(request.params.name));
    return { ok: true };
  });
}
