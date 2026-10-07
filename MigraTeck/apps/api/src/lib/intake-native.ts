import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { FastifyRequest } from "fastify";
import { getDb } from "./db.js";

export const INTAKE_FORM_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;
export const INTAKE_SUBMISSION_STATUSES = ["NEW", "IN_REVIEW", "RESOLVED", "SPAM"] as const;
export const INTAKE_FIELD_TYPES = [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "checkbox",
  "select",
  "date",
] as const;

export type IntakeFormStatus = (typeof INTAKE_FORM_STATUSES)[number];
export type IntakeSubmissionStatus = (typeof INTAKE_SUBMISSION_STATUSES)[number];
export type IntakeFieldType = (typeof INTAKE_FIELD_TYPES)[number];

export type IntakeField = {
  key: string;
  label: string;
  type: IntakeFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
};

export type IntakeFormSchema = {
  fields: IntakeField[];
};

export type IntakeFormSettings = {
  successMessage?: string;
  notificationEmail?: string | null;
};

const ACTIVE_ACCESS = new Set(["ACTIVE", "TRIAL", "INTERNAL_ONLY"]);

function encryptionKey(): Buffer {
  const raw = process.env.INTAKE_PAYLOAD_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("INTAKE_PAYLOAD_ENCRYPTION_KEY is not configured");

  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("INTAKE_PAYLOAD_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

export function encryptIntakePayload(payload: Record<string, unknown>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    version: 1,
  };
}

export function decryptIntakePayload(input: {
  payloadCiphertext: string;
  payloadIv: string;
  payloadTag: string;
  encryptionVersion: number;
}): Record<string, unknown> {
  if (input.encryptionVersion !== 1) {
    throw new Error("Unsupported Intake payload encryption version");
  }
  const iv = Buffer.from(input.payloadIv, "base64url");
  const tag = Buffer.from(input.payloadTag, "base64url");
  const ciphertext = Buffer.from(input.payloadCiphertext, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error("Invalid encrypted Intake payload");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const parsed = JSON.parse(plaintext.toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Decrypted Intake payload is invalid");
  }
  return parsed as Record<string, unknown>;
}

function publicKey(): string {
  return "ifm_" + randomBytes(24).toString("base64url");
}

function normalizeSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) throw Object.assign(new Error("Form slug is required"), { statusCode: 400 });
  return slug;
}

function normalizeSchema(input: IntakeFormSchema): IntakeFormSchema {
  const fields = Array.isArray(input.fields) ? input.fields : [];
  if (fields.length > 100) {
    throw Object.assign(new Error("Intake forms support at most 100 fields"), { statusCode: 400 });
  }

  const seen = new Set<string>();
  return {
    fields: fields.map((field) => {
      const key = field.key.trim();
      const label = field.label.trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(key)) {
        throw Object.assign(new Error("Invalid Intake field key: " + key), { statusCode: 400 });
      }
      if (seen.has(key)) {
        throw Object.assign(new Error("Duplicate Intake field key: " + key), { statusCode: 400 });
      }
      seen.add(key);
      if (!label || label.length > 160) {
        throw Object.assign(new Error("Intake field labels must be 1-160 characters"), { statusCode: 400 });
      }
      if (!INTAKE_FIELD_TYPES.includes(field.type)) {
        throw Object.assign(new Error("Unsupported Intake field type"), { statusCode: 400 });
      }

      const options =
        field.type === "select"
          ? [...new Set((field.options ?? []).map((option) => option.trim()).filter(Boolean))]
          : undefined;
      if (field.type === "select" && (!options || options.length === 0)) {
        throw Object.assign(new Error("Select fields require at least one option"), { statusCode: 400 });
      }
      if (options && options.length > 100) {
        throw Object.assign(new Error("Select fields support at most 100 options"), { statusCode: 400 });
      }

      return {
        key,
        label,
        type: field.type,
        required: Boolean(field.required),
        ...(field.placeholder?.trim()
          ? { placeholder: field.placeholder.trim().slice(0, 240) }
          : {}),
        ...(options ? { options } : {}),
      };
    }),
  };
}

function normalizeSettings(input: IntakeFormSettings): IntakeFormSettings {
  const successMessage = input.successMessage?.trim().slice(0, 500);
  const notificationEmail = input.notificationEmail?.trim().toLowerCase() || null;
  if (
    notificationEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)
  ) {
    throw Object.assign(new Error("Notification email is invalid"), { statusCode: 400 });
  }

  return {
    ...(successMessage ? { successMessage } : {}),
    notificationEmail,
  };
}

function scalarString(value: unknown, max: number): string {
  if (typeof value !== "string") {
    throw Object.assign(new Error("Expected a text value"), { statusCode: 400 });
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw Object.assign(new Error("Submission value exceeds allowed length"), { statusCode: 400 });
  }
  return normalized;
}

export function validateIntakeResponses(
  schema: IntakeFormSchema,
  responses: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Map(schema.fields.map((field) => [field.key, field]));
  for (const key of Object.keys(responses)) {
    if (!allowed.has(key)) {
      throw Object.assign(new Error("Unknown Intake field: " + key), { statusCode: 400 });
    }
  }

  const normalized: Record<string, unknown> = {};
  for (const field of schema.fields) {
    const value = responses[field.key];
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "");

    if (missing) {
      if (field.required) {
        throw Object.assign(new Error("Required field is missing: " + field.key), { statusCode: 400 });
      }
      continue;
    }

    if (field.type === "checkbox") {
      if (typeof value !== "boolean") {
        throw Object.assign(new Error("Checkbox field must be boolean: " + field.key), { statusCode: 400 });
      }
      normalized[field.key] = value;
      continue;
    }

    if (field.type === "number") {
      const number = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(number)) {
        throw Object.assign(new Error("Number field is invalid: " + field.key), { statusCode: 400 });
      }
      normalized[field.key] = number;
      continue;
    }

    const max = field.type === "textarea" ? 10_000 : 2_000;
    const text = scalarString(value, max);

    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      throw Object.assign(new Error("Email field is invalid: " + field.key), { statusCode: 400 });
    }
    if (field.type === "date" && Number.isNaN(Date.parse(text))) {
      throw Object.assign(new Error("Date field is invalid: " + field.key), { statusCode: 400 });
    }
    if (field.type === "select" && !(field.options ?? []).includes(text)) {
      throw Object.assign(new Error("Select field option is invalid: " + field.key), { statusCode: 400 });
    }
    normalized[field.key] = text;
  }

  return normalized;
}

function fingerprint(ip: string | null, userAgent: string | null): string | null {
  if (!ip && !userAgent) return null;
  return createHmac("sha256", encryptionKey())
    .update("intake-fingerprint:v1\0" + (ip ?? "") + "|" + (userAgent ?? ""))
    .digest("hex");
}

async function audit(input: {
  actorId: string;
  orgId: string;
  action: string;
  entityType: string;
  entityId: string;
  request?: FastifyRequest;
  metadata?: Record<string, unknown>;
}) {
  await getDb().query(
    'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())',
    [
      randomUUID(),
      input.actorId,
      input.orgId,
      input.action,
      input.entityType,
      input.entityId,
      input.request?.ip ?? null,
      input.request?.headers["user-agent"] ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function getIntakeNativeReadiness() {
  const rows = await getDb().query<{ table_name: string }>(
    'SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name=ANY($2::text[])',
    ["public", ["IntakeForm", "IntakeSubmission"]],
  );
  const present = new Set(rows.rows.map((row) => row.table_name));
  const ready = present.has("IntakeForm") && present.has("IntakeSubmission");
  return {
    ready,
    tables: {
      IntakeForm: present.has("IntakeForm"),
      IntakeSubmission: present.has("IntakeSubmission"),
    },
    encryptionConfigured: Boolean(process.env.INTAKE_PAYLOAD_ENCRYPTION_KEY?.trim()),
  };
}

export async function searchIntakeOrganizations(query = "", limit = 40) {
  const normalized = query.trim();
  const pattern = "%" + normalized.replace(/[%_]/g, "\\$&") + "%";
  const result = await getDb().query(
    `SELECT
       o.id,o.name,o.slug,o."authOrganizationId",
       ie.status::text AS "intakeEntitlementStatus",
       count(DISTINCT f.id)::int AS "formCount",
       count(DISTINCT CASE WHEN f.status='ACTIVE' THEN f.id END)::int AS "activeFormCount",
       count(DISTINCT s.id)::int AS "submissionCount"
     FROM "Organization" o
     LEFT JOIN "OrgEntitlement" ie
       ON ie."orgId"=o.id AND ie.product='MIGRAINTAKE'::"ProductKey"
     LEFT JOIN "IntakeForm" f ON f."orgId"=o.id
     LEFT JOIN "IntakeSubmission" s ON s."orgId"=o.id
     WHERE ($1='' OR o.name ILIKE $2 ESCAPE '\\' OR o.slug ILIKE $2 ESCAPE '\\')
     GROUP BY o.id,o.name,o.slug,o."authOrganizationId",ie.status,o."createdAt"
     ORDER BY
       CASE WHEN $1<>'' AND lower(o.name)=lower($1) THEN 0 ELSE 1 END,
       "activeFormCount" DESC,
       o."createdAt" DESC
     LIMIT $3`,
    [normalized, pattern, Math.min(Math.max(limit, 1), 100)],
  );
  return result.rows;
}

async function ensureIntakeAccess(orgId: string) {
  const result = await getDb().query<{
    id: string;
    name: string;
    slug: string;
    status: string | null;
  }>(
    `SELECT o.id,o.name,o.slug,e.status::text AS status
       FROM "Organization" o
       LEFT JOIN "OrgEntitlement" e
         ON e."orgId"=o.id AND e.product='MIGRAINTAKE'::"ProductKey"
      WHERE o.id=$1`,
    [orgId],
  );
  const org = result.rows[0];
  if (!org) throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
  if (!org.status || !ACTIVE_ACCESS.has(org.status)) {
    throw Object.assign(new Error("MigraIntake is not enabled for this organization"), { statusCode: 409 });
  }
  return org;
}

export async function listIntakeForms(orgId: string) {
  const org = await ensureIntakeAccess(orgId);
  const forms = await getDb().query(
    `SELECT
       f.id,f."orgId",f.name,f.slug,f.status,f."publicKey",f."schemaJson",f."settingsJson",
       f."createdById",f."createdAt",f."updatedAt",
       count(s.id)::int AS "submissionCount",
       count(s.id) FILTER (WHERE s.status='NEW')::int AS "newSubmissionCount",
       max(s."submittedAt") AS "lastSubmissionAt"
     FROM "IntakeForm" f
     LEFT JOIN "IntakeSubmission" s ON s."formId"=f.id
     WHERE f."orgId"=$1
     GROUP BY f.id
     ORDER BY f."updatedAt" DESC`,
    [orgId],
  );
  return { organization: org, forms: forms.rows };
}

export async function createIntakeForm(input: {
  orgId: string;
  actorId: string;
  name: string;
  slug: string;
  schema: IntakeFormSchema;
  settings: IntakeFormSettings;
  request: FastifyRequest;
}) {
  const org = await ensureIntakeAccess(input.orgId);
  const schema = normalizeSchema(input.schema);
  const settings = normalizeSettings(input.settings);
  const id = randomUUID();
  const key = publicKey();

  try {
    const result = await getDb().query(
      `INSERT INTO "IntakeForm"
       (id,"orgId",name,slug,status,"publicKey","schemaJson","settingsJson","createdById","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,'DRAFT',$5,$6::jsonb,$7::jsonb,$8,NOW(),NOW())
       RETURNING id,"orgId",name,slug,status,"publicKey","schemaJson","settingsJson","createdAt","updatedAt"`,
      [
        id,
        input.orgId,
        input.name.trim(),
        normalizeSlug(input.slug),
        key,
        JSON.stringify(schema),
        JSON.stringify(settings),
        input.actorId,
      ],
    );

    await audit({
      actorId: input.actorId,
      orgId: input.orgId,
      action: "INTAKE_FORM_CREATED",
      entityType: "intake_form",
      entityId: id,
      request: input.request,
      metadata: { name: input.name.trim(), slug: normalizeSlug(input.slug), organization: org.slug },
    });
    return result.rows[0];
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") {
      throw Object.assign(new Error("An Intake form with this slug already exists"), { statusCode: 409 });
    }
    throw error;
  }
}

export async function updateIntakeForm(input: {
  formId: string;
  actorId: string;
  expectedUpdatedAt: string;
  name?: string;
  slug?: string;
  status?: IntakeFormStatus;
  schema?: IntakeFormSchema;
  settings?: IntakeFormSettings;
  request: FastifyRequest;
}) {
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      'SELECT id,"orgId",name,slug,status,"schemaJson","settingsJson","updatedAt" FROM "IntakeForm" WHERE id=$1 FOR UPDATE',
      [input.formId],
    );
    const current = currentResult.rows[0];
    if (!current) throw Object.assign(new Error("Intake form not found"), { statusCode: 404 });
    if (new Date(current.updatedAt).toISOString() !== new Date(input.expectedUpdatedAt).toISOString()) {
      throw Object.assign(new Error("Intake form changed since it was loaded. Refresh before saving."), {
        statusCode: 409,
      });
    }

    const schema = input.schema ? normalizeSchema(input.schema) : current.schemaJson as IntakeFormSchema;
    const status = input.status ?? current.status as IntakeFormStatus;
    if (status === "ACTIVE" && schema.fields.length === 0) {
      throw Object.assign(new Error("An active Intake form must contain at least one field"), { statusCode: 409 });
    }

    const settings = input.settings
      ? normalizeSettings(input.settings)
      : current.settingsJson as IntakeFormSettings;

    const result = await client.query(
      `UPDATE "IntakeForm" SET
         name=$1,slug=$2,status=$3,"schemaJson"=$4::jsonb,"settingsJson"=$5::jsonb,"updatedAt"=NOW()
       WHERE id=$6
       RETURNING id,"orgId",name,slug,status,"publicKey","schemaJson","settingsJson","createdAt","updatedAt"`,
      [
        input.name?.trim() || current.name,
        input.slug ? normalizeSlug(input.slug) : current.slug,
        status,
        JSON.stringify(schema),
        JSON.stringify(settings),
        input.formId,
      ],
    );

    await client.query(
      'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt") VALUES ($1,$2,$3,\'INTAKE_FORM_UPDATED\',\'intake_form\',$4,$5,$6,$7::jsonb,NOW())',
      [
        randomUUID(),
        input.actorId,
        current.orgId,
        input.formId,
        input.request.ip ?? null,
        input.request.headers["user-agent"] ?? null,
        JSON.stringify({
          before: {
            name: current.name,
            slug: current.slug,
            status: current.status,
            schema: current.schemaJson,
            settings: current.settingsJson,
          },
          after: result.rows[0],
        }),
      ],
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string })?.code === "23505") {
      throw Object.assign(new Error("An Intake form with this slug already exists"), { statusCode: 409 });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getPublicIntakeForm(key: string) {
  const result = await getDb().query(
    `SELECT f.id,f.name,f.slug,f.status,f."publicKey",f."schemaJson",f."settingsJson",f."orgId",
            o.slug AS "orgSlug",e.status::text AS "entitlementStatus"
       FROM "IntakeForm" f
       JOIN "Organization" o ON o.id=f."orgId"
       LEFT JOIN "OrgEntitlement" e
         ON e."orgId"=f."orgId" AND e.product='MIGRAINTAKE'::"ProductKey"
      WHERE f."publicKey"=$1`,
    [key],
  );
  const form = result.rows[0];
  if (
    !form ||
    form.status !== "ACTIVE" ||
    !form.entitlementStatus ||
    !ACTIVE_ACCESS.has(form.entitlementStatus)
  ) {
    throw Object.assign(new Error("Intake form is not available"), { statusCode: 404 });
  }

  const settings = form.settingsJson as IntakeFormSettings;
  return {
    publicKey: form.publicKey,
    name: form.name,
    slug: form.slug,
    schema: form.schemaJson,
    successMessage: settings.successMessage ?? "Thank you. Your response was received.",
  };
}

export async function createPublicIntakeSubmission(input: {
  publicKey: string;
  responses: Record<string, unknown>;
  idempotencyKey?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  origin?: string | null;
}) {
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");
    const formResult = await client.query(
      `SELECT f.id,f."orgId",f.status,f."schemaJson",e.status::text AS "entitlementStatus"
         FROM "IntakeForm" f
         LEFT JOIN "OrgEntitlement" e
           ON e."orgId"=f."orgId" AND e.product='MIGRAINTAKE'::"ProductKey"
        WHERE f."publicKey"=$1
        FOR SHARE OF f`,
      [input.publicKey],
    );
    const form = formResult.rows[0];
    if (
      !form ||
      form.status !== "ACTIVE" ||
      !form.entitlementStatus ||
      !ACTIVE_ACCESS.has(form.entitlementStatus)
    ) {
      throw Object.assign(new Error("Intake form is not available"), { statusCode: 404 });
    }

    const normalized = validateIntakeResponses(form.schemaJson as IntakeFormSchema, input.responses);
    const encrypted = encryptIntakePayload(normalized);
    const idempotency = input.idempotencyKey?.trim().slice(0, 160) || null;

    const id = randomUUID();
    const metadata = {
      request_id: input.requestId ?? null,
      origin: input.origin?.slice(0, 255) ?? null,
      fingerprint_hash: fingerprint(input.ip ?? null, input.userAgent ?? null),
    };

    const created = await client.query(
      `INSERT INTO "IntakeSubmission"
       (id,"orgId","formId",status,"payloadCiphertext","payloadIv","payloadTag","encryptionVersion",source,"idempotencyKey","metadataJson","submittedAt","updatedAt")
       VALUES ($1,$2,$3,'NEW',$4,$5,$6,$7,'public',$8,$9::jsonb,NOW(),NOW())
       ON CONFLICT ("formId","idempotencyKey") DO NOTHING
       RETURNING id,"submittedAt"`,
      [
        id,
        form.orgId,
        form.id,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.tag,
        encrypted.version,
        idempotency,
        JSON.stringify(metadata),
      ],
    );

    if (!created.rows[0] && idempotency) {
      const existing = await client.query(
        'SELECT id,"submittedAt" FROM "IntakeSubmission" WHERE "formId"=$1 AND "idempotencyKey"=$2',
        [form.id, idempotency],
      );
      if (!existing.rows[0]) {
        throw new Error("Idempotent Intake submission conflict could not be resolved");
      }
      await client.query("COMMIT");
      return { ...existing.rows[0], duplicate: true };
    }

    if (!created.rows[0]) {
      throw new Error("Intake submission was not created");
    }

    await client.query(
      `INSERT INTO "UsageEvent"
       (id,"orgId",product,metric,quantity,metadata,"timestamp","meterName","idempotencyKey",source,"exportStatus","createdAt","updatedAt")
       VALUES ($1,$2,'MIGRAINTAKE'::"ProductKey",'CUSTOM'::"UsageMetric",1,$3::jsonb,NOW(),'intake.submissions',$4,'intake-public','LOCAL_ONLY',NOW(),NOW())
       ON CONFLICT ("idempotencyKey") DO NOTHING`,
      [
        randomUUID(),
        form.orgId,
        JSON.stringify({ form_id: form.id, submission_id: id }),
        "intake-submission:" + id,
      ],
    );

    await client.query("COMMIT");
    return { ...created.rows[0], duplicate: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listIntakeSubmissions(input: {
  formId: string;
  status?: IntakeSubmissionStatus | undefined;
  limit?: number | undefined;
}) {
  const values: unknown[] = [input.formId];
  let where = '"formId"=$1';
  if (input.status) {
    values.push(input.status);
    where += " AND status=$" + values.length;
  }
  values.push(Math.min(Math.max(input.limit ?? 50, 1), 100));

  const result = await getDb().query(
    `SELECT id,"orgId","formId",status,source,"metadataJson","submittedAt","updatedAt","reviewedAt","reviewedById"
       FROM "IntakeSubmission"
      WHERE ${where}
      ORDER BY "submittedAt" DESC
      LIMIT $${values.length}`,
    values,
  );
  return result.rows;
}

export async function getIntakeSubmission(submissionId: string) {
  const result = await getDb().query(
    `SELECT s.id,s."orgId",s."formId",s.status,s.source,s."metadataJson",s."submittedAt",s."updatedAt",
            s."reviewedAt",s."reviewedById",s."payloadCiphertext",s."payloadIv",s."payloadTag",s."encryptionVersion",
            f.name AS "formName",f.slug AS "formSlug",o.name AS "organizationName",o.slug AS "organizationSlug"
       FROM "IntakeSubmission" s
       JOIN "IntakeForm" f ON f.id=s."formId"
       JOIN "Organization" o ON o.id=s."orgId"
      WHERE s.id=$1`,
    [submissionId],
  );
  const row = result.rows[0];
  if (!row) throw Object.assign(new Error("Intake submission not found"), { statusCode: 404 });

  return {
    id: row.id,
    orgId: row.orgId,
    formId: row.formId,
    status: row.status,
    source: row.source,
    metadata: row.metadataJson,
    submittedAt: row.submittedAt,
    updatedAt: row.updatedAt,
    reviewedAt: row.reviewedAt,
    reviewedById: row.reviewedById,
    formName: row.formName,
    formSlug: row.formSlug,
    organizationName: row.organizationName,
    organizationSlug: row.organizationSlug,
    responses: decryptIntakePayload(row),
  };
}

export async function updateIntakeSubmissionStatus(input: {
  submissionId: string;
  actorId: string;
  status: IntakeSubmissionStatus;
  request: FastifyRequest;
}) {
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      'SELECT id,"orgId",status FROM "IntakeSubmission" WHERE id=$1 FOR UPDATE',
      [input.submissionId],
    );
    if (!current.rows[0]) {
      throw Object.assign(new Error("Intake submission not found"), { statusCode: 404 });
    }

    const result = await client.query(
      `UPDATE "IntakeSubmission"
          SET status=$1,"reviewedAt"=NOW(),"reviewedById"=$2,"updatedAt"=NOW()
        WHERE id=$3
        RETURNING id,"orgId","formId",status,"submittedAt","updatedAt","reviewedAt","reviewedById"`,
      [input.status, input.actorId, input.submissionId],
    );

    await client.query(
      'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt") VALUES ($1,$2,$3,\'INTAKE_SUBMISSION_STATUS_CHANGED\',\'intake_submission\',$4,$5,$6,$7::jsonb,NOW())',
      [
        randomUUID(),
        input.actorId,
        current.rows[0].orgId,
        input.submissionId,
        input.request.ip ?? null,
        input.request.headers["user-agent"] ?? null,
        JSON.stringify({ before: current.rows[0].status, after: input.status }),
      ],
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
