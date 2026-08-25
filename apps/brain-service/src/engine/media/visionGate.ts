import type { PoolClient } from 'pg';

import {
  approvedForCapability,
  type ModelCapability,
  type QualificationDecision,
} from '../persistence/postgres/modelQualificationRepo.js';
import {
  classifyVisualOperation,
  unqualifiedOperationMessage,
  type VisualOperation,
} from './visualOperation.js';

/**
 * The decision to serve an image turn, or to refuse it truthfully.
 *
 * THE DURABLE TABLE IS THE AUTHORITY, NOT THE MANIFEST. `model-qualification.json`
 * is a deployment artefact: anyone who can write the file can promote a model.
 * This reads `model_qualification_decisions` — an approval naming a human, a
 * digest, and the evidence run behind it — so revoking is a write that takes
 * effect on the NEXT REQUEST, with no restart and no cache to go stale. A cached
 * answer outlives the revocation that should have ended it, and the moment you
 * revoke a model is exactly when that does the most damage.
 *
 * FAIL-CLOSED. No approval means no vision turn. Not "fall back to any installed
 * vision model" — installed is not qualified, and the whole point of the
 * governance is that the difference is enforced rather than remembered.
 */

export type VisionGateOutcome =
  | { serve: true; operation: VisualOperation; capability: ModelCapability; modelId: string; decision: QualificationDecision }
  | { serve: false; operation: VisualOperation; capability: ModelCapability; reason: 'no_qualified_model'; message: string };

export interface VisionGateDeps {
  transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

/**
 * Decide what may answer this image turn.
 *
 * The prompt chooses the CAPABILITY and the capability chooses the MODEL — not
 * the other way round. Picking a vision model first and then hoping it can
 * handle whatever was asked is how "vision-capable" came to mean "will answer
 * anything about a picture".
 */
export async function gateVisionTurn(
  deps: VisionGateDeps,
  prompt: string | undefined | null,
): Promise<VisionGateOutcome> {
  const { operation, capability } = classifyVisualOperation(prompt);

  const approved = await deps.transaction((client) => approvedForCapability(client, capability));
  const live = approved[0];

  if (!live) {
    return {
      serve: false,
      operation,
      capability,
      reason: 'no_qualified_model',
      message: unqualifiedOperationMessage(operation),
    };
  }

  return { serve: true, operation, capability, modelId: live.modelId, decision: live };
}

/**
 * What the capability endpoint reports, per operation.
 *
 * Two answers, because one boolean cannot describe a model that reads a document
 * perfectly and cannot count what is on it. A UI that offers image upload should
 * know the first; a UI that offers "count these" should know the second.
 */
export async function visionCapabilitySnapshot(deps: VisionGateDeps): Promise<{
  general: { qualified: boolean; modelId: string | null; digest: string | null };
  objectCounting: { qualified: boolean; modelId: string | null };
}> {
  const [general, counting] = await deps.transaction(async (client) => [
    await approvedForCapability(client, 'vision.general'),
    await approvedForCapability(client, 'vision.object_counting'),
  ]);
  return {
    general: {
      qualified: general.length > 0,
      modelId: general[0]?.modelId ?? null,
      // The digest travels with the answer: "approved" is about these exact
      // bytes, and a tag repointed at different weights is a different model.
      digest: general[0]?.modelDigest ?? null,
    },
    objectCounting: {
      qualified: counting.length > 0,
      modelId: counting[0]?.modelId ?? null,
    },
  };
}
