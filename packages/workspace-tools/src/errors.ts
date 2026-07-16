export type WorkspaceToolErrorCode =
  | 'PATH_ESCAPE' // traversal or symlink escape out of the workspace root
  | 'ABSOLUTE_PATH' // a client-supplied absolute path (never allowed)
  | 'INVALID_RANGE' // an edit range outside the file
  | 'NOT_FOUND' // a target file does not exist
  | 'READBACK_MISMATCH' // post-write read-back did not match the intended content
  | 'PARTIAL_WRITE' // a multi-file apply failed mid-way (rolled back where possible)
  | 'INVALID_INPUT';

export class WorkspaceToolError extends Error {
  constructor(public readonly code: WorkspaceToolErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceToolError';
  }
}
