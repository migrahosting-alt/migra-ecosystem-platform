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

export type AgentModeState = z.infer<typeof AgentModeStateSchema>;
export type AgentModeRecipeId = z.infer<typeof AgentModeRecipeIdSchema>;
export type AgentModeBootstrapRequest = z.infer<typeof AgentModeBootstrapRequestSchema>;
export type AgentModeBootstrapResponse = z.infer<typeof AgentModeBootstrapResponseSchema>;
export type AgentModeCommandProposalRequest = z.infer<typeof AgentModeCommandProposalRequestSchema>;
export type AgentModeCommandPreview = z.infer<typeof AgentModeCommandPreviewSchema>;
export type AgentModeCommandResult = z.infer<typeof AgentModeCommandResultSchema>;
export type AgentModeCommandRunView = z.infer<typeof AgentModeCommandRunViewSchema>;
export type AgentModeDecision = z.infer<typeof AgentModeDecisionSchema>;
