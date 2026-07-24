import { z } from 'zod';

export const AgentModeStateSchema = z.enum([
  'IDLE',
  'PLANNING',
  'AWAITING_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'STALE',
  'FAILED',
  'CANCELLED',
]);

export const AgentModeRecipeIdSchema = z.enum([
  'git.status',
  'git.diff',
]);

export const AgentModeApprovalLifecycleSchema = z.enum([
  'NOT_REQUESTED',
  'PENDING_DISPLAY',
  'DISPLAYED',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'INVALIDATED',
  'LOST_ON_RESTART',
  'CONSUMED',
]);

export const AgentModeRecoveryClassSchema = z.enum([
  'NONE',
  'REPROPOSAL_ALLOWED',
  'REPROPOSAL_REQUIRED',
  'TERMINAL_NO_RECOVERY',
  'WORKSPACE_MISMATCH',
  'POLICY_CHANGED',
  'SNAPSHOT_CHANGED',
  'RECIPE_DISABLED',
  'AUTHORIZATION_LOST',
  'INTERRUPTED_EXECUTION',
  'RETENTION_REMOVED',
  'SCHEMA_INCOMPATIBLE',
]);

export const AgentModeBootstrapRequestSchema = z.object({
  bootstrapSecret: z.string().min(32).max(512),
  activationId: z.string().uuid(),
  extensionProcessId: z.number().int().positive(),
  bootstrapMode: z.enum(['inherited', 'pairing']),
  workspaceRoot: z.string().min(1).max(4096),
}).strict();

export const AgentModeBootstrapResponseSchema = z.object({
  activationCapability: z.string().min(32),
  activationId: z.string().uuid(),
  serverInstanceId: z.string(),
  canonicalWorkspace: z.string(),
  allowedRecipes: z.array(AgentModeRecipeIdSchema),
  issuedAt: z.number(),
  expiresAt: z.number(),
}).strict();

export const AgentModeCommandProposalRequestSchema = z.object({
  rootPath: z.string().min(1).max(4096),
  recipe: AgentModeRecipeIdSchema,
  reason: z.string().trim().min(1).max(500),
}).strict();

export const AgentModeEnvironmentEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
  redacted: z.boolean(),
});

export const AgentModeCommandPreviewSchema = z.object({
  recipe: AgentModeRecipeIdSchema,
  policyVersion: z.string(),
  executionIdentity: z.string(),
  environmentPolicy: z.string(),
  workspaceMaterialFingerprint: z.string(),
  snapshotId: z.string(),
  sourceWorkspace: z.string(),
  executable: z.string(),
  arguments: z.array(z.string()),
  cwd: z.string(),
  timeoutMs: z.number().int().positive(),
  outputLimitBytes: z.number().int().positive(),
  mutationClassification: z.enum(['read-only', 'workspace-write-possible']),
  networkPolicy: z.enum(['not-required', 'not-enforced']),
  expectedEffects: z.array(z.string()),
  reason: z.string(),
  requestId: z.string(),
  fingerprint: z.string(),
  expiresAt: z.number(),
  warnings: z.array(z.string()),
  environment: z.array(AgentModeEnvironmentEntrySchema),
  canModifyFiles: z.boolean(),
}).strict();

export const AgentModeCommandResultSchema = z.object({
  recipe: AgentModeRecipeIdSchema,
  exitCode: z.number().nullable(),
  timedOut: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.boolean(),
  redacted: z.boolean(),
  durationMs: z.number(),
}).strict();

export const AgentModeCommandRunViewSchema = z.object({
  runId: z.string(),
  requestId: z.string(),
  state: AgentModeStateSchema,
  preview: AgentModeCommandPreviewSchema.optional(),
  result: AgentModeCommandResultSchema.optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  approval: z.object({
    lifecycle: AgentModeApprovalLifecycleSchema,
    requestedAt: z.number().optional(),
    displayedAt: z.number().optional(),
    decisionAt: z.number().optional(),
    decision: z.enum(['APPROVED', 'REJECTED']).optional(),
    expiresAt: z.number().optional(),
    invalidationReason: z.string().optional(),
    actorRef: z.string().optional(),
  }).optional(),
  recovery: z.object({
    classification: AgentModeRecoveryClassSchema,
    eligible: z.boolean(),
    reason: z.string().optional(),
    sourceRunId: z.string().optional(),
    successorRunId: z.string().optional(),
    attemptCount: z.number().int().nonnegative().optional(),
    lastRequestId: z.string().optional(),
    terminalReason: z.string().optional(),
  }).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict();

export const AgentModeDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  fingerprint: z.string().min(1),
}).strict();

export const AgentModeDisplaySchema = z.object({
  fingerprint: z.string().min(1),
}).strict();

export const AgentModeRunRecoveryStatusSchema = z.object({
  runId: z.string(),
  sourceState: AgentModeStateSchema,
  approvalLifecycle: AgentModeApprovalLifecycleSchema,
  terminalReason: z.string().optional(),
  recoveryClass: AgentModeRecoveryClassSchema,
  eligible: z.boolean(),
  explanation: z.string(),
  currentRecipeAvailable: z.boolean(),
  workspaceMatches: z.boolean(),
  activeSuccessorRunId: z.string().optional(),
  recommendedAction: z.string(),
  lineage: z.object({
    sourceRunId: z.string().optional(),
    successorRunId: z.string().optional(),
  }),
}).strict();

export const AgentModeReproposalRequestSchema = z.object({
  requestId: z.string().trim().min(8).max(128),
  reason: z.string().trim().min(1).max(200).optional(),
}).strict();

export const AgentModeHistoryIntegritySchema = z.enum([
  'TRUSTED',
  'WARNING',
  'UNTRUSTED',
]);

export const AgentModeHistorySortSchema = z.enum(['updatedAt.desc', 'requestedAt.desc', 'terminalAt.desc']);

export const AgentModeRunHistoryQuerySchema = z.object({
  state: AgentModeStateSchema.optional(),
  recipe: AgentModeRecipeIdSchema.optional(),
  recoveryClass: AgentModeRecoveryClassSchema.optional(),
  recoveryEligible: z.boolean().optional(),
  from: z.number().int().nonnegative().optional(),
  to: z.number().int().nonnegative().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  sort: AgentModeHistorySortSchema.default('updatedAt.desc'),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().min(16).max(2048).optional(),
}).strict();

export const AgentModeRunHistorySummarySchema = z.object({
  runId: z.string(),
  requestId: z.string(),
  state: AgentModeStateSchema,
  recipe: AgentModeRecipeIdSchema,
  requestedAt: z.number(),
  updatedAt: z.number(),
  terminalAt: z.number().optional(),
  approvalLifecycle: AgentModeApprovalLifecycleSchema,
  recoveryClass: AgentModeRecoveryClassSchema,
  recoveryEligible: z.boolean(),
  recoveryReason: z.string().optional(),
  recoverySourceRunId: z.string().optional(),
  successorRunId: z.string().optional(),
  snapshotId: z.string(),
  mutationClassification: z.string(),
  networkPolicy: z.string(),
  eventCount: z.number().int().nonnegative(),
  integrity: AgentModeHistoryIntegritySchema,
  integrityIssues: z.array(z.string()),
}).strict();

export const AgentModeRunHistoryListSchema = z.object({
  runs: z.array(AgentModeRunHistorySummarySchema),
  nextCursor: z.string().optional(),
  query: AgentModeRunHistoryQuerySchema,
  retention: z.object({
    terminalRetentionMs: z.number().int().nonnegative(),
    retentionBatchSize: z.number().int().positive(),
    tombstoneCount: z.number().int().nonnegative(),
    governance: z.enum(['READ_ONLY']),
  }).strict(),
}).strict();

export const AgentModeRunHistoryEventSchema = z.object({
  eventId: z.string(),
  seq: z.number().int().positive(),
  at: z.number(),
  type: z.string(),
  priorState: AgentModeStateSchema.optional(),
  nextState: AgentModeStateSchema,
  reason: z.string().optional(),
  source: z.enum(['API', 'APPROVAL', 'EXECUTION', 'RECONCILIATION', 'SHUTDOWN', 'CLEANUP', 'RECOVERY']),
}).strict();

export const AgentModeRunHistoryLineageSchema = z.object({
  sourceRunId: z.string().optional(),
  successorRunId: z.string().optional(),
  source: AgentModeRunHistorySummarySchema.optional(),
  successor: AgentModeRunHistorySummarySchema.optional(),
}).strict();

export const AgentModeRunHistoryDetailSchema = z.object({
  summary: AgentModeRunHistorySummarySchema,
  preview: AgentModeCommandPreviewSchema.optional(),
  result: AgentModeCommandResultSchema.optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  timeline: z.array(AgentModeRunHistoryEventSchema),
  lineage: AgentModeRunHistoryLineageSchema,
  recovery: AgentModeRunRecoveryStatusSchema.optional(),
  retention: z.object({
    eligibleForDeletion: z.boolean(),
    reason: z.string(),
    tombstone: z.object({
      runId: z.string(),
      finalState: AgentModeStateSchema,
      terminalAt: z.number(),
      deletedAt: z.number(),
      deletionReason: z.string(),
      finalAuditSeq: z.number().int().nonnegative(),
      eventCount: z.number().int().nonnegative(),
    }).optional(),
  }).strict(),
}).strict();

export const AgentModeRunHistoryExportRequestSchema = z.object({
  includeTimeline: z.boolean().default(true),
  includePreview: z.boolean().default(true),
  includeResultSummary: z.boolean().default(true),
}).strict();

export const AgentModeRunHistoryExportSchema = z.object({
  runId: z.string(),
  generatedAt: z.number(),
  mediaType: z.literal('application/vnd.migrapilot.agent-run-evidence+json;v=1'),
  manifest: z.object({
    digest: z.string(),
    algorithm: z.literal('sha256'),
    canonicalBytes: z.number().int().nonnegative(),
    schemaVersion: z.literal(1),
    redaction: z.literal('sanitized-history-only'),
  }).strict(),
  body: AgentModeRunHistoryDetailSchema,
}).strict();

export type AgentModeState = z.infer<typeof AgentModeStateSchema>;
export type AgentModeRecipeId = z.infer<typeof AgentModeRecipeIdSchema>;
export type AgentModeApprovalLifecycle = z.infer<typeof AgentModeApprovalLifecycleSchema>;
export type AgentModeRecoveryClass = z.infer<typeof AgentModeRecoveryClassSchema>;
export type AgentModeBootstrapRequest = z.infer<typeof AgentModeBootstrapRequestSchema>;
export type AgentModeBootstrapResponse = z.infer<typeof AgentModeBootstrapResponseSchema>;
export type AgentModeCommandProposalRequest = z.infer<typeof AgentModeCommandProposalRequestSchema>;
export type AgentModeCommandPreview = z.infer<typeof AgentModeCommandPreviewSchema>;
export type AgentModeCommandResult = z.infer<typeof AgentModeCommandResultSchema>;
export type AgentModeCommandRunView = z.infer<typeof AgentModeCommandRunViewSchema>;
export type AgentModeDecision = z.infer<typeof AgentModeDecisionSchema>;
export type AgentModeRunRecoveryStatus = z.infer<typeof AgentModeRunRecoveryStatusSchema>;
export type AgentModeReproposalRequest = z.infer<typeof AgentModeReproposalRequestSchema>;
export type AgentModeRunHistoryQuery = z.infer<typeof AgentModeRunHistoryQuerySchema>;
export type AgentModeRunHistorySummary = z.infer<typeof AgentModeRunHistorySummarySchema>;
export type AgentModeRunHistoryList = z.infer<typeof AgentModeRunHistoryListSchema>;
export type AgentModeRunHistoryEvent = z.infer<typeof AgentModeRunHistoryEventSchema>;
export type AgentModeRunHistoryLineage = z.infer<typeof AgentModeRunHistoryLineageSchema>;
export type AgentModeRunHistoryDetail = z.infer<typeof AgentModeRunHistoryDetailSchema>;
export type AgentModeRunHistoryExportRequest = z.infer<typeof AgentModeRunHistoryExportRequestSchema>;
export type AgentModeRunHistoryExport = z.infer<typeof AgentModeRunHistoryExportSchema>;
