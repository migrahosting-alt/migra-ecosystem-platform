import { OrgRole } from "@prisma/client";
import { stepUpTier2Method } from "@/lib/env";
import { hashCanonicalPayload } from "@/lib/security/canonical";
import { assertIntent, MutationIntentError } from "@/lib/security/intent";
import { type MutationRiskTier, assertOperatorRiskAllowed } from "@/lib/security/operator-risk";
import { assertPlatformMutationAllowed } from "@/lib/security/platform-lockdown";

interface AssertMutationSecurityInput {
  actorUserId: string;
  actorRole?: OrgRole | null | undefined;
  orgId?: string | null | undefined;
  action: string;
  riskTier: MutationRiskTier;
  ip?: string | undefined;
  userAgent?: string | undefined;
  route?: string | undefined;
  intentId?: string | undefined;
  payload?: unknown | undefined;
  skipTier2IntentRequirement?: boolean | undefined;
}

export async function assertMutationSecurity(input: AssertMutationSecurityInput): Promise<void> {
  const platformInput = {
    action: input.action,
    actorUserId: input.actorUserId,
    ...(input.actorRole !== undefined ? { actorRole: input.actorRole } : {}),
    ...(input.orgId !== undefined ? { orgId: input.orgId } : {}),
    ...(input.ip !== undefined ? { ip: input.ip } : {}),
    ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    ...(input.route !== undefined ? { route: input.route } : {}),
  };

  await assertPlatformMutationAllowed(platformInput);

  await assertOperatorRiskAllowed({
    action: input.action,
    actorUserId: input.actorUserId,
    ...(input.actorRole !== undefined ? { actorRole: input.actorRole } : {}),
    ...(input.orgId !== undefined ? { orgId: input.orgId } : {}),
    ...(input.ip !== undefined ? { ip: input.ip } : {}),
    ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    ...(input.route !== undefined ? { route: input.route } : {}),
    riskTier: input.riskTier,
  });

  if (input.riskTier !== 2 || input.skipTier2IntentRequirement) {
    return;
  }

  if (!input.intentId) {
    throw new MutationIntentError("INTENT_REQUIRED", "Tier-2 intent is required.", 403);
  }

  const payloadHash = hashCanonicalPayload(input.payload ?? null);
  const runtimeStepUpMethod = process.env.STEP_UP_TIER2 || stepUpTier2Method;
  await assertIntent({
    intentId: input.intentId,
    actorId: input.actorUserId,
    orgId: input.orgId || null,
    action: input.action,
    payloadHash,
    ...(input.ip !== undefined ? { ip: input.ip } : {}),
    ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    requireStepUp: runtimeStepUpMethod !== "NONE",
  });
}
