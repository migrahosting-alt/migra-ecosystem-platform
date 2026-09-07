/**
 * The grant source a deployment has before it integrates a project directory.
 *
 * 🚨 EMPTY IS THE HONEST DEFAULT. It lists nothing and resolves nothing, so
 * every route answers "No projects are available to connect yet" — which is
 * exactly true for an install that has not connected one.
 *
 * The tempting alternative is a source that manufactures a project from a path
 * the caller supplies. That is the client-manufactured authority this whole
 * design refuses: it would let any caller name a directory on the server and
 * receive read access to it.
 *
 * Replace this with a real implementation — a repository integration, a hosted
 * workspace registry — without touching a route, a binding or a client.
 */
import type { ProjectGrant, ProjectGrantSource } from './projectGrants.js';

export class EmptyProjectGrantSource implements ProjectGrantSource {
  async listGrants(): Promise<ProjectGrant[]> {
    return [];
  }
  async resolveGrant(): Promise<ProjectGrant | null> {
    return null;
  }
}
