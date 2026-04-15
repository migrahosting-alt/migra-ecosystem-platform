import { StepUpMethod } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { hashCanonicalPayload } from "@/lib/security/canonical";
import { stepUpTier2TtlSeconds } from "@/lib/env";

function currentStepUpMethod(): "NONE" | "REAUTH" | "TOTP" | "PASSKEY" {
  // Product-local password, TOTP, and passkey step-up are disabled.
  // MigraAuth owns step-up authentication and MFA for this application.
  return "NONE";
}

function currentIntentTtlSeconds(): number {
  const runtime = Number.parseInt(process.env.STEP_UP_TIER2_TTL_SECONDS || "", 10);
  if (Number.isFinite(runtime) && runtime > 0) {
    return runtime;
  }

  return stepUpTier2TtlSeconds;
}

export type IntentStepUpInput = {
  password?: string | undefined;
  totpCode?: string | undefined;
  passkeyAssertion?: string | undefined;
};

export class MutationIntentError extends Error {
  httpStatus: number;
  code: string;

  constructor(code: string, message: string, httpStatus = 403) {
    super(message);
    this.name = "MutationIntentError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

interface ResolveStepUpVerificationInput {
  actorId: string;
  stepUp?: IntentStepUpInput | undefined;
}

interface ResolveStepUpVerificationResult {
  stepUpMethod: StepUpMethod;
  stepUpVerifiedAt: Date | null;
}

async function resolveStepUpVerification(input: ResolveStepUpVerificationInput): Promise<ResolveStepUpVerificationResult> {
  void input;
  const method = currentStepUpMethod();

  if (method === "NONE") {
    return { stepUpMethod: StepUpMethod.NONE, stepUpVerifiedAt: null };
  }

  throw new MutationIntentError("STEP_UP_POLICY_INVALID", "Invalid step-up policy.", 500);
}

interface CreateMutationIntentInput {
  actorId: string;
  orgId?: string | null | undefined;
  action: string;
  payload: unknown;
  reason?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  stepUp?: IntentStepUpInput | undefined;
}

export async function createMutationIntent(input: CreateMutationIntentInput) {
  const stepUp = await resolveStepUpVerification({
    actorId: input.actorId,
    stepUp: input.stepUp,
  });

  const payloadHash = hashCanonicalPayload(input.payload);
  const expiresAt = new Date(Date.now() + currentIntentTtlSeconds() * 1000);

  const intent = await prisma.mutationIntent.create({
    data: {
      orgId: input.orgId || null,
      actorId: input.actorId,
      action: input.action,
      riskTier: 2,
      payloadHash,
      expiresAt,
      ...(input.ip != null ? { ip: input.ip } : {}),
      ...(input.userAgent != null ? { userAgent: input.userAgent } : {}),
      stepUpMethod: stepUp.stepUpMethod,
      stepUpVerifiedAt: stepUp.stepUpVerifiedAt,
      reason: input.reason || null,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    orgId: input.orgId || null,
    action: "MUTATION_INTENT_CREATED",
    resourceType: "mutation_intent",
    resourceId: intent.id,
    ip: input.ip,
    userAgent: input.userAgent,
    riskTier: 2,
    metadata: {
      action: input.action,
      stepUpMethod: intent.stepUpMethod,
      expiresAt: intent.expiresAt,
      reason: intent.reason,
    },
  });

  return {
    id: intent.id,
    expiresAt: intent.expiresAt,
    payloadHash,
    stepUpMethod: intent.stepUpMethod,
  };
}

interface AssertIntentInput {
  intentId: string;
  actorId: string;
  orgId?: string | null;
  action: string;
  payloadHash: string;
  ip?: string;
  userAgent?: string;
  requireStepUp?: boolean;
}

async function auditIntentDenied(input: AssertIntentInput, reason: string) {
  await writeAuditLog({
    actorId: input.actorId,
    orgId: input.orgId || null,
    action: "MUTATION_INTENT_DENIED",
    resourceType: "mutation_intent",
    resourceId: input.intentId,
    ip: input.ip,
    userAgent: input.userAgent,
    riskTier: 2,
    metadata: {
      action: input.action,
      reason,
    },
  });
}

export async function assertIntent(input: AssertIntentInput): Promise<void> {
  const now = new Date();

  const consumed = await prisma.mutationIntent.updateMany({
    where: {
      id: input.intentId,
      actorId: input.actorId,
      orgId: input.orgId || null,
      action: input.action,
      payloadHash: input.payloadHash,
      usedAt: null,
      expiresAt: {
        gt: now,
      },
      ...(input.requireStepUp ? { stepUpVerifiedAt: { not: null } } : {}),
    },
    data: {
      usedAt: now,
    },
  });

  if (consumed.count === 1) {
    await writeAuditLog({
      actorId: input.actorId,
      orgId: input.orgId || null,
      action: "MUTATION_INTENT_CONSUMED",
      resourceType: "mutation_intent",
      resourceId: input.intentId,
      ip: input.ip,
      userAgent: input.userAgent,
      riskTier: 2,
      metadata: {
        action: input.action,
      },
    });

    return;
  }

  const row = await prisma.mutationIntent.findUnique({
    where: {
      id: input.intentId,
    },
    select: {
      actorId: true,
      orgId: true,
      action: true,
      payloadHash: true,
      usedAt: true,
      expiresAt: true,
      stepUpVerifiedAt: true,
    },
  });

  if (!row) {
    await auditIntentDenied(input, "intent_not_found");
    throw new MutationIntentError("INTENT_NOT_FOUND", "Tier-2 intent is invalid.", 403);
  }

  if (row.actorId !== input.actorId) {
    await auditIntentDenied(input, "actor_mismatch");
    throw new MutationIntentError("ACTOR_MISMATCH", "Tier-2 intent is invalid.", 403);
  }

  if ((row.orgId || null) !== (input.orgId || null)) {
    await auditIntentDenied(input, "org_mismatch");
    throw new MutationIntentError("ORG_MISMATCH", "Tier-2 intent is invalid.", 403);
  }

  if (row.action !== input.action) {
    await auditIntentDenied(input, "action_mismatch");
    throw new MutationIntentError("ACTION_MISMATCH", "Tier-2 intent is invalid.", 403);
  }

  if (row.payloadHash !== input.payloadHash) {
    await auditIntentDenied(input, "payload_mismatch");
    throw new MutationIntentError("PAYLOAD_MISMATCH", "Tier-2 intent is invalid.", 403);
  }

  if (row.usedAt) {
    await auditIntentDenied(input, "intent_reused");
    throw new MutationIntentError("INTENT_REUSED", "Tier-2 intent is invalid.", 403);
  }

  if (row.expiresAt <= now) {
    await auditIntentDenied(input, "intent_expired");
    throw new MutationIntentError("INTENT_EXPIRED", "Tier-2 intent is invalid.", 403);
  }

  if (input.requireStepUp && !row.stepUpVerifiedAt) {
    await auditIntentDenied(input, "step_up_missing");
    throw new MutationIntentError("STEP_UP_REQUIRED", "Tier-2 intent is invalid.", 403);
  }

  await auditIntentDenied(input, "intent_validation_failed");
  throw new MutationIntentError("INTENT_INVALID", "Tier-2 intent is invalid.", 403);
}
