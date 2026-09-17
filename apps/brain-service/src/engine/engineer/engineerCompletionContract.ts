import { z } from 'zod';

/**
 * Controller-owned repository completion obligations.
 *
 * This module is the single durable/runtime contract for obligation identity.
 * Persistence must never widen these IDs to arbitrary strings because restored
 * completion evidence becomes controller authority after a Brain restart.
 */
export const COMPLETION_OBLIGATION_IDS = [
  'repo.root',
  'repo.git_state',
  'repo.top_level',
  'repo.manifest_contents',
  'repo.framework_runtime',
  'repo.source_tree',
  'repo.entrypoint',
  'repo.tests',
  'repo.deployment_runtime',
] as const;

export type CompletionObligationId =
  (typeof COMPLETION_OBLIGATION_IDS)[number];

export const CompletionObligationIdSchema = z.enum(
  COMPLETION_OBLIGATION_IDS,
);

export interface CompletionEvidenceSnapshot {
  enabled: boolean;
  satisfied: CompletionObligationId[];
  evidence: Array<[CompletionObligationId, string[]]>;
}
