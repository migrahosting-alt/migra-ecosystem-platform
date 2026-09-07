/*
 * WHERE WORK MAY ACTUALLY HAPPEN.
 *
 * SURFACE IS NOT CAPABILITY. AUTHORITY IS CAPABILITY.
 *
 * The consumer currently cannot build, and the reason must be recorded as "this
 * caller presented no project authority" rather than "this is the consumer".
 * Those two statements behave identically today and diverge permanently: the
 * first becomes capable the moment a repo is connected, the second hard-codes
 * "consumer = planner, extension = builder" into the architecture and never
 * recovers.
 *
 * So an authority is DECLARED by the caller and evaluated by the Brain. The
 * Brain never infers what a surface can do from which surface it is.
 */

export type ProjectAuthorityKind =
  /** The VS Code extension, executing against the user's local workspace. */
  | 'vscode-workspace'
  /** A repository the platform may operate on server-side, under explicit grant. */
  | 'connected-repo'
  /** A project the platform itself hosts and manages. */
  | 'platform-project'
  /** No project is available to this caller for this turn. */
  | 'none';

/**
 * What a caller may do with the project it holds.
 *
 * Three separate permissions, because they are three separate risks: reading a
 * repository, proposing a change, and writing it are routinely granted apart
 * from one another, and collapsing them into one boolean is how a read-only
 * connection ends up applying a changeset.
 */
export interface ProjectAuthority {
  kind: ProjectAuthorityKind;
  /** Stable id of the project, when one exists. Never a path from the client. */
  id?: string;
  /** Human-readable, for an explanation the user can act on. */
  label: string;
  canRead: boolean;
  canPropose: boolean;
  canApply: boolean;
}

export const NO_AUTHORITY: ProjectAuthority = {
  kind: 'none',
  label: 'no project',
  canRead: false,
  canPropose: false,
  canApply: false,
};

/** The VS Code extension's authority over the folder the user has open. */
export function vscodeWorkspaceAuthority(rootPath: string): ProjectAuthority {
  return {
    kind: 'vscode-workspace',
    id: rootPath,
    label: 'the workspace open in VS Code',
    canRead: true,
    canPropose: true,
    // Applying still passes the operator gate at execution time; this says the
    // authority PERMITS it, not that any write happens without a human.
    canApply: true,
  };
}

/**
 * A repository the platform may READ on the user's behalf, under explicit grant.
 *
 * 🚨 THIS IS THE ONE THE WEB NEEDED AND DID NOT HAVE. Until now the only
 * constructor granting read/propose/apply was `vscodeWorkspaceAuthority`, so a
 * web caller could hold no usable authority at all — and the refusal it got
 * told it to go and install a different product. That made project access a VS
 * Code feature in practice while the type said it was a platform capability.
 *
 * Read-only by construction. Proposing and applying are separate grants and are
 * NOT implied by connecting: a read-only connection that could apply a
 * changeset is precisely what splitting these three booleans exists to prevent.
 */
export function connectedRepoAuthority(id: string, label: string): ProjectAuthority {
  return { kind: 'connected-repo', id, label, canRead: true, canPropose: false, canApply: false };
}

/**
 * A project the platform itself hosts. Same read-only default, same reason.
 *
 * Hosting a project is not consent to change it, and the grant that adds
 * `canPropose` is a different decision made somewhere a user can see it.
 */
export function platformProjectAuthority(id: string, label: string): ProjectAuthority {
  return { kind: 'platform-project', id, label, canRead: true, canPropose: false, canApply: false };
}

/**
 * What the caller should DO about a shortfall — as a code, not a sentence.
 *
 * The sentence used to name VS Code, on a platform capability, in shared code.
 * A structured action lets each client offer the thing it actually has: the web
 * a Connect project control, the extension a folder to open. Neither is
 * hardcoded into the Brain's answer.
 */
export type AuthorityRemedy = 'connect-project' | 'request-read-access' | 'request-write-access' | 'none';

export function authorityRemedy(authority: ProjectAuthority): AuthorityRemedy {
  if (authority.kind === 'none') return 'connect-project';
  if (!authority.canRead) return 'request-read-access';
  if (!authority.canPropose || !authority.canApply) return 'request-write-access';
  return 'none';
}

/** Does this authority satisfy what a step needs? */
export function authoritySatisfies(
  authority: ProjectAuthority,
  need: { read?: boolean; propose?: boolean; apply?: boolean },
): boolean {
  if (need.read && !authority.canRead) return false;
  if (need.propose && !authority.canPropose) return false;
  if (need.apply && !authority.canApply) return false;
  return true;
}

/** What to tell a user whose authority cannot carry the outcome they asked for. */
export function authorityShortfall(authority: ProjectAuthority): string {
  if (authority.kind === 'none') {
    return 'no project is connected to this conversation';
  }
  if (!authority.canRead) return `${authority.label} cannot be read`;
  if (!authority.canPropose) return `${authority.label} is read-only, so no changes can be proposed`;
  return `${authority.label} cannot apply changes`;
}
