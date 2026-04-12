import { Prisma, ScheduledTaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Types ──────────────────────────────────────────────────────────────

export interface CreateScheduledTaskInput {
  name: string;
  description?: string | undefined;
  cronExpression?: string | undefined;
  runAt?: Date | undefined;
  handler: string;
  payload?: Prisma.InputJsonValue | undefined;
  maxRetries?: number | undefined;
  timeoutSeconds?: number | undefined;
}

type TaskHandler = (payload: Prisma.JsonValue | null) => Promise<void>;

// ─── Handler Registry ───────────────────────────────────────────────────

const taskHandlers = new Map<string, TaskHandler>();

export function registerTaskHandler(handlerName: string, handler: TaskHandler) {
  taskHandlers.set(handlerName, handler);
}

// ─── Cron Expression Parser ─────────────────────────────────────────────

function parseCronField(field: string, min: number, max: number): number[] {
  if (field === "*") {
    return Array.from({ length: max - min + 1 }, (_, i) => i + min);
  }

  const values: number[] = [];

  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr!, 10);
      let start = min;
      let end = max;
      if (range !== "*" && range !== undefined) {
        if (range.includes("-")) {
          const [s, e] = range.split("-");
          start = parseInt(s!, 10);
          end = parseInt(e!, 10);
        } else {
          start = parseInt(range, 10);
        }
      }
      for (let i = start; i <= end; i += step) values.push(i);
    } else if (part.includes("-")) {
      const [s, e] = part.split("-");
      for (let i = parseInt(s!, 10); i <= parseInt(e!, 10); i++) values.push(i);
    } else {
      values.push(parseInt(part, 10));
    }
  }

  return values.filter((v) => v >= min && v <= max);
}

export function getNextCronRun(cronExpr: string, after: Date = new Date()): Date {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${cronExpr}`);

  const minutes = parseCronField(parts[0]!, 0, 59);
  const hours = parseCronField(parts[1]!, 0, 23);
  const daysOfMonth = parseCronField(parts[2]!, 1, 31);
  const months = parseCronField(parts[3]!, 1, 12);
  const daysOfWeek = parseCronField(parts[4]!, 0, 6);

  const start = new Date(after);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  // Search up to 366 days ahead
  for (let dayOffset = 0; dayOffset < 366; dayOffset++) {
    const candidate = new Date(start);
    candidate.setDate(candidate.getDate() + dayOffset);

    if (!months.includes(candidate.getMonth() + 1)) continue;
    if (!daysOfMonth.includes(candidate.getDate()) && !daysOfWeek.includes(candidate.getDay())) continue;

    for (const h of hours) {
      for (const m of minutes) {
        const target = new Date(candidate);
        target.setHours(h, m, 0, 0);
        if (target > after) return target;
      }
    }
  }

  throw new Error(`Cannot find next cron run for: ${cronExpr}`);
}

// ─── CRUD ───────────────────────────────────────────────────────────────

export async function createScheduledTask(input: CreateScheduledTaskInput) {
  let nextRunAt: Date | undefined;

  if (input.runAt) {
    nextRunAt = input.runAt;
  } else if (input.cronExpression) {
    nextRunAt = getNextCronRun(input.cronExpression);
  }

  const data: Record<string, unknown> = {
    name: input.name,
    handler: input.handler,
    maxRetries: input.maxRetries ?? 3,
    timeoutSeconds: input.timeoutSeconds ?? 300,
  };
  if (input.description !== undefined) data.description = input.description;
  if (input.cronExpression !== undefined) data.cronExpression = input.cronExpression;
  if (input.runAt !== undefined) data.runAt = input.runAt;
  if (input.payload !== undefined) data.payload = input.payload;
  if (nextRunAt !== undefined) data.nextRunAt = nextRunAt;

  return prisma.scheduledTask.create({ data: data as Parameters<typeof prisma.scheduledTask.create>[0]["data"] });
}

export async function listScheduledTasks(status?: ScheduledTaskStatus) {
  const where = status ? { status } : {};
  return prisma.scheduledTask.findMany({
    where,
    orderBy: { nextRunAt: "asc" },
  });
}

export async function pauseTask(taskId: string) {
  return prisma.scheduledTask.update({
    where: { id: taskId },
    data: { status: "PAUSED" },
  });
}

export async function resumeTask(taskId: string) {
  const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });

  let nextRunAt: Date | undefined;
  if (task.cronExpression) {
    nextRunAt = getNextCronRun(task.cronExpression);
  } else if (task.runAt && task.runAt > new Date()) {
    nextRunAt = task.runAt;
  }

  const resumeData: Record<string, unknown> = {
    status: "ACTIVE",
    retryCount: 0,
    lastError: null,
  };
  if (nextRunAt !== undefined) resumeData.nextRunAt = nextRunAt;

  return prisma.scheduledTask.update({
    where: { id: taskId },
    data: resumeData as Parameters<typeof prisma.scheduledTask.update>[0]["data"],
  });
}

export async function cancelTask(taskId: string) {
  return prisma.scheduledTask.update({
    where: { id: taskId },
    data: { status: "CANCELLED" },
  });
}

// ─── Task Processor ─────────────────────────────────────────────────────

const INSTANCE_ID = `scheduler-${process.pid}-${Date.now()}`;

export async function processDueTasks(batchSize = 10): Promise<number> {
  const now = new Date();
  let processed = 0;

  // Acquire lock on due tasks
  const dueTasks = await prisma.scheduledTask.findMany({
    where: {
      status: "ACTIVE",
      nextRunAt: { lte: now },
      OR: [
        { lockedBy: null },
        {
          lockedAt: {
            lt: new Date(now.getTime() - 10 * 60 * 1000), // stale lock: 10 min
          },
        },
      ],
    },
    orderBy: { nextRunAt: "asc" },
    take: batchSize,
  });

  for (const task of dueTasks) {
    // Optimistic lock
    const locked = await prisma.scheduledTask.updateMany({
      where: {
        id: task.id,
        OR: [{ lockedBy: null }, { lockedBy: task.lockedBy }],
      },
      data: { lockedBy: INSTANCE_ID, lockedAt: now },
    });

    if (locked.count === 0) continue; // another instance took it

    const handler = taskHandlers.get(task.handler);
    if (!handler) {
      await prisma.scheduledTask.update({
        where: { id: task.id },
        data: {
          lastError: `Handler not registered: ${task.handler}`,
          status: "FAILED",
          lockedBy: null,
          lockedAt: null,
        },
      });
      continue;
    }

    try {
      await Promise.race([
        handler(task.payload),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Task timed out")), (task.timeoutSeconds ?? 300) * 1000)
        ),
      ]);

      // Success
      let nextRunAt: Date | null = null;
      let status: ScheduledTaskStatus = "COMPLETED";

      if (task.cronExpression) {
        nextRunAt = getNextCronRun(task.cronExpression);
        status = "ACTIVE";
      }

      await prisma.scheduledTask.update({
        where: { id: task.id },
        data: {
          lastRunAt: now,
          nextRunAt,
          status,
          retryCount: 0,
          lastError: null,
          lockedBy: null,
          lockedAt: null,
        },
      });

      processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const newRetryCount = (task.retryCount ?? 0) + 1;
      const maxRetries = task.maxRetries ?? 3;

      if (newRetryCount >= maxRetries) {
        // Max retries for this run
        let nextRunAt: Date | null = null;
        let status: ScheduledTaskStatus = "FAILED";

        if (task.cronExpression) {
          // Cron tasks reschedule to next window even on failure
          nextRunAt = getNextCronRun(task.cronExpression);
          status = "ACTIVE";
        }

        await prisma.scheduledTask.update({
          where: { id: task.id },
          data: {
            lastRunAt: now,
            lastError: message,
            retryCount: 0,
            nextRunAt,
            status,
            lockedBy: null,
            lockedAt: null,
          },
        });
      } else {
        // Exponential backoff retry
        const backoffMs = Math.min(1000 * Math.pow(2, newRetryCount), 30 * 60 * 1000);
        await prisma.scheduledTask.update({
          where: { id: task.id },
          data: {
            lastError: message,
            retryCount: newRetryCount,
            nextRunAt: new Date(now.getTime() + backoffMs),
            lockedBy: null,
            lockedAt: null,
          },
        });
      }
    }
  }

  return processed;
}

// ─── Cleanup ────────────────────────────────────────────────────────────

export async function cleanupCompletedTasks(olderThanDays = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  const result = await prisma.scheduledTask.deleteMany({
    where: {
      status: { in: ["COMPLETED", "CANCELLED"] },
      updatedAt: { lt: cutoff },
    },
  });

  return result.count;
}
