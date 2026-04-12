import { Prisma, NotificationChannel, NotificationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Types ──────────────────────────────────────────────────────────────

export interface CreateNotificationInput {
  userId: string;
  orgId?: string | undefined;
  channel?: NotificationChannel | undefined;
  title: string;
  body: string;
  actionUrl?: string | undefined;
  category: string;
  metadata?: Prisma.InputJsonValue | undefined;
  expiresAt?: Date | undefined;
}

export interface NotifyOrgInput {
  orgId: string;
  title: string;
  body: string;
  actionUrl?: string | undefined;
  category: string;
  metadata?: Prisma.InputJsonValue | undefined;
  minRole?: string | undefined;
}

export interface ListNotificationsInput {
  userId: string;
  status?: NotificationStatus | undefined;
  category?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

// ─── Core Functions ─────────────────────────────────────────────────────

export async function createNotification(input: CreateNotificationInput) {
  const pref = await prisma.notificationPreference.findUnique({
    where: {
      userId_category_channel: {
        userId: input.userId,
        category: input.category,
        channel: input.channel ?? "IN_APP",
      },
    },
  });

  if (pref && !pref.enabled) return null;

  const data: Record<string, unknown> = {
    userId: input.userId,
    channel: input.channel ?? "IN_APP",
    title: input.title,
    body: input.body,
    category: input.category,
  };
  if (input.orgId !== undefined) data.orgId = input.orgId;
  if (input.actionUrl !== undefined) data.actionUrl = input.actionUrl;
  if (input.metadata !== undefined) data.metadata = input.metadata;
  if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;

  return prisma.notification.create({ data: data as Parameters<typeof prisma.notification.create>[0]["data"] });
}

export async function notifyOrgMembers(input: NotifyOrgInput) {
  const roleHierarchy: Record<string, number> = {
    READONLY: 1,
    MEMBER: 2,
    BILLING: 3,
    ADMIN: 4,
    OWNER: 5,
  };

  const minLevel = input.minRole ? (roleHierarchy[input.minRole] ?? 0) : 0;

  const memberships = await prisma.membership.findMany({
    where: {
      orgId: input.orgId,
      status: "ACTIVE",
    },
    select: { userId: true, role: true },
  });

  const eligible = memberships.filter(
    (m) => (roleHierarchy[m.role] ?? 0) >= minLevel
  );

  const results = await Promise.allSettled(
    eligible.map((m) =>
      createNotification({
        userId: m.userId,
        orgId: input.orgId,
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
        category: input.category,
        metadata: input.metadata,
      })
    )
  );

  return {
    sent: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
  };
}

export async function listNotifications(input: ListNotificationsInput) {
  const limit = Math.min(input.limit ?? 50, 100);

  const where: Prisma.NotificationWhereInput = {
    userId: input.userId,
    ...(input.status ? { status: input.status } : {}),
    ...(input.category ? { category: input.category } : {}),
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = notifications.length > limit;
  const items = hasMore ? notifications.slice(0, limit) : notifications;

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id : null,
  };
}

export async function getUnreadCount(userId: string) {
  return prisma.notification.count({
    where: {
      userId,
      status: "UNREAD",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
}

export async function markAsRead(userId: string, notificationId: string) {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { status: "READ", readAt: new Date() },
  });
}

export async function markAllAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, status: "UNREAD" },
    data: { status: "READ", readAt: new Date() },
  });
}

export async function archiveNotification(userId: string, notificationId: string) {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
}

// ─── Preferences ────────────────────────────────────────────────────────

export async function getNotificationPreferences(userId: string) {
  return prisma.notificationPreference.findMany({
    where: { userId },
    orderBy: [{ category: "asc" }, { channel: "asc" }],
  });
}

export async function upsertPreference(
  userId: string,
  category: string,
  channel: NotificationChannel,
  enabled: boolean
) {
  return prisma.notificationPreference.upsert({
    where: {
      userId_category_channel: { userId, category, channel },
    },
    create: { userId, category, channel, enabled },
    update: { enabled },
  });
}

// ─── Cleanup ────────────────────────────────────────────────────────────

export async function cleanupExpiredNotifications() {
  const result = await prisma.notification.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  return result.count;
}
