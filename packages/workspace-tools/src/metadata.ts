// Canonical workspace-tool identity + capability metadata — ONE source of truth
// for every runtime that executes these tools: the brain (local runtime),
// pilot-api (delegated runtime), and the VS Code extension (client runtime).
//
// WHY THIS FILE IS THE ONLY PLACE THESE ARE DECLARED.
//
// The same tool used to be named, classified and authorized in three places: a
// brain-side capability registry, a delegation allowlist, and a client-side
// "supported tools" array. Nothing forced them to agree, so a tool could be
// advertised by one, refused by another, and mutating according to a third. The
// registry below is imported by all of them, so a tool cannot be reachable
// without also being classified, and cannot change its authorization on one side
// only.
//
// CAPABILITY STATE IS NOT THE SAME QUESTION AS EXECUTION SUPPORT. Whether a tool
// EXISTS and what it is ALLOWED to do is declared here and is identical
// everywhere. Whether a particular runtime can currently execute it is a
// separate, runtime-local fact — see `clientExecutable` and the contract version
// below — because a client that has not shipped an adapter yet must be able to
// say so truthfully without the tool vanishing from the product.

export interface WorkspaceToolMeta {
  id: string;
  readOnly: boolean;
  mutating: boolean;
  approvalRequired: boolean;
  supportsDryRun: boolean;
  /**
   * Does this tool's ANSWER depend on the caller's filesystem or editor?
   *
   * True means it must run where the workspace is. Once the brain moved to a
   * shared server, running these on the brain host did not merely fail — a
   * directory listing returned EMPTY for a path that was simply on another
   * machine, which reads to a model as "this project has no files".
   */
  clientExecutable: boolean;
}

const t = (
  id: string,
  opts: Partial<Omit<WorkspaceToolMeta, 'id'>> = {},
): WorkspaceToolMeta => ({
  id,
  readOnly: opts.readOnly ?? true,
  mutating: opts.mutating ?? false,
  approvalRequired: opts.approvalRequired ?? false,
  supportsDryRun: opts.supportsDryRun ?? false,
  clientExecutable: opts.clientExecutable ?? true,
});

export const WORKSPACE_TOOLS = {
  // ── Reading the tree ───────────────────────────────────────────────────────
  'workspace.list': t('workspace.list'),
  'workspace.find': t('workspace.find'),
  'workspace.search': t('workspace.search'),

  // ── Reading files ──────────────────────────────────────────────────────────
  'file.read': t('file.read'),
  'file.readRange': t('file.readRange'),
  'file.readSymbol': t('file.readSymbol'),

  // ── Reading history ────────────────────────────────────────────────────────
  'git.status': t('git.status'),
  'git.diff': t('git.diff'),
  'git.history': t('git.history'),
  'git.blame': t('git.blame'),
  'git.overview': t('git.overview'),

  // ── Reading the editor's own view of the code ──────────────────────────────
  // supportsDryRun stays FALSE: a dry run of a read has no meaning. The brain's
  // own capability registry advertised `true` here, which is precisely the kind of
  // silent disagreement this file exists to end — two registries, one tool, two
  // answers, and nothing forcing them to reconcile.
  'diagnostics.get': t('diagnostics.get'),

  // ── Proposing and applying change ──────────────────────────────────────────
  // Proposals are read-only by construction: they compute what WOULD change.
  'fs.proposeChangeset': t('fs.proposeChangeset'),
  'edit.preview': t('edit.preview', { approvalRequired: true, supportsDryRun: true }),
  // The two mutating tools. Approval is not advisory — see applyRequiresApproval.
  'fs.applyChangeset': t('fs.applyChangeset', {
    readOnly: false,
    mutating: true,
    approvalRequired: true,
    supportsDryRun: true,
  }),
  'edit.apply': t('edit.apply', {
    readOnly: false,
    mutating: true,
    approvalRequired: true,
    supportsDryRun: true,
  }),
} as const satisfies Record<string, WorkspaceToolMeta>;

export type WorkspaceToolId = keyof typeof WORKSPACE_TOOLS;

export function workspaceToolMeta(id: string): WorkspaceToolMeta | undefined {
  return (WORKSPACE_TOOLS as Record<string, WorkspaceToolMeta>)[id];
}

/** Every declared tool id. */
export const WORKSPACE_TOOL_IDS: readonly string[] = Object.keys(WORKSPACE_TOOLS);

/** Tools that must run where the workspace is. */
export const CLIENT_EXECUTABLE_TOOL_IDS: readonly string[] = WORKSPACE_TOOL_IDS.filter(
  (id) => workspaceToolMeta(id)!.clientExecutable,
);

/**
 * May a remote planner have this applied without a human in the loop? No.
 *
 * The brain is a planner and a governor, not an operator. A mutating tool
 * reaching the working tree on the strength of a model's say-so is precisely the
 * authority boundary this system refuses to cross, so approval is enforced from
 * the shared contract rather than remembered independently by each runtime.
 */
export function applyRequiresApproval(id: string): boolean {
  const meta = workspaceToolMeta(id);
  return Boolean(meta?.mutating && meta.approvalRequired);
}

/*
 * CONTRACT VERSION — so an older client cannot silently mishandle a newer brain.
 *
 * Bump the MINOR when a tool is added or a tool's input grows an optional field:
 * an older client still handles everything it knows about, and simply reports the
 * new tool as unsupported. Bump the MAJOR when an existing tool's meaning,
 * required input, or result shape changes, because then an older client's answer
 * would be WRONG rather than merely incomplete — and a wrong answer that looks
 * structurally valid is the failure mode with no symptom.
 */
export const WORKSPACE_TOOL_CONTRACT_VERSION = '1.0.0';

export interface ContractCompatibility {
  compatible: boolean;
  reason?: string;
}

/** Can a runtime speaking `clientVersion` be trusted with this contract? */
export function contractCompatible(
  clientVersion: string | undefined,
  serverVersion: string = WORKSPACE_TOOL_CONTRACT_VERSION,
): ContractCompatibility {
  if (!clientVersion) {
    return { compatible: false, reason: 'the client did not declare a workspace-tool contract version' };
  }
  const parse = (v: string): [number, number, number] | undefined => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
  };
  const client = parse(clientVersion);
  const server = parse(serverVersion);
  if (!client || !server) {
    return { compatible: false, reason: `unparseable contract version "${clientVersion}"` };
  }
  if (client[0] !== server[0]) {
    return {
      compatible: false,
      reason: `contract major mismatch: client ${clientVersion}, server ${serverVersion}`,
    };
  }
  // A newer client against an older server is fine: it knows every tool this
  // server can ask for. The reverse is fine too — an unknown tool is refused BY
  // NAME rather than answered wrongly, which is why minor is not gated here.
  return { compatible: true };
}
