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
import {
  createInvitedUser,
  createPasswordResetToken,
} from "../modules/users/index.js";
import { parseIdentifier } from "../lib/identifier.js";
import { sendInternalInviteEmail } from "../lib/email.js";
import { requireAuthenticatedUser, getClientIp } from "../middleware/session.js";

async function deliverOrganizationInvite(input: {
  userId: string;
  email: string;
  displayName?: string | null;
  ip?: string;
  userAgent?: string;
}): Promise<{ sent: true } | { sent: false; reason: string }> {
  // Only one setup link should remain valid for an invited identity. A resend
  // invalidates any older password-setup link before issuing a replacement.
  await db.passwordReset.updateMany({
    where: { userId: input.userId, status: "ACTIVE" },
    data: { status: "REVOKED" },
  });

  const token = await createPasswordResetToken(
    input.userId,
    input.ip,
    input.userAgent,
  );

  try {
    await sendInternalInviteEmail(
      input.email,
      token,
      input.displayName ?? undefined,
    );
    return { sent: true };
  } catch (error) {
    // A link that was not delivered should not remain usable indefinitely.
    await db.passwordReset.updateMany({
      where: { userId: input.userId, status: "ACTIVE" },
      data: { status: "REVOKED" },
    });
    return {
      sent: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

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
            status: true,
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
          status: member.user.status,
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

    // Organization membership authority is separate from MigraTeck platform
    // operator authority. Only an ACTIVE org OWNER/ADMIN can delegate an org
    // role, and this route never grants SUPPORT/OPERATOR/platform OWNER.
    const callerMembership = await db.organizationMember.findFirst({
      where: { organizationId: org_id, userId: user.id, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
    });
    if (!callerMembership) {
      return reply.code(403).send({ error: { code: "forbidden", message: "Not authorized to manage this organization." } });
    }

    const identifier = parseIdentifier(body.email);
    if (identifier.kind !== "EMAIL") {
      return reply.code(400).send({ error: { code: "email_required", message: "Organization invitations require an email address." } });
    }

    let targetUser = await db.user.findUnique({ where: { email: identifier.normalized } });
    let identityCreated = false;

    if (!targetUser) {
      const created = await createInvitedUser(identifier);
      targetUser = created.user;
      identityCreated = true;
    }

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
        role: body.role.toUpperCase() as "ADMIN" | "BILLING_ADMIN" | "MEMBER",
        status: "ACTIVE",
      },
    });

    const pendingIdentity = targetUser.status === "PENDING";
    let inviteSent: boolean | null = null;
    let warning: string | null = null;

    if (pendingIdentity) {
      const delivery = await deliverOrganizationInvite({
        userId: targetUser.id,
        email: identifier.normalized,
        displayName: targetUser.displayName,
        ip,
        userAgent: ua,
      });

      inviteSent = delivery.sent;
      if (!delivery.sent) {
        warning =
          "The member is attached to the organization, but the setup email could not be delivered. Use Resend invite after email delivery is available.";
        await logAuditEvent({
          actorUserId: user.id,
          targetUserId: targetUser.id,
          eventType: "ORG_MEMBER_INVITE_DELIVERY_FAILED",
          eventData: {
            orgId: org_id,
            role: body.role,
            reason: delivery.reason,
          },
          ipAddress: ip,
          userAgent: ua,
        });
      }
    }

    await logAuditEvent({
      actorUserId: user.id,
      targetUserId: targetUser.id,
      eventType: pendingIdentity ? "ORG_MEMBER_INVITED" : "ORG_MEMBER_ADDED",
      eventData: {
        orgId: org_id,
        role: body.role,
        identity_created: identityCreated,
        invite_sent: inviteSent,
      },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(201).send({
      invited: pendingIdentity,
      identity_created: identityCreated,
      invite_sent: inviteSent,
      warning,
      member: {
        id: member.id,
        role: member.role,
        status: member.status,
        joined_at: member.createdAt.toISOString(),
        user: {
          id: targetUser.id,
          email: targetUser.email,
          display_name: targetUser.displayName,
          status: targetUser.status,
        },
      },
    });
  });

  app.post(
    "/v1/organizations/:org_id/members/:member_id/resend-invite",
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const actor = request.authUser!;
      const { org_id, member_id } = orgMemberIdSchema.parse(request.params);
      const ip = getClientIp(request);
      const ua = request.headers["user-agent"];

      const callerMembership = await db.organizationMember.findFirst({
        where: {
          organizationId: org_id,
          userId: actor.id,
          status: "ACTIVE",
          role: { in: ["OWNER", "ADMIN"] },
        },
      });
      if (!callerMembership) {
        return reply.code(403).send({
          error: { code: "forbidden", message: "Not authorized to manage this organization." },
        });
      }

      const member = await db.organizationMember.findFirst({
        where: { id: member_id, organizationId: org_id },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
              status: true,
            },
          },
        },
      });
      if (!member) {
        return reply.code(404).send({
          error: { code: "member_not_found", message: "Member not found." },
        });
      }
      if (member.user.status !== "PENDING" || !member.user.email) {
        return reply.code(409).send({
          error: {
            code: "invite_not_pending",
            message: "Only a member with a pending email identity can receive a setup invitation.",
          },
        });
      }

      const delivery = await deliverOrganizationInvite({
        userId: member.user.id,
        email: member.user.email,
        displayName: member.user.displayName,
        ip,
        userAgent: ua,
      });

      if (!delivery.sent) {
        await logAuditEvent({
          actorUserId: actor.id,
          targetUserId: member.user.id,
          eventType: "ORG_MEMBER_INVITE_DELIVERY_FAILED",
          eventData: {
            orgId: org_id,
            memberId: member.id,
            reason: delivery.reason,
          },
          ipAddress: ip,
          userAgent: ua,
        });

        return reply.code(502).send({
          error: {
            code: "invite_delivery_failed",
            message: "The setup email could not be delivered. The pending identity remains unable to sign in.",
          },
        });
      }

      await logAuditEvent({
        actorUserId: actor.id,
        targetUserId: member.user.id,
        eventType: "ORG_MEMBER_INVITE_RESENT",
        eventData: { orgId: org_id, memberId: member.id },
        ipAddress: ip,
        userAgent: ua,
      });

      return reply.code(200).send({
        resent: true,
        member_id: member.id,
      });
    },
  );

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
            status: true,
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
          status: member.user.status,
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
            status: true,
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
