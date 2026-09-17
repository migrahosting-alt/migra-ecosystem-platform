import {
  GitOverviewResponseSchema,
  GitStatusResponseSchema,
  type GitOverviewResponse,
  type GitStatusResponse,
} from '@migrapilot/protocol';

import { auditHash } from '../observability/auditLog.js';

import type { EngineerWorkspaceSnapshotV1 } from './engineerCheckpointStore.js';

export interface CanonicalEngineerGitState {
  overview: GitOverviewResponse;
  status: GitStatusResponse;
}

/**
 * Canonicalize the working-tree portion of git.status.
 *
 * Array order is deliberately NOT authority. Two clients can return the same
 * Git facts in a different order and must still produce the same restart
 * fingerprint.
 *
 * Paths are normalized to POSIX separators so a Windows client and a WSL/Linux
 * client describing the same repository state do not disagree merely because
 * of separator presentation.
 */
export function canonicalEngineerDirtyState(
  raw: unknown,
): Array<[path: string, indexStatus: string, worktreeStatus: string]> {
  const status = GitStatusResponseSchema.parse(raw);

  return status.files
    .map(
      (file): [string, string, string] => [
        file.path.replace(/\\/g, '/'),
        file.indexStatus,
        file.worktreeStatus,
      ],
    )
    .sort((left, right) => {
      const byPath = left[0].localeCompare(right[0]);
      if (byPath !== 0) return byPath;

      const byIndex = left[1].localeCompare(right[1]);
      if (byIndex !== 0) return byIndex;

      return left[2].localeCompare(right[2]);
    });
}

/**
 * Build the durable repository identity used by Engineer continuation.
 *
 * git.overview owns HEAD/branch because it handles detached and unborn HEAD
 * truthfully. git.status owns exact dirty-file state.
 */
export function engineerWorkspaceSnapshotFromGit(
  statusRaw: unknown,
  overviewRaw: unknown,
): EngineerWorkspaceSnapshotV1 {
  const status = GitStatusResponseSchema.parse(statusRaw);
  const overview = GitOverviewResponseSchema.parse(overviewRaw);

  const canonicalDirty = canonicalEngineerDirtyState(status);

  return {
    gitHead: overview.head,
    gitBranch: overview.branch,
    dirtyFingerprint: auditHash(JSON.stringify(canonicalDirty)),
  };
}
