// Canonical workspace-tool identity + capability metadata — ONE source of truth
// for both the brain (local runtime) and pilot-api (delegated runtime).

export interface WorkspaceToolMeta {
  id: string;
  readOnly: boolean;
  mutating: boolean;
  approvalRequired: boolean;
  supportsDryRun: boolean;
}

export const WORKSPACE_TOOLS = {
  'diagnostics.get': { id: 'diagnostics.get', readOnly: true, mutating: false, approvalRequired: false, supportsDryRun: false },
  'edit.apply': { id: 'edit.apply', readOnly: false, mutating: true, approvalRequired: true, supportsDryRun: true },
} as const satisfies Record<string, WorkspaceToolMeta>;

export type WorkspaceToolId = keyof typeof WORKSPACE_TOOLS;

export function workspaceToolMeta(id: string): WorkspaceToolMeta | undefined {
  return (WORKSPACE_TOOLS as Record<string, WorkspaceToolMeta>)[id];
}
