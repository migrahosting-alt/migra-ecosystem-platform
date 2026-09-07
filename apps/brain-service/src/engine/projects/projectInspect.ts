/**
 * INSPECT, THROUGH A BOUND PROJECT.
 *
 *   POST /api/ai/conversations/:id/inspect
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE EXISTING INSPECT ROUTE WITH A GUARD BOLTED ON
 *
 * `POST /api/ai/inspect` takes a `rootPath` FROM THE REQUEST BODY. That is
 * correct for the extension: it is describing a folder the user has open on
 * their own machine, and the user's own client naming their own directory is
 * not a privilege escalation.
 *
 * The same shape from a web caller would be one — they would be naming a
 * directory on the server. So this route accepts NO PATH AT ALL. It takes a
 * conversation, resolves the binding, resolves the grant, and takes the root
 * from the GRANT. The client says which project; the platform says where it is.
 *
 * ---------------------------------------------------------------------------
 * 🚨 RESOLVED EVERY TIME, AND canApply NEVER SURVIVES THE TRIP
 *
 * Nothing here caches an authority between requests, and nothing may. The
 * regression this exists to prevent is: connect while permitted, have access
 * revoked, and keep inspecting because the authority was resolved once and
 * kept. Every call re-resolves, so revocation lands on the next request.
 *
 * The binding is NOT deleted when access is lost. It is a pointer, the pointer
 * is still true, and erasing it would turn "you lost access" into "you never
 * connected anything" — which sends the user to reconnect a project they
 * already have, and it will fail identically.
 * ---------------------------------------------------------------------------
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Scope } from '../memory/conversationStore.js';
import { InspectRequestSchema, runInspection } from '../workspace/inspectRoutes.js';
import type { ProjectBindingStore } from './projectBinding.js';
import { promptFor, resolveBoundProject, type ProjectGrantSource } from './projectGrants.js';

export interface ProjectInspectDeps {
  grants: ProjectGrantSource;
  bindings: ProjectBindingStore;
  scopeFrom(request: FastifyRequest): Scope;
}

/**
 * Resolve the authority for one conversation's inspect.
 *
 * Exported so the decision can be tested without a server, and so the
 * orchestration layer can ask the same question the route asks — one authority
 * resolution, not two that agree until they do not.
 */
export async function inspectAuthorityFor(
  conversationId: string,
  scope: Scope,
  deps: Pick<ProjectInspectDeps, 'grants' | 'bindings'>,
): Promise<
  | { ok: true; rootPath: string; label: string; canPropose: boolean }
  | { ok: false; status: number; message: string; remedy: string }
> {
  const binding = await deps.bindings.get(conversationId, scope);
  const resolution = await resolveBoundProject(binding?.projectId, scope, deps.grants);

  if (resolution.state === 'usable') {
    /*
     * A read-only authority is enough for inspection, and that is all this path
     * will ever hold: `authorityFromGrant` forces canApply false whatever the
     * grant says, and nothing downstream can widen it because nothing downstream
     * is given anything to widen.
     */
    if (!resolution.authority.canRead) {
      return {
        ok: false,
        status: 403,
        message: 'You no longer have access to the project this conversation uses.',
        remedy: 'request-read-access',
      };
    }
    return {
      ok: true,
      rootPath: resolution.grant.rootPath,
      label: resolution.grant.label,
      canPropose: resolution.authority.canPropose,
    };
  }

  const eligible = (await deps.grants.listGrants(scope)).filter((g) => g.canRead).length;
  const prompt = promptFor(resolution, eligible);
  return {
    ok: false,
    // 409 for "nothing connected" — the request was fine, the state is not.
    // 403 when access was withdrawn, which is a permission answer.
    status: resolution.state === 'not-permitted' ? 403 : 409,
    message: prompt.message,
    remedy: prompt.remedy,
  };
}

export function registerProjectInspectRoutes(app: FastifyInstance, deps: ProjectInspectDeps): void {
  app.post<{ Params: { id: string } }>(
    '/api/ai/conversations/:id/inspect',
    async (request, reply) => {
      const scope = deps.scopeFrom(request);
      const authority = await inspectAuthorityFor(request.params.id, scope, deps);

      if (!authority.ok) {
        reply.code(authority.status);
        // A sentence and a remedy code. No project id, no authority kind, no
        // grant reference — see the copy guard.
        return { ok: false, error: authority.message, remedy: authority.remedy };
      }

      /*
       * The path is INJECTED from the grant, never merged with anything the
       * caller sent. Parsing the body with a rootPath the client supplied and
       * then overriding it would leave the override one refactor from being
       * forgotten; the schema is fed a value the client cannot influence.
       */
      const parsed = InspectRequestSchema.safeParse({
        ...(typeof request.body === 'object' && request.body !== null ? request.body : {}),
        rootPath: authority.rootPath,
      });
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: 'That is not a valid inspection request.' };
      }

      try {
        const { data } = await runInspection(parsed.data);
        return {
          ok: true,
          op: parsed.data.op,
          // The LABEL, so a user can see which project answered. Never the id.
          project: authority.label,
          data,
        };
      } catch (error) {
        reply.code(422);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
}
