import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import {
  listEnvironmentConfigs,
  getEnvironmentConfig,
  createEnvironmentConfig,
  updateEnvironmentConfig,
  getEnvironmentSummary,
} from "@/lib/environment";
import type { EnvironmentTier, Prisma } from "@prisma/client";

export async function GET(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const configId = searchParams.get("configId");
  const summary = searchParams.get("summary");
  const tier = searchParams.get("tier") as EnvironmentTier | null;

  if (summary === "true") {
    const data = await getEnvironmentSummary();
    return NextResponse.json({ summary: data });
  }

  if (configId) {
    const config = await getEnvironmentConfig(configId);
    return NextResponse.json({ config });
  }

  const configs = await listEnvironmentConfigs(tier ?? undefined);
  return NextResponse.json({ configs });
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { tier, name, description, configJson, allowedOrgIds, isDefault, isolationLevel } = body as {
    tier: EnvironmentTier;
    name: string;
    description?: string;
    configJson: Prisma.InputJsonValue;
    allowedOrgIds?: string[];
    isDefault?: boolean;
    isolationLevel?: string;
  };

  if (!tier || !name || !configJson) {
    return NextResponse.json({ error: "tier, name, configJson required" }, { status: 400 });
  }

  const config = await createEnvironmentConfig({
    tier,
    name,
    description,
    configJson,
    allowedOrgIds,
    isDefault,
    isolationLevel,
  });

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "ENVIRONMENT_CONFIG_CREATED",
    resourceType: "EnvironmentConfig",
    resourceId: config.id,
    riskTier: 1,
  });

  return NextResponse.json({ config }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { configId, ...updates } = body as {
    configId: string;
    description?: string;
    configJson?: Prisma.InputJsonValue;
    allowedOrgIds?: string[];
    isDefault?: boolean;
    isActive?: boolean;
    isolationLevel?: string;
  };

  if (!configId) {
    return NextResponse.json({ error: "configId required" }, { status: 400 });
  }

  const updated = await updateEnvironmentConfig(configId, updates);

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "ENVIRONMENT_CONFIG_UPDATED",
    resourceType: "EnvironmentConfig",
    resourceId: configId,
    riskTier: 1,
  });

  return NextResponse.json({ config: updated });
}
