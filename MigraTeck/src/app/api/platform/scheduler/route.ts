import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { can } from "@/lib/rbac";
import { getActiveOrgContext } from "@/lib/auth/session";
import { listScheduledTasks, createScheduledTask } from "@/lib/scheduler";
import { writeAuditLog } from "@/lib/audit";
import { Prisma, ScheduledTaskStatus } from "@prisma/client";

export async function GET(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") as ScheduledTaskStatus | null;

  const tasks = await listScheduledTasks(status ?? undefined);
  return NextResponse.json({ tasks });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  if (!body.name || !body.handler) {
    return NextResponse.json({ error: "name and handler are required" }, { status: 400 });
  }

  if (!body.cronExpression && !body.runAt) {
    return NextResponse.json({ error: "Either cronExpression or runAt is required" }, { status: 400 });
  }

  const task = await createScheduledTask({
    name: body.name,
    description: body.description,
    cronExpression: body.cronExpression,
    runAt: body.runAt ? new Date(body.runAt) : undefined,
    handler: body.handler,
    payload: body.payload as Prisma.InputJsonValue | undefined,
    maxRetries: body.maxRetries,
    timeoutSeconds: body.timeoutSeconds,
  });

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "SCHEDULED_TASK_CREATE",
    entityType: "ScheduledTask",
    entityId: task.id,
  });

  return NextResponse.json({ task }, { status: 201 });
}
