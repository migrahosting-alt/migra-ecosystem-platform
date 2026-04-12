import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { can } from "@/lib/rbac";
import { getActiveOrgContext } from "@/lib/auth/session";
import { pauseTask, resumeTask, cancelTask } from "@/lib/scheduler";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { taskId } = await params;
  const body = await request.json();

  let task;
  switch (body.action) {
    case "pause":
      task = await pauseTask(taskId);
      break;
    case "resume":
      task = await resumeTask(taskId);
      break;
    case "cancel":
      task = await cancelTask(taskId);
      break;
    default:
      return NextResponse.json({ error: "Invalid action. Use: pause, resume, cancel" }, { status: 400 });
  }

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: `SCHEDULED_TASK_${body.action.toUpperCase()}`,
    entityType: "ScheduledTask",
    entityId: taskId,
  });

  return NextResponse.json({ task });
}
