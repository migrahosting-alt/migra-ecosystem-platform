import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import {
  createAuditRetentionRule,
  listAuditRetentionRules,
  updateAuditRetentionRule,
} from "@/lib/audit-rules";

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "compliance:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rules = await listAuditRetentionRules();
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "compliance:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { name, description, entityType, minRetentionDays, preventDeletion, preventModification, requireApproval } =
    body as {
      name: string;
      description?: string;
      entityType?: string;
      minRetentionDays?: number;
      preventDeletion?: boolean;
      preventModification?: boolean;
      requireApproval?: boolean;
    };

  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const rule = await createAuditRetentionRule({
    name,
    description,
    entityType,
    minRetentionDays,
    preventDeletion,
    preventModification,
    requireApproval,
  });

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "AUDIT_RETENTION_RULE_CREATED",
    resourceType: "AuditRetentionRule",
    resourceId: rule.id,
    riskTier: 1,
  });

  return NextResponse.json({ rule }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "compliance:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { ruleId, ...updates } = body as {
    ruleId: string;
    name?: string;
    description?: string;
    minRetentionDays?: number;
    preventDeletion?: boolean;
    preventModification?: boolean;
    requireApproval?: boolean;
    isActive?: boolean;
  };

  if (!ruleId) {
    return NextResponse.json({ error: "ruleId required" }, { status: 400 });
  }

  const updated = await updateAuditRetentionRule(ruleId, updates);

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "AUDIT_RETENTION_RULE_UPDATED",
    resourceType: "AuditRetentionRule",
    resourceId: ruleId,
    riskTier: 1,
  });

  return NextResponse.json({ rule: updated });
}
