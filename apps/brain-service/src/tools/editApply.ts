import { type EditApplyRequest, type EditApplyResponse } from '@migrapilot/protocol';
import { editApply as sharedEditApply, nodeWorkspaceFs } from '@migrapilot/workspace-tools';

// The apply logic is the shared, hardened workspace tool (path containment,
// atomic write, read-back verify, all-or-nothing) — the SAME contract pilot-api
// executes for a delegated run. The brain wraps it with a Node filesystem and maps
// to the canonical response shape (behavior for valid inputs is unchanged).
const fs = nodeWorkspaceFs();

export async function editApply(input: EditApplyRequest): Promise<EditApplyResponse> {
  const out = sharedEditApply(input, { fs, mode: 'live' });
  return { tool: 'edit.apply', files: out.files.map((f) => ({ path: f.path, changed: f.changed })) };
}
