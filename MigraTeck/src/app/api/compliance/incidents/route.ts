import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import {
  createIncident,
  listIncidents,
  getIncident,
  updateIncidentStatus,
  getIncidentSummary,
} from "@/lib/compliance-runbooks";
import type { IncidentSeverity, IncidentStatus } from "@prisma/client";

export async function GET(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "incidents:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const incidentId = searchParams.get("incidentId");
  const summary = searchParams.get("summary");

  if (summary === "true") {
    const data = await getIncidentSummary();
    return NextResponse.json({ summary: data });
  }

  if (incidentId) {
    const incident = await getIncident(incidentId);
    return NextResponse.json({ incident });
  }

  const severity = searchParams.get("severity") as IncidentSeverity | null;
  const status = searchParams.get("status") as IncidentStatus | null;

  const incidents = await listIncidents({
    orgId: ctx.orgId,
    severity: severity ?? undefined,
    status: status ?? undefined,
  });
  return NextResponse.json({ incidents });
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "incidents:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { title, severity, description, impact, runbookId, assignedToId } = body as {
    title: string;
    severity: IncidentSeverity;
    description?: string;
    impact?: string;
    runbookId?: string;
    assignedToId?: string;
  };

  if (!title || !severity) {
    return NextResponse.json({ error: "title and severity required" }, { status: 400 });
  }

  const incident = await createIncident({
    orgId: ctx.orgId,
    title,
    severity,
    description,
    impact,
    runbookId,
    reportedById: auth.session.user.id,
    assignedToId,
  });

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "INCIDENT_CREATED",
    resourceType: "IncidentRecord",
    resourceId: incident.id,
    riskTier: 1,
    metadata: { severity } as Prisma.InputJsonValue,
  });

  return NextResponse.json({ incident }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "incidents:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { incidentId, status, rootCause, mitigationSteps, postMortemUrl, timeline } = body as {
    incidentId: string;
    status: IncidentStatus;
    rootCause?: string;
    mitigationSteps?: string;
    postMortemUrl?: string;
    timeline?: Prisma.InputJsonValue;
  };

  if (!incidentId || !status) {
    return NextResponse.json({ error: "incidentId and status required" }, { status: 400 });
  }

  const updated = await updateIncidentStatus(incidentId, status, {
    rootCause,
    mitigationSteps,
    postMortemUrl,
    timeline,
  });

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: `INCIDENT_STATUS_${status}`,
    resourceType: "IncidentRecord",
    resourceId: incidentId,
    riskTier: 1,
  });

  return NextResponse.json({ incident: updated });
}
