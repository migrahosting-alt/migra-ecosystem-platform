/**
 * Organization routes — create orgs, manage members.
 */
import type { FastifyInstance } from "fastify";
import {
  createOrganizationSchema,
  addMemberSchema,
  orgIdSchema,
  orgMemberIdSchema,
  updateOrganizationMemberRoleSchema,
} from "../lib/schemas.js";
import { db } from "../lib/db.js";
import { logAuditEvent } from "../modules/audit/index.js";
import { requireAuthenticatedUser, getClientIp } from "../middleware/session.js";

export async function organizationRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /v1/organizations ─────────────────────────────────────────
  app.get("/v1/organizations", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;

    const memberships = await db.organizationMember.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      include: { organization: true },
    });

    return reply.code(200).send({
      organizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        joined_at: m.createdAt.toISOString(),
      })),
    });
  });

  // ── POST /v1/organizations ────────────────────────────────────────
  app.post("/v1/organizations", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;
    const body = createOrganizationSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    // Check slug uniqueness
    const existing = await db.organization.findUnique({ where: { slug: body.slug } });
    if (existing) {
      return reply.code(409).send({ error: { code: "slug_taken", message: "Organization slug already in use." } });
    }

    const org = await db.organization.create({
      data: {
        name: body.name,
        slug: body.slug,
        ownerUserId: user.id,
        members: {
          create: {
            userId: user.id,
            role: "OWNER",
            status: "ACTIVE",
          },
        },
      },
    });

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "ORG_CREATED",
      eventData: { orgId: org.id, slug: org.slug },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(201).send({
      id: org.id,
      name: org.name,
      slug: org.slug,
    });
  });

  // ── GET /v1/organizations/:org_id/members ───────────────────────
  app.get("/v1/organizations/:org_id/members", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;
    const { org_id } = orgIdSchema.parse(request.params);

    const membership = await db.organizationMember.findFirst({
      where: { organizationId: org_id, userId: user.id, status: "ACTIVE" },
    });

    if (!membership) {
      return reply.code(403).send({ error: { code: "forbidden", message: "Not authorized to view this organization." } });
    }

    const members = await db.organizationMember.findMany({
      where: { organizationId: org_id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
      orderBy: [
        { createdAt: "asc" },
        { role: "asc" },
      ],
    });

    return reply.code(200).send({
      members: members.map((member) => ({
        id: member.id,
        role: member.role,
        status: member.status,
        joined_at: member.createdAt.toISOString(),
        user: {
          id: member.user.id,
          email: member.user.email,
          display_name: member.user.displayName,
        },
      })),
    });
  });

  // ── POST /v1/organizations/:org_id/members ────────────────────────
  app.post("/v1/organizations/:org_id/members", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;
    const { org_id } = orgIdSchema.parse(request.params);
    const body = addMemberSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    // Verify caller is owner/admin
    const callerMembership = await db.organizationMember.findFirst({
      where: { organizationId: org_id, userId: user.id, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
    });
    if (!callerMembership) {
      return reply.code(403).send({ error: { code: "forbidden", message: "Not authorized to manage this organization." } });
    }

    // Look up the target user by email
    const targetUser = await db.user.findUnique({ where: { email: body.email } });
    if (!targetUser) {
      return reply.code(404).send({ error: { code: "user_not_found", message: "No user with that email." } });
    }

    // Check if already a member
    const existingMember = await db.organizationMember.findFirst({
      where: { organizationId: org_id, userId: targetUser.id },
    });
    if (existingMember) {
      return reply.code(409).send({ error: { code: "already_member", message: "User is already a member." } });
    }

    const member = await db.organizationMember.create({
      data: {
        organizationId: org_id,
        userId: targetUser.id,
        role: body.role.toUpperCase() as any,
        status: "ACTIVE",
      },
    });

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "ORG_MEMBER_ADDED",
      eventData: { orgId: org_id, targetUserId: targetUser.id, role: body.role },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(201).send({
      member: {
        id: member.id,
        role: member.role,
        status: member.status,
        joined_at: member.createdAt.toISOString(),
        user: {
          id: targetUser.id,
          email: targetUser.email,
          display_name: targetUser.displayName,
        },
      },
    });
  });

  app.patch("/v1/organizations/:org_id/members/:member_id", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;
    const { org_id, member_id } = orgMemberIdSchema.parse(request.params);
    const body = updateOrganizationMemberRoleSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const callerMembership = await db.organizationMember.findFirst({
      where: { organizationId: org_id, userId: user.id, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
    });
    if (!callerMembership) {
      return reply.code(403).send({ error: { code: "forbidden", message: "Not authorized to manage this organization." } });
    }

    const member = await db.organizationMember.findFirst({
      where: { id: member_id, organizationId: org_id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
    });
    if (!member) {
      return reply.code(404).send({ error: { code: "member_not_found", message: "Member not found." } });
    }
    if (member.role === "OWNER") {
      return reply.code(409).send({ error: { code: "owner_locked", message: "Organization ownership cannot be reassigned here." } });
    }

    const updated = await db.organizationMember.update({
      where: { id: member.id },
      data: { role: body.role.toUpperCase() as "ADMIN" | "BILLING_ADMIN" | "MEMBER" },
    });

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "ORG_MEMBER_ROLE_UPDATED",
      eventData: { orgId: org_id, targetUserId: member.user.id, role: body.role },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({
      member: {
        id: updated.id,
        role: updated.role,
        status: updated.status,
        joined_at: updated.createdAt.toISOString(),
        user: {
          id: member.user.id,
          email: member.user.email,
          display_name: member.user.displayName,
        },
      },
    });
  });

  app.delete("/v1/organizations/:org_id/members/:member_id", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;
    const { org_id, member_id } = orgMemberIdSchema.parse(request.params);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const callerMembership = await db.organizationMember.findFirst({
      where: { organizationId: org_id, userId: user.id, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
    });
    if (!callerMembership) {
      return reply.code(403).send({ error: { code: "forbidden", message: "Not authorized to manage this organization." } });
    }

    const member = await db.organizationMember.findFirst({
      where: { id: member_id, organizationId: org_id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
    });
    if (!member) {
      return reply.code(404).send({ error: { code: "member_not_found", message: "Member not found." } });
    }
    if (member.role === "OWNER") {
      return reply.code(409).send({ error: { code: "owner_locked", message: "Organization ownership cannot be removed here." } });
    }

    await db.organizationMember.delete({
      where: { id: member.id },
    });

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "ORG_MEMBER_REMOVED",
      eventData: { orgId: org_id, targetUserId: member.user.id },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({ removed: true, memberId: member.id });
  });
}
