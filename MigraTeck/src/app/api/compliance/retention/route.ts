import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import {
  createRetentionPolicy,
  listRetentionPolicies,
  updateRetentionPolicy,
  enforceRetentionPolicy,
} from "@/lib/retention";
import { validateRetentionAgainstImmutability } from "@/lib/audit-rules";

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "compliance:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const policies = await listRetentionPolicies(ctx.orgId);
  return NextResponse.json({ policies });
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "compliance:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { entityType, retentionDays, action, description } = body as {
    entityType: string;
    retentionDays: number;
    action?: string;
    description?: string;
  };

  if (!entityType || !retentionDays) {
    return NextResponse.json({ error: "entityType and retentionDays required" }, { status: 400 });
  }

  // Validate against immutability rules
  const check = await validateRetentionAgainstImmutability(entityType, retentionDays);
  if (!check.allowed) {
    return NextResponse.json({ error: check.reason }, { status: 409 });
  }

  const policy = await createRetentionPolicy({
    entityType,
    retentionDays,
    action: action as "DELETE" | "ARCHIVE" | "ANONYMIZE" | undefined,
    orgId: ctx.orgId,
    description,
  });

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "RETENTION_POLICY_CREATED",
    resourceType: "RetentionPolicy",
    resourceId: policy.id,
    riskTier: 1,
  });

  return NextResponse.json({ policy }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "compliance:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { policyId, ...updates } = body as {
    policyId: string;
    retentionDays?: number;
    action?: string;
    isActive?: boolean;
    description?: string;
  };

  if (!policyId) {
    return NextResponse.json({ error: "policyId required" }, { status: 400 });
  }

  if (updates.retentionDays) {
    const policy = await listRetentionPolicies(ctx.orgId);
    const target = policy.find((p) => p.id === policyId);
    if (target) {
      const check = await validateRetentionAgainstImmutability(target.entityType, updates.retentionDays);
      if (!check.allowed) {
        return NextResponse.json({ error: check.reason }, { status: 409 });
      }
    }
  }

  const updated = await updateRetentionPolicy(policyId, {
    retentionDays: updates.retentionDays,
    action: updates.action as "DELETE" | "ARCHIVE" | "ANONYMIZE" | undefined,
    isActive: updates.isActive,
    description: updates.description,
  });

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "RETENTION_POLICY_UPDATED",
    resourceType: "RetentionPolicy",
    resourceId: policyId,
    riskTier: 1,
  });

  return NextResponse.json({ policy: updated });
}
