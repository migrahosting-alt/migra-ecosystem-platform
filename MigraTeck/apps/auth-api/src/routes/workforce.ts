import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { createPasswordResetToken } from "../modules/users/index.js";
import { sendInternalInviteEmail } from "../lib/email.js";
import { logAuditEvent } from "../modules/audit/index.js";
import { requirePermission, getClientIp } from "../middleware/session.js";
import type {
  WorkforceEmploymentType,
  WorkforceProduct,
} from "../prisma-client.js";
import {
  WorkforceError,
  createWorkforceIdentity,
  getWorkforceByStaffId,
  grantWorkforceProductAccess,
  listWorkforce,
  revokeWorkforceProductAccess,
  suspendWorkforceIdentity,
  reactivateWorkforceIdentity,
  terminateWorkforceIdentity,
  workforceProductContextByUserId,
} from "../modules/workforce/index.js";

const productValues = [
  "frendelo",
  "migrateck",
  "migrahosting",
  "migrapanel",
  "pale",
  "migramail",
  "migravoice",
  "migradrive",
  "migrapilot",
  "migraintake",
  "migremarket",
  "migrainvoice",
  "migrabuilder",
] as const;

const employmentTypeValues = [
  "employee",
  "contractor",
  "intern",
  "vendor",
] as const;

const selfContextSchema = z.object({
  product: z.enum(productValues),
});

const listSchema = z.object({
  q: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const createSchema = z.object({
  email: z.string().trim().email().max(320).transform((v) => v.toLowerCase()),
  display_name: z.string().trim().min(1).max(120).optional(),
  employment_type: z.enum(employmentTypeValues).default("employee"),
  job_title: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  team: z.string().trim().max(120).optional(),
  manager_staff_id: z.string().trim().max(48).optional(),
  starts_at: z.string().datetime({ offset: true }).optional(),
  reason: z.string().trim().min(10).max(1000),
  confirmation: z.literal("CREATE STAFF"),
});

const productAccessSchema = z.object({
  product: z.enum(productValues),
  role_key: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z][a-z0-9_.-]*$/),
  reason: z.string().trim().min(10).max(1000),
  expires_at: z.string().datetime({ offset: true }).optional(),
  confirmation: z.string().trim().min(1).max(80),
});

const revokeProductAccessSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
  confirmation: z.literal("REVOKE PRODUCT ACCESS"),
});

const suspendSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
  confirmation: z.literal("SUSPEND STAFF"),
});

const reactivateSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
  confirmation: z.literal("REACTIVATE STAFF"),
});

const terminateSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
  confirmation: z.literal("TERMINATE STAFF"),
});

function productEnum(value: (typeof productValues)[number]): WorkforceProduct {
  return value.toUpperCase() as WorkforceProduct;
}

function employmentTypeEnum(
  value: (typeof employmentTypeValues)[number],
): WorkforceEmploymentType {
  return value.toUpperCase() as WorkforceEmploymentType;
}

function profileJson(profile: Awaited<ReturnType<typeof getWorkforceByStaffId>>) {
  if (!profile) return null;
  return {
    staff_id: profile.staffId,
    user_id: profile.userId,
    email: profile.user.email,
    display_name: profile.user.displayName,
    identity_status: profile.user.status.toLowerCase(),
    employment_status: profile.employmentStatus.toLowerCase(),
    employment_type: profile.employmentType.toLowerCase(),
    job_title: profile.jobTitle,
    department: profile.department,
    team: profile.team,
    manager_staff_id: profile.manager?.staffId ?? null,
    entitlement_revision: profile.entitlementRevision,
    starts_at: profile.startsAt?.toISOString() ?? null,
    ends_at: profile.endsAt?.toISOString() ?? null,
    last_login_at: profile.user.lastLoginAt?.toISOString() ?? null,
    email_verified_at: profile.user.emailVerifiedAt?.toISOString() ?? null,
    direct_reports: profile.directReports.map((row) => ({
      staff_id: row.staffId,
      job_title: row.jobTitle,
      employment_status: row.employmentStatus.toLowerCase(),
    })),
    product_access: profile.productAccess.map((grant) => ({
      grant_id: grant.id,
      product: grant.product.toLowerCase(),
      role_key: grant.roleKey,
      granted_at: grant.grantedAt.toISOString(),
      expires_at: grant.expiresAt?.toISOString() ?? null,
      revoked_at: grant.revokedAt?.toISOString() ?? null,
      provisioning_state: grant.provisioningState.toLowerCase(),
      last_provisioned_at: grant.lastProvisionedAt?.toISOString() ?? null,
      last_provision_error: grant.lastProvisionError,
      revision: grant.revision,
    })),
    created_at: profile.createdAt.toISOString(),
    updated_at: profile.updatedAt.toISOString(),
  };
}

function sendWorkforceError(error: unknown, reply: FastifyReply) {
  if (error instanceof WorkforceError) {
    return reply.code(error.statusCode).send({
      error: { code: error.code, message: error.message },
    });
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  ) {
    return reply.code(409).send({
      error: {
        code: "workforce_identity_conflict",
        message:
          "A workforce or identity record already exists for one of these unique attributes.",
      },
    });
  }
  throw error;
}

export async function workforceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/admin/workforce/me",
    { preHandler: requirePermission("platform.self.read") },
    async (request, reply) => {
      const query = selfContextSchema.parse(request.query ?? {});
      const context = await workforceProductContextByUserId({
        userId: request.authUser!.id,
        product: productEnum(query.product),
      });

      if (!context) {
        return reply.code(403).send({
          error: {
            code: "workforce_product_access_required",
            message:
              "Your active workforce identity does not currently include access to that product.",
          },
        });
      }

      return reply.code(200).send({
        staff_id: context.staffId,
        email: context.email,
        display_name: context.name,
        product: query.product,
        role_keys: context.roleKeys,
        grant_ids: context.grantIds,
        entitlement_revision: context.entitlementRevision,
      });
    },
  );

  app.get(
    "/v1/admin/workforce",
    { preHandler: requirePermission("platform.workforce.read") },
    async (request, reply) => {
      const query = listSchema.parse(request.query ?? {});
      const snapshot = await listWorkforce(query);
      return reply.code(200).send({
        total: snapshot.total,
        staff: snapshot.profiles.map((profile) => ({
          staff_id: profile.staffId,
          user_id: profile.userId,
          email: profile.user.email,
          display_name: profile.user.displayName,
          identity_status: profile.user.status.toLowerCase(),
          employment_status: profile.employmentStatus.toLowerCase(),
          employment_type: profile.employmentType.toLowerCase(),
          job_title: profile.jobTitle,
          department: profile.department,
          team: profile.team,
          manager_staff_id: profile.manager?.staffId ?? null,
          entitlement_revision: profile.entitlementRevision,
          last_login_at: profile.user.lastLoginAt?.toISOString() ?? null,
          product_access: profile.productAccess.map((grant) => ({
            grant_id: grant.id,
            product: grant.product.toLowerCase(),
            role_key: grant.roleKey,
            expires_at: grant.expiresAt?.toISOString() ?? null,
            provisioning_state: grant.provisioningState.toLowerCase(),
            last_provisioned_at:
              grant.lastProvisionedAt?.toISOString() ?? null,
            last_provision_error: grant.lastProvisionError,
            revision: grant.revision,
          })),
        })),
      });
    },
  );

  app.get<{ Params: { staffId: string } }>(
    "/v1/admin/workforce/:staffId",
    { preHandler: requirePermission("platform.workforce.read") },
    async (request, reply) => {
      const profile = await getWorkforceByStaffId(request.params.staffId);
      if (!profile) {
        return reply.code(404).send({
          error: { code: "staff_not_found", message: "Staff identity not found." },
        });
      }
      return reply.code(200).send({ staff: profileJson(profile) });
    },
  );

  app.post(
    "/v1/admin/workforce",
    { preHandler: requirePermission("platform.workforce.manage") },
    async (request, reply) => {
      const actor = request.authUser!;
      const body = createSchema.parse(request.body ?? {});
      const ip = getClientIp(request);
      const ua = request.headers["user-agent"];

      try {
        const created = await createWorkforceIdentity({
          email: body.email,
          displayName: body.display_name,
          employmentType: employmentTypeEnum(body.employment_type),
          jobTitle: body.job_title,
          department: body.department,
          team: body.team,
          managerStaffId: body.manager_staff_id,
          startsAt: body.starts_at ? new Date(body.starts_at) : undefined,
          actorUserId: actor.id,
          ipAddress: ip,
          userAgent: ua,
        });

        const token = await createPasswordResetToken(created.user.id, ip, ua);
        try {
          await sendInternalInviteEmail(
            body.email,
            token,
            body.display_name,
          );
          await logAuditEvent({
            actorUserId: actor.id,
            actorType: "ADMIN",
            targetUserId: created.user.id,
            eventType: "WORKFORCE_INVITE_SENT",
            eventData: {
              staff_id: created.profile.staffId,
              reason: body.reason,
            },
            ipAddress: ip,
            userAgent: ua,
          });
        } catch (error) {
          await logAuditEvent({
            actorUserId: actor.id,
            actorType: "ADMIN",
            targetUserId: created.user.id,
            eventType: "WORKFORCE_INVITE_DELIVERY_FAILED",
            eventData: {
              staff_id: created.profile.staffId,
              reason: body.reason,
            },
            ipAddress: ip,
            userAgent: ua,
          });
          return reply.code(502).send({
            error: {
              code: "invite_delivery_failed",
              message:
                "The staff identity was created, but the invitation email could not be delivered. Retry delivery before granting production access.",
            },
            staff_id: created.profile.staffId,
            user_id: created.user.id,
          });
        }

        return reply.code(201).send({
          created: true,
          staff_id: created.profile.staffId,
          user_id: created.user.id,
          employment_status: created.profile.employmentStatus.toLowerCase(),
        });
      } catch (error) {
        return sendWorkforceError(error, reply);
      }
    },
  );

  app.post<{ Params: { staffId: string } }>(
    "/v1/admin/workforce/:staffId/product-access",
    {
      preHandler: requirePermission(
        "platform.workforce.product_access.manage",
      ),
    },
    async (request, reply) => {
      const actor = request.authUser!;
      const body = productAccessSchema.parse(request.body ?? {});
      const requiredConfirmation =
        body.product === "frendelo" && body.role_key === "super_admin"
          ? "GRANT FRENDELO SUPER ADMIN"
          : "GRANT PRODUCT ACCESS";
      if (body.confirmation !== requiredConfirmation) {
        return reply.code(400).send({
          error: {
            code: "product_access_confirmation_required",
            message: `Type ${requiredConfirmation} to confirm this product-access grant.`,
          },
        });
      }
      const expiresAt = body.expires_at ? new Date(body.expires_at) : undefined;
      if (expiresAt && expiresAt <= new Date()) {
        return reply.code(400).send({
          error: {
            code: "expiry_must_be_future",
            message: "Product access expiry must be in the future.",
          },
        });
      }

      try {
        const grant = await grantWorkforceProductAccess({
          staffId: request.params.staffId,
          product: productEnum(body.product),
          roleKey: body.role_key,
          reason: body.reason,
          expiresAt,
          actorUserId: actor.id,
          ipAddress: getClientIp(request),
          userAgent: request.headers["user-agent"],
        });
        return reply.code(201).send({
          granted: true,
          grant_id: grant.id,
          staff_id: request.params.staffId,
          product: grant.product.toLowerCase(),
          role_key: grant.roleKey,
          provisioning_state: grant.provisioningState.toLowerCase(),
          grant_revision: grant.revision,
          entitlement_revision: grant.entitlementRevision,
        });
      } catch (error) {
        return sendWorkforceError(error, reply);
      }
    },
  );

  app.delete<{ Params: { staffId: string; grantId: string } }>(
    "/v1/admin/workforce/:staffId/product-access/:grantId",
    {
      preHandler: requirePermission(
        "platform.workforce.product_access.manage",
      ),
    },
    async (request, reply) => {
      const actor = request.authUser!;
      const body = revokeProductAccessSchema.parse(request.body ?? {});
      try {
        const result = await revokeWorkforceProductAccess({
          staffId: request.params.staffId,
          grantId: request.params.grantId,
          reason: body.reason,
          actorUserId: actor.id,
          ipAddress: getClientIp(request),
          userAgent: request.headers["user-agent"],
        });
        return reply.code(200).send(result);
      } catch (error) {
        return sendWorkforceError(error, reply);
      }
    },
  );

  app.post<{ Params: { staffId: string } }>(
    "/v1/admin/workforce/:staffId/suspend",
    { preHandler: requirePermission("platform.workforce.manage") },
    async (request, reply) => {
      const actor = request.authUser!;
      const body = suspendSchema.parse(request.body ?? {});
      try {
        const result = await suspendWorkforceIdentity({
          staffId: request.params.staffId,
          reason: body.reason,
          actorUserId: actor.id,
          ipAddress: getClientIp(request),
          userAgent: request.headers["user-agent"],
        });
        return reply.code(200).send(result);
      } catch (error) {
        return sendWorkforceError(error, reply);
      }
    },
  );

  app.post<{ Params: { staffId: string } }>(
    "/v1/admin/workforce/:staffId/reactivate",
    { preHandler: requirePermission("platform.workforce.manage") },
    async (request, reply) => {
      const actor = request.authUser!;
      const body = reactivateSchema.parse(request.body ?? {});
      try {
        const result = await reactivateWorkforceIdentity({
          staffId: request.params.staffId,
          reason: body.reason,
          actorUserId: actor.id,
          ipAddress: getClientIp(request),
          userAgent: request.headers["user-agent"],
        });
        return reply.code(200).send(result);
      } catch (error) {
        return sendWorkforceError(error, reply);
      }
    },
  );

  app.post<{ Params: { staffId: string } }>(
    "/v1/admin/workforce/:staffId/terminate",
    { preHandler: requirePermission("platform.workforce.manage") },
    async (request, reply) => {
      const actor = request.authUser!;
      const body = terminateSchema.parse(request.body ?? {});
      try {
        const result = await terminateWorkforceIdentity({
          staffId: request.params.staffId,
          reason: body.reason,
          actorUserId: actor.id,
          ipAddress: getClientIp(request),
          userAgent: request.headers["user-agent"],
        });
        return reply.code(200).send(result);
      } catch (error) {
        return sendWorkforceError(error, reply);
      }
    },
  );
}
