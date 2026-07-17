// Node-backed ChangesetFs: the shared WorkspaceFs (atomic writes) plus the
// create/delete/dir operations the changeset engine needs. Containment is
// enforced by the engine via `containedPath`; this adapter only touches paths
// the engine has already contained.

import fs from 'node:fs';
import path from 'node:path';
import { nodeWorkspaceFs } from '@migrapilot/workspace-tools';
import type { ChangesetFs } from './changeset.js';

export function nodeChangesetFs(): ChangesetFs {
  return {
    ...nodeWorkspaceFs(),
    mkdirp: (p) => {
      fs.mkdirSync(p, { recursive: true });
    },
    removeFile: (p) => {
      fs.rmSync(p, { force: true });
    },
    removeDirIfEmpty: (p) => {
      try {
        fs.rmdirSync(p); // fails (kept) if the directory is non-empty
      } catch {
        /* non-empty or already gone — leave it */
      }
    },
  };
}

export { path };
