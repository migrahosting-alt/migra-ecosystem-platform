import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";
import { enforceRateLimit } from "../../../lib/rate-limit.js";
import { getIntakeRuntimeSnapshot } from "../../../lib/intake-integration.js";
import {
  INTAKE_FIELD_TYPES,
  INTAKE_FORM_STATUSES,
  INTAKE_SUBMISSION_STATUSES,
  createIntakeForm,
  createPublicIntakeSubmission,
  getIntakeNativeReadiness,
  getIntakeSubmission,
  getPublicIntakeForm,
  listIntakeForms,
  listIntakeSubmissions,
  searchIntakeOrganizations,
  updateIntakeForm,
  updateIntakeSubmissionStatus,
  type IntakeField,
} from "../../../lib/intake-native.js";

const fieldSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  type: z.enum(INTAKE_FIELD_TYPES),
  required: z.boolean().optional(),
  placeholder: z.string().trim().max(240).optional(),
  options: z.array(z.string().trim().min(1).max(240)).max(100).optional(),
});

const formSchemaSchema = z.object({
  fields: z.array(fieldSchema).max(100),
});

const settingsSchema = z.object({
  successMessage: z.string().trim().max(500).optional(),
  notificationEmail: z.string().trim().email().max(320).nullable().optional(),
});

const organizationQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

const organizationParamsSchema = z.object({
  orgId: z.string().trim().min(1).max(120),
});

const formParamsSchema = z.object({
  formId: z.string().trim().min(1).max(120),
});

const publicFormParamsSchema = z.object({
  publicKey: z.string().trim().min(8).max(160),
});

const submissionParamsSchema = z.object({
  submissionId: z.string().trim().min(1).max(120),
});

const createFormSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(80),
  schema: formSchemaSchema,
  settings: settingsSchema.default({}),
});

const updateFormSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime(),
    name: z.string().trim().min(1).max(160).optional(),
    slug: z.string().trim().min(1).max(80).optional(),
    status: z.enum(INTAKE_FORM_STATUSES).optional(),
    schema: formSchemaSchema.optional(),
    settings: settingsSchema.optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.slug !== undefined ||
      body.status !== undefined ||
      body.schema !== undefined ||
      body.settings !== undefined,
    { message: "At least one form setting must be provided." },
  );

const submissionQuerySchema = z.object({
  status: z.enum(INTAKE_SUBMISSION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const publicSubmissionSchema = z.object({
  responses: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
});

const submissionStatusSchema = z.object({
  status: z.enum(INTAKE_SUBMISSION_STATUSES),
});

function intakeCors(reply: {
  header(name: string, value: string): unknown;
}) {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type,Idempotency-Key");
  reply.header("Cache-Control", "no-store");
}

export async function registerIntakeRoutes(app: FastifyInstance): Promise<void> {
  // Existing production legacy bridge. It remains read-only and deliberately
  // global until explicit migration maps projects into tenant-native forms.
  app.get("/intake/runtime", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.intake.read",
    ]);
    const tenantNative = await getIntakeNativeReadiness();

    return {
      authority: {
        roles: authority.roles,
        permissions: authority.permissions.filter((permission) =>
          permission.startsWith("platform.intake."),
        ),
        viaBootstrap: authority.viaBootstrap,
      },
      ...(await getIntakeRuntimeSnapshot(tenantNative)),
      tenantNative,
    };
  });

  app.get("/intake/native/status", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.intake.read",
    ]);
    return {
      authority: {
        roles: authority.roles,
        permissions: authority.permissions.filter((permission) =>
          permission.startsWith("platform.intake."),
        ),
      },
      readiness: await getIntakeNativeReadiness(),
    };
  });

  app.get("/intake/native/organizations", async (request) => {
    await requirePlatformAuthority(request, ["platform.intake.read"]);
    const query = organizationQuerySchema.parse(request.query);
    return {
      organizations: await searchIntakeOrganizations(query.q, query.limit),
    };
  });

  app.get("/intake/native/organizations/:orgId/forms", async (request) => {
    await requirePlatformAuthority(request, ["platform.intake.read"]);
    const { orgId } = organizationParamsSchema.parse(request.params);
    return listIntakeForms(orgId);
  });

  app.post("/intake/native/organizations/:orgId/forms", async (request, reply) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.intake.manage",
    ]);
    const { orgId } = organizationParamsSchema.parse(request.params);
    const body = createFormSchema.parse(request.body);

    const form = await createIntakeForm({
      orgId,
      actorId: authority.platformUserId,
      name: body.name,
      slug: body.slug,
      schema: { fields: body.schema.fields as IntakeField[] },
      settings: {
        ...(body.settings.successMessage !== undefined
          ? { successMessage: body.settings.successMessage }
          : {}),
        ...(body.settings.notificationEmail !== undefined
          ? { notificationEmail: body.settings.notificationEmail }
          : {}),
      },
      request,
    });
    return reply.code(201).send({ form });
  });

  app.patch("/intake/native/forms/:formId", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.intake.manage",
    ]);
    const { formId } = formParamsSchema.parse(request.params);
    const body = updateFormSchema.parse(request.body);

    return {
      form: await updateIntakeForm({
        formId,
        actorId: authority.platformUserId,
        expectedUpdatedAt: body.expectedUpdatedAt,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.schema !== undefined
          ? { schema: { fields: body.schema.fields as IntakeField[] } }
          : {}),
        ...(body.settings !== undefined
          ? {
              settings: {
                ...(body.settings.successMessage !== undefined
                  ? { successMessage: body.settings.successMessage }
                  : {}),
                ...(body.settings.notificationEmail !== undefined
                  ? { notificationEmail: body.settings.notificationEmail }
                  : {}),
              },
            }
          : {}),
        request,
      }),
    };
  });

  app.get("/intake/native/forms/:formId/submissions", async (request) => {
    await requirePlatformAuthority(request, [
      "platform.intake.submissions.read",
    ]);
    const { formId } = formParamsSchema.parse(request.params);
    const query = submissionQuerySchema.parse(request.query);
    return {
      submissions: await listIntakeSubmissions({
        formId,
        ...(query.status ? { status: query.status } : {}),
        limit: query.limit,
      }),
    };
  });

  app.get("/intake/native/submissions/:submissionId", async (request) => {
    await requirePlatformAuthority(request, [
      "platform.intake.submissions.read",
    ]);
    const { submissionId } = submissionParamsSchema.parse(request.params);
    return {
      submission: await getIntakeSubmission(submissionId),
    };
  });

  app.patch("/intake/native/submissions/:submissionId", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.intake.manage",
    ]);
    const { submissionId } = submissionParamsSchema.parse(request.params);
    const body = submissionStatusSchema.parse(request.body);
    return {
      submission: await updateIntakeSubmissionStatus({
        submissionId,
        actorId: authority.platformUserId,
        status: body.status,
        request,
      }),
    };
  });

  app.options("/intake/public/forms/:publicKey", async (_request, reply) => {
    intakeCors(reply);
    return reply.code(204).send();
  });

  app.get("/intake/public/forms/:publicKey", async (request, reply) => {
    intakeCors(reply);
    const { publicKey } = publicFormParamsSchema.parse(request.params);
    return {
      form: await getPublicIntakeForm(publicKey),
    };
  });

  app.options(
    "/intake/public/forms/:publicKey/submissions",
    async (_request, reply) => {
      intakeCors(reply);
      return reply.code(204).send();
    },
  );

  app.post(
    "/intake/public/forms/:publicKey/submissions",
    async (request, reply) => {
      intakeCors(reply);
      const { publicKey } = publicFormParamsSchema.parse(request.params);
      const body = publicSubmissionSchema.parse(request.body);

      const rate = enforceRateLimit({
        key: "intake-public:" + publicKey + ":" + (request.ip ?? "unknown"),
        limit: Number(process.env.INTAKE_PUBLIC_SUBMISSIONS_PER_MINUTE ?? 20),
        windowMs: 60_000,
      });
      reply.header("X-Intake-RateLimit-Limit", String(rate.limit));
      reply.header("X-Intake-RateLimit-Remaining", String(rate.remaining));
      reply.header("X-Intake-RateLimit-Reset", String(rate.resetAt));
      if (!rate.allowed) {
        return reply.code(429).send({
          error: "rate_limited",
          message: "Too many Intake submissions. Try again shortly.",
        });
      }

      const idempotencyHeader = request.headers["idempotency-key"];
      const result = await createPublicIntakeSubmission({
        publicKey,
        responses: body.responses,
        idempotencyKey:
          body.idempotencyKey ??
          (typeof idempotencyHeader === "string" ? idempotencyHeader : null),
        requestId: request.id,
        ip: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
        origin: request.headers.origin ?? null,
      });

      return reply.code(result.duplicate ? 200 : 201).send({
        submission: result,
      });
    },
  );
}
