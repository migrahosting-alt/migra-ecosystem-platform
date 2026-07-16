import { type EditPreviewRequest, type EditPreviewResponse } from '@migrapilot/protocol';
import { editApply as sharedEditApply, nodeWorkspaceFs } from '@migrapilot/workspace-tools';

// edit.preview is edit.apply in dry-run mode via the shared hardened tool — the
// exact proposed effect (before/after) with zero mutation.
const fs = nodeWorkspaceFs();

export async function editPreview(input: EditPreviewRequest): Promise<EditPreviewResponse> {
  const out = sharedEditApply(input, { fs, mode: 'dry-run' });
  return { tool: 'edit.preview', files: out.files.map((f) => ({ path: f.path, before: f.before ?? '', after: f.after ?? '' })) };
}
