import { z } from 'zod';

export const ToolNameSchema = z.enum([
  'workspace.search',
  'file.readRange',
  'file.readSymbol',
  'git.status',
  'git.diff',
  'edit.preview',
  'edit.apply',
  'diagnostics.get',
]);

export type ToolName = z.infer<typeof ToolNameSchema>;

export const PositionSchema = z.object({
  line: z.number().int().min(1),
  character: z.number().int().min(1),
});

export const RangeSchema = z.object({
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
});

export const ToolErrorSchema = z.object({
  code: z.enum([
    'INVALID_INPUT',
    'NOT_FOUND',
    'OUT_OF_BOUNDS',
    'IO_ERROR',
    'GIT_ERROR',
    'UNSUPPORTED',
    'INTERNAL_ERROR',
  ]),
  message: z.string(),
  details: z.unknown().optional(),
});

export type ToolError = z.infer<typeof ToolErrorSchema>;

export const WorkspaceSearchRequestSchema = z.object({
  rootPath: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(200).default(20),
  includeGlobs: z.array(z.string()).default([]),
  excludeGlobs: z.array(z.string()).default([
    '**/node_modules/**',
    '**/dist/**',
    '**/.git/**',
    '**/coverage/**',
  ]),
});

export const WorkspaceSearchMatchSchema = z.object({
  path: z.string(),
  line: z.number().int().min(1),
  preview: z.string(),
});

export const WorkspaceSearchResponseSchema = z.object({
  tool: z.literal('workspace.search'),
  matches: z.array(WorkspaceSearchMatchSchema),
});

export type WorkspaceSearchRequest = z.infer<typeof WorkspaceSearchRequestSchema>;
export type WorkspaceSearchResponse = z.infer<typeof WorkspaceSearchResponseSchema>;

export const FileReadRangeRequestSchema = z.object({
  rootPath: z.string().min(1),
  path: z.string().min(1),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
});

export const FileReadRangeResponseSchema = z.object({
  tool: z.literal('file.readRange'),
  path: z.string(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  content: z.string(),
  totalLines: z.number().int().min(0),
});

export type FileReadRangeRequest = z.infer<typeof FileReadRangeRequestSchema>;
export type FileReadRangeResponse = z.infer<typeof FileReadRangeResponseSchema>;

export const FileReadSymbolRequestSchema = z.object({
  rootPath: z.string().min(1),
  path: z.string().min(1),
  symbolName: z.string().min(1).optional(),
  line: z.number().int().min(1).optional(),
});

export const FileReadSymbolResponseSchema = z.object({
  tool: z.literal('file.readSymbol'),
  path: z.string(),
  symbolName: z.string(),
  kind: z.enum([
    'function',
    'class',
    'interface',
    'type',
    'enum',
    'method',
    'variable',
    'unknown',
  ]),
  range: z.object({
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
  }),
  content: z.string(),
});

export type FileReadSymbolRequest = z.infer<typeof FileReadSymbolRequestSchema>;
export type FileReadSymbolResponse = z.infer<typeof FileReadSymbolResponseSchema>;

export const GitStatusRequestSchema = z.object({
  rootPath: z.string().min(1),
});

export const GitStatusFileSchema = z.object({
  path: z.string(),
  indexStatus: z.string(),
  worktreeStatus: z.string(),
});

export const GitStatusResponseSchema = z.object({
  tool: z.literal('git.status'),
  branch: z.string().nullable(),
  files: z.array(GitStatusFileSchema),
});

export type GitStatusRequest = z.infer<typeof GitStatusRequestSchema>;
export type GitStatusResponse = z.infer<typeof GitStatusResponseSchema>;

export const GitDiffRequestSchema = z.object({
  rootPath: z.string().min(1),
  path: z.string().optional(),
  staged: z.boolean().default(false),
});

export const GitDiffResponseSchema = z.object({
  tool: z.literal('git.diff'),
  path: z.string().nullable(),
  staged: z.boolean(),
  diff: z.string(),
});

export type GitDiffRequest = z.infer<typeof GitDiffRequestSchema>;
export type GitDiffResponse = z.infer<typeof GitDiffResponseSchema>;

export const EditPreviewChangeSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  replacement: z.string(),
});

export const EditPreviewRequestSchema = z.object({
  rootPath: z.string().min(1),
  changes: z.array(EditPreviewChangeSchema).min(1),
});

export const EditPreviewFileSchema = z.object({
  path: z.string(),
  before: z.string(),
  after: z.string(),
});

export const EditPreviewResponseSchema = z.object({
  tool: z.literal('edit.preview'),
  files: z.array(EditPreviewFileSchema),
});

export type EditPreviewRequest = z.infer<typeof EditPreviewRequestSchema>;
export type EditPreviewResponse = z.infer<typeof EditPreviewResponseSchema>;

export const EditApplyRequestSchema = z.object({
  rootPath: z.string().min(1),
  changes: z.array(EditPreviewChangeSchema).min(1),
});

export const EditApplyFileSchema = z.object({
  path: z.string(),
  changed: z.boolean(),
});

export const EditApplyResponseSchema = z.object({
  tool: z.literal('edit.apply'),
  files: z.array(EditApplyFileSchema),
});

export type EditApplyRequest = z.infer<typeof EditApplyRequestSchema>;
export type EditApplyResponse = z.infer<typeof EditApplyResponseSchema>;

// ── Changeset (Slice 3B): first-class file create/replace/patch/delete/mkdir with
// an immutable proposal → single-use approval → atomic, rollback-safe apply ─────

/** One operation in a changeset. `expectedSha` (filled by propose) binds the
 * proposal to the file's pre-state so a stale source is refused at apply. */
export const ChangeOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), path: z.string().min(1), content: z.string() }),
  z.object({ op: z.literal('replace'), path: z.string().min(1), content: z.string(), expectedSha: z.string().optional() }),
  z.object({
    op: z.literal('patch'),
    path: z.string().min(1),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    replacement: z.string(),
    expectedSha: z.string().optional(),
  }),
  z.object({ op: z.literal('delete'), path: z.string().min(1), expectedSha: z.string().optional() }),
  z.object({ op: z.literal('mkdir'), path: z.string().min(1) }),
]);

export const ChangesetRequestSchema = z.object({
  rootPath: z.string().min(1),
  ops: z.array(ChangeOpSchema).min(1),
  /** delete operations are refused unless the caller explicitly opts in. */
  allowDelete: z.boolean().optional(),
});

export const ChangesetPreviewOpSchema = z.object({
  op: z.enum(['create', 'replace', 'patch', 'delete', 'mkdir']),
  path: z.string(),
  kind: z.enum(['add', 'modify', 'delete', 'mkdir']),
  preExists: z.boolean(),
  expectedSha: z.string().nullable(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  bytes: z.number(),
});

export const ProposeChangesetResponseSchema = z.object({
  tool: z.literal('fs.proposeChangeset'),
  proposalHash: z.string(),
  fileCount: z.number(),
  totalBytes: z.number(),
  /** The canonical changeset to apply — echoes ops with expectedSha filled. */
  changeset: ChangesetRequestSchema,
  ops: z.array(ChangesetPreviewOpSchema),
});

export const ApplyChangesetResponseSchema = z.object({
  tool: z.literal('fs.applyChangeset'),
  created: z.array(z.string()),
  modified: z.array(z.string()),
  deleted: z.array(z.string()),
  rolledBack: z.boolean(),
  /** Reverse material: previous content per touched file (null = created → undo = delete). */
  rollback: z.array(z.object({ path: z.string(), previousContent: z.string().nullable() })),
});

export type ChangeOp = z.infer<typeof ChangeOpSchema>;
export type ChangesetRequest = z.infer<typeof ChangesetRequestSchema>;
export type ProposeChangesetResponse = z.infer<typeof ProposeChangesetResponseSchema>;
export type ApplyChangesetResponse = z.infer<typeof ApplyChangesetResponseSchema>;

export const DiagnosticSeveritySchema = z.enum([
  'error',
  'warning',
  'information',
  'hint',
]);

export const DiagnosticsGetRequestSchema = z.object({
  rootPath: z.string().min(1),
  path: z.string().optional(),
});

export const DiagnosticItemSchema = z.object({
  path: z.string(),
  severity: DiagnosticSeveritySchema,
  code: z.string().nullable(),
  source: z.string().nullable(),
  message: z.string(),
  range: z.object({
    startLine: z.number().int().min(1),
    startCharacter: z.number().int().min(1),
    endLine: z.number().int().min(1),
    endCharacter: z.number().int().min(1),
  }),
});

export const DiagnosticsGetResponseSchema = z.object({
  tool: z.literal('diagnostics.get'),
  items: z.array(DiagnosticItemSchema),
});

export type DiagnosticsGetRequest = z.infer<typeof DiagnosticsGetRequestSchema>;
export type DiagnosticsGetResponse = z.infer<typeof DiagnosticsGetResponseSchema>;

export const DiagnosticsSyncRequestSchema = z.object({
  rootPath: z.string().min(1),
  items: z.array(DiagnosticItemSchema),
});

export type DiagnosticsSyncRequest = z.infer<typeof DiagnosticsSyncRequestSchema>;

export const ToolRequestSchemas = {
  'workspace.search': WorkspaceSearchRequestSchema,
  'file.readRange': FileReadRangeRequestSchema,
  'file.readSymbol': FileReadSymbolRequestSchema,
  'git.status': GitStatusRequestSchema,
  'git.diff': GitDiffRequestSchema,
  'edit.preview': EditPreviewRequestSchema,
  'edit.apply': EditApplyRequestSchema,
  'diagnostics.get': DiagnosticsGetRequestSchema,
} as const;

export const ToolResponseSchemas = {
  'workspace.search': WorkspaceSearchResponseSchema,
  'file.readRange': FileReadRangeResponseSchema,
  'file.readSymbol': FileReadSymbolResponseSchema,
  'git.status': GitStatusResponseSchema,
  'git.diff': GitDiffResponseSchema,
  'edit.preview': EditPreviewResponseSchema,
  'edit.apply': EditApplyResponseSchema,
  'diagnostics.get': DiagnosticsGetResponseSchema,
} as const;

// ── command.run — policy-allowlisted argv execution (build/test/debug) ────────
// The command is an argv ARRAY, never a shell string: no shell is involved, so
// there is no injection surface. The server enforces its own allowlist on
// argv[0] and containment on cwd — this schema only shapes the request.

export const CommandRunRequestSchema = z.object({
  rootPath: z.string().min(1),
  /** argv array; argv[0] must be a bare program name on the server allowlist. */
  command: z.array(z.string().min(1)).min(1),
  /** Optional working directory RELATIVE to rootPath (contained server-side). */
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});

export const CommandRunResponseSchema = z.object({
  tool: z.literal('command.run'),
  exitCode: z.number().nullable(),
  timedOut: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  /** True when stdout/stderr were capped to the server limit. */
  truncated: z.boolean(),
  durationMs: z.number(),
});

export type CommandRunRequest = z.infer<typeof CommandRunRequestSchema>;
export type CommandRunResponse = z.infer<typeof CommandRunResponseSchema>;

export type ToolRequestMap = {
  'command.run': CommandRunRequest;
  'workspace.search': WorkspaceSearchRequest;
  'file.readRange': FileReadRangeRequest;
  'file.readSymbol': FileReadSymbolRequest;
  'git.status': GitStatusRequest;
  'git.diff': GitDiffRequest;
  'edit.preview': EditPreviewRequest;
  'edit.apply': EditApplyRequest;
  'diagnostics.get': DiagnosticsGetRequest;
};

export type ToolResponseMap = {
  'command.run': CommandRunResponse;
  'workspace.search': WorkspaceSearchResponse;
  'file.readRange': FileReadRangeResponse;
  'file.readSymbol': FileReadSymbolResponse;
  'git.status': GitStatusResponse;
  'git.diff': GitDiffResponse;
  'edit.preview': EditPreviewResponse;
  'edit.apply': EditApplyResponse;
  'diagnostics.get': DiagnosticsGetResponse;
};