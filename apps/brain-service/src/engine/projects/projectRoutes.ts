/**
 * CONNECT / SELECT, over HTTP.
 *
 *   GET  /api/ai/projects                       → the projects this actor may use
 *   GET  /api/ai/conversations/:id/project      → what this conversation is using
 *   POST /api/ai/conversations/:id/project      → point it at a project
 *   DELETE /api/ai/conversations/:id/project    → stop using it
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE REQUEST CARRIES A PROJECT ID AND NOTHING ELSE
 *
 * No `canRead`, no `canPropose`, no authority kind, no grant object. A caller
 * that could send those would be granting itself permission, and "connect a
 * project" would become a self-service write grant. The body is
 * `{ projectId }`; everything else is looked up.
 *
 * The bind is REFUSED when the actor has no readable grant for that project, so
 * a conversation can never point at something its owner cannot use — the check
 * happens before the row is written, not only when it is read back.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CLIENT IS TOLD
 *
 * A label, a message and a remedy code. Never a grant id, never an authority
 * kind, never `connected-repo`. The client decides how to render `connect-
 * project`; the Brain does not name a product.
 * ---------------------------------------------------------------------------
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Scope } from '../memory/conversationStore.js';
import type { ProjectBindingStore } from './projectBinding.js';
import { promptFor, resolveBoundProject, type ProjectGrantSource } from './projectGrants.js';

export interface ProjectRouteDeps {
  grants: ProjectGrantSource;
  bindings: ProjectBindingStore;
  scopeFrom(request: FastifyRequest): Scope;
  /** The acting user, for the binding's provenance. */
  actorFrom(request: FastifyRequest): string;
  now?: () => number;
}

/** Everything a client may see about a project. A label, and an id to send back. */
interface ProjectView {
  id: string;
  label: string;
  /** Whether this project could support proposing changes, for honest UI. */
  canPropose: boolean;
}

export function registerProjectRoutes(app: FastifyInstance, deps: ProjectRouteDeps): void {
  const now = deps.now ?? (() => Date.now());

  /** The list a Connect control opens. Empty is a real, truthful answer. */
  app.get('/api/ai/projects', async (request) => {
    const scope = deps.scopeFrom(request);
    const grants = await deps.grants.listGrants(scope);
    const projects: ProjectView[] = grants
      .filter((g) => g.canRead)
      .map((g) => ({ id: g.projectId, label: g.label, canPropose: g.canPropose }));
    return {
      projects,
      /*
       * Said explicitly rather than left for the client to infer from an empty
       * array. "No projects are available to connect yet" is a different screen
       * from "choose one", and a Connect control that opens an empty list reads
       * as a broken product.
       */
      empty: projects.length === 0,
    };
  });

  app.get<{ Params: { id: string } }>('/api/ai/conversations/:id/project', async (request) => {
    const scope = deps.scopeFrom(request);
    const binding = await deps.bindings.get(request.params.id, scope);
    // RESOLVED, not read from the binding. See projectGrants.
    const resolution = await resolveBoundProject(binding?.projectId, scope, deps.grants);
    const eligible = (await deps.grants.listGrants(scope)).filter((g) => g.canRead).length;
    const prompt = promptFor(resolution, eligible);

    if (resolution.state === 'usable') {
      return {
        connected: true,
        project: { id: resolution.grant.projectId, label: resolution.grant.label },
        canPropose: resolution.authority.canPropose,
      };
    }
    return { connected: false, message: prompt.message, remedy: prompt.remedy };
  });

  app.post<{ Params: { id: string }; Body: { projectId?: string } }>(
    '/api/ai/conversations/:id/project',
    async (request, reply) => {
      const projectId = request.body?.projectId;
      if (!projectId || typeof projectId !== 'string') {
        reply.code(400);
        return { connected: false, message: 'Choose a project to connect.' };
      }
      const scope = deps.scopeFrom(request);

      /*
       * THE GRANT IS CHECKED BEFORE THE ROW IS WRITTEN. Binding first and
       * discovering at read time that the actor cannot use it would leave a
       * conversation pointing at something its owner has no claim to — visible
       * to anyone who can see the thread, and confusing forever after.
       */
      const grant = await deps.grants.resolveGrant(projectId, scope);
      if (!grant || !grant.canRead) {
        // 403, and no hint about whether it exists: whether an unreadable
        // project is real is not this caller's business.
        reply.code(403);
        return {
          connected: false,
          message: 'You do not have access to that project.',
          remedy: 'request-read-access',
        };
      }

      await deps.bindings.bind(
        {
          conversationId: request.params.id,
          projectId,
          boundBy: deps.actorFrom(request),
          boundAt: now(),
        },
        scope,
      );

      return {
        connected: true,
        project: { id: grant.projectId, label: grant.label },
        canPropose: grant.canPropose,
      };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/ai/conversations/:id/project', async (request) => {
    const scope = deps.scopeFrom(request);
    await deps.bindings.unbind(request.params.id, scope);
    // "Stop using", not "delete": the project is untouched and can be
    // reconnected, exactly like detaching a document from a conversation.
    return { connected: false, message: 'This conversation is no longer using a project.' };
  });
}
