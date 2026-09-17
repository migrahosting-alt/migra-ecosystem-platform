import { z } from 'zod';
import {
  CompletionObligationIdSchema,
  type CompletionEvidenceSnapshot,
} from './engineerCompletionContract.js';

/**
 * Durable semantic checkpoint for MigraPilot Engineer.
 *
 * This is NOT a second task/controller system. `runEngineerTask()` remains the
 * sole execution authority. The checkpoint merely preserves controller-owned
 * semantic state across a Brain restart.
 *
 * R2 scope is intentionally read-only inspection:
 *   - plan
 *   - controller completion evidence
 *   - successful read-only observations
 *   - repository snapshot
 *
 * Explicitly NOT trusted/persisted as continuation authority:
 *   - approval tokens
 *   - command/process identities
 *   - in-flight delegated calls
 *   - provider stream state
 *   - unreconciled mutations
 */

export const ENGINEER_CHECKPOINT_VERSION = 1 as const;

export type EngineerCheckpointStatus =
  | 'RUNNING'
  | 'INTERRUPTED'
  | 'COMPLETED'
  | 'FAILED';

export interface EngineerCheckpointObservationV1 {
  tool: string;
  input: unknown;
  result: unknown;
}

export interface EngineerCheckpointPlanStepV1 {
  text: string;
  done: boolean;
}

export interface EngineerWorkspaceSnapshotV1 {
  gitHead: string | null;
  gitBranch: string | null;
  dirtyFingerprint: string | null;
}

export interface EngineerCheckpointPayloadV1 {
  taskStateVersion: typeof ENGINEER_CHECKPOINT_VERSION;

  correlationId: string;

  rootPath: string;
  objective: string;
  intent: string;

  plan: EngineerCheckpointPlanStepV1[];
  completionEvidence: CompletionEvidenceSnapshot;

  /**
   * Successful read-only observations only.
   *
   * They exist so a resumed model receives the facts that justified the
   * controller's restored evidence state without replaying all inspection work.
   */
  observations: EngineerCheckpointObservationV1[];

  workspaceSnapshot: EngineerWorkspaceSnapshotV1;

  resumeEpoch: number;
  status: EngineerCheckpointStatus;

  createdAt: string;
  updatedAt: string;
}

export interface EngineerCheckpointScope {
  owner: string;
  workspace: string;
}

export interface EngineerCheckpointRecord {
  scope: EngineerCheckpointScope;
  checkpoint: EngineerCheckpointPayloadV1;
}


const EngineerCheckpointStatusSchema = z.enum([
  'RUNNING',
  'INTERRUPTED',
  'COMPLETED',
  'FAILED',
]);

const EngineerCheckpointObservationV1Schema = z
  .object({
    tool: z.string().min(1),
    input: z.unknown(),
    result: z.unknown(),
  })
  .strict();

const EngineerWorkspaceSnapshotV1Schema = z
  .object({
    gitHead: z.string().nullable(),
    gitBranch: z.string().nullable(),
    dirtyFingerprint: z.string().nullable(),
  })
  .strict();

const EngineerCheckpointPayloadV1Schema = z
  .object({
    taskStateVersion: z.literal(ENGINEER_CHECKPOINT_VERSION),

    correlationId: z.string().min(1),

    rootPath: z.string().min(1),
    objective: z.string().min(1),
    intent: z.string().min(1),

    plan: z.array(
      z
        .object({
          text: z.string(),
          done: z.boolean(),
        })
        .strict(),
    ),
    completionEvidence: z
      .object({
        enabled: z.boolean(),
        satisfied: z.array(CompletionObligationIdSchema),
        evidence: z.array(
          z.tuple([
            CompletionObligationIdSchema,
            z.array(z.string()),
          ]),
        ),
      })
      .strict(),

    observations: z.array(EngineerCheckpointObservationV1Schema),

    workspaceSnapshot: EngineerWorkspaceSnapshotV1Schema,

    resumeEpoch: z.number().int().nonnegative(),
    status: EngineerCheckpointStatusSchema,

    createdAt: z.string().refine(
      (value) => Number.isFinite(Date.parse(value)),
      'createdAt must be a valid timestamp',
    ),
    updatedAt: z.string().refine(
      (value) => Number.isFinite(Date.parse(value)),
      'updatedAt must be a valid timestamp',
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['updatedAt'],
        message: 'updatedAt cannot precede createdAt',
      });
    }
  });

/**
 * Decode durable Engineer state before it is allowed to become controller
 * continuation authority.
 *
 * A TypeScript cast is not validation: PostgreSQL JSON may be stale, malformed,
 * partially migrated, or written by a future incompatible version.
 */
export function decodeEngineerCheckpointPayloadV1(
  raw: unknown,
): EngineerCheckpointPayloadV1 {
  const parsed = EngineerCheckpointPayloadV1Schema.safeParse(raw);

  if (!parsed.success) {
    throw new Error('INVALID_ENGINEER_CHECKPOINT_PAYLOAD');
  }

  const value = parsed.data;

  return {
    taskStateVersion: value.taskStateVersion,
    correlationId: value.correlationId,
    rootPath: value.rootPath,
    objective: value.objective,
    intent: value.intent,
    plan: value.plan,
    completionEvidence: value.completionEvidence,
    observations: value.observations.map((observation) => ({
      tool: observation.tool,
      input: observation.input,
      result: observation.result,
    })),
    workspaceSnapshot: {
      gitHead: value.workspaceSnapshot.gitHead,
      gitBranch: value.workspaceSnapshot.gitBranch,
      dirtyFingerprint: value.workspaceSnapshot.dirtyFingerprint,
    },
    resumeEpoch: value.resumeEpoch,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}


export interface EngineerCheckpointStore {
  save(
    scope: EngineerCheckpointScope,
    checkpoint: EngineerCheckpointPayloadV1,
  ): Promise<void>;

  load(
    scope: EngineerCheckpointScope,
    correlationId: string,
  ): Promise<EngineerCheckpointPayloadV1 | null>;

  markStatus(
    scope: EngineerCheckpointScope,
    correlationId: string,
    status: EngineerCheckpointStatus,
    updatedAt: string,
  ): Promise<boolean>;
}
