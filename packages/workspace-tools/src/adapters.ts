// Runtime-neutral host adapters. The workspace tools contain NO direct fs / editor
// access; a host (brain, pilot-api, tests) injects these. This is what lets the
// SAME hardened tool logic run in every runtime while each host controls its own
// root, scope, and audit.

import type { DiagnosticsGetResponse } from '@migrapilot/protocol';

export type DiagnosticItem = DiagnosticsGetResponse['items'][number];

/** The bounded filesystem a workspace tool may touch. A host implementation MUST
 * confine every operation to the workspace root (see `containedPath`). */
export interface WorkspaceFs {
  /** Read a file's UTF-8 content. Throws if it does not exist. */
  readFile(absPath: string): string;
  /** Write UTF-8 content atomically (temp + rename on the same filesystem). */
  writeFile(absPath: string, content: string): void;
  /** True if the path exists. */
  exists(absPath: string): boolean;
  /** Canonicalize symlinks for an EXISTING path (throws if missing). Used to
   * detect symlink escape out of the workspace root. */
  realPath(absPath: string): string;
  /** Directory of a path (host-provided so the tools never import node:path). */
  dirname(absPath: string): string;
  /** Resolve a root + relative path to an absolute path (no symlink resolution). */
  resolve(root: string, relPath: string): string;
  /** True if `p` is an absolute path. */
  isAbsolute(p: string): boolean;
  /** Path separator, for containment prefix checks. */
  readonly sep: string;
}

/** Where diagnostics come from — host-specific (brain: in-memory editor sync;
 * pilot-api: an injected provider). Read-only. */
export interface DiagnosticsSource {
  get(rootPath: string, path?: string): DiagnosticItem[];
}
