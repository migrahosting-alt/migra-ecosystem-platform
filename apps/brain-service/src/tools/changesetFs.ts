// Node-backed ChangesetFs: the shared WorkspaceFs (atomic writes) plus the
// create/delete/dir operations the changeset engine needs. Containment is
// enforced by the engine via `containedPath`; this adapter only touches paths
// the engine has already contained.

import fs from 'node:fs';
import path from 'node:path';
import { nodeWorkspaceFs } from '@migrapilot/workspace-tools';
import type { ChangesetFs } from './changeset.js';

export function nodeChangesetFs(): ChangesetFs {
  const base = nodeWorkspaceFs();
  // TEST-ONLY, off by default: MIGRAPILOT_TEST_FAULT_INJECT_WRITE=<n> makes the
  // n-th writeFile onward throw, so a controlled rollback failure →
  // INCONSISTENT_STATE can be demonstrated WITHOUT damaging a real workspace.
  // Never set outside local acceptance runs.
  const faultAt = Number(process.env.MIGRAPILOT_TEST_FAULT_INJECT_WRITE ?? 0);
  let writeCount = 0;
  const writeFile = faultAt > 0
    ? (p: string, content: string): void => {
        writeCount += 1;
        if (writeCount >= faultAt) throw new Error('MIGRAPILOT_TEST_FAULT_INJECT_WRITE injected fault');
        base.writeFile(p, content);
      }
    : base.writeFile;
  return {
    ...base,
    writeFile,
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
