import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { getDb } from "./db.js";
import {
  ENTITLEMENT_STATUSES,
  PRODUCT_KEYS,
  type EntitlementStatus,
  type ProductKey,
} from "./commerce-catalog.js";
import {
  hashCanonicalPayload,
  signProvisioningEnvelope,
} from "./provisioning-crypto.js";

const ACTIVE_LIKE = new Set<EntitlementStatus>([
  "ACTIVE",
  "TRIAL",
  "INTERNAL_ONLY",
]);

type ProvisioningAction =
  | "ACCESS_GRANT"
  | "ACCESS_RESTRICT"
  | "POD_CREATE"
  | "POD_SCALE_DOWN"
  | "DNS_PROVISION"
  | "VOICE_PROVISION"
  | "VOICE_DISABLE"
  | "MAIL_PROVISION"
  | "MAIL_DISABLE"
  | "INTAKE_PROVISION"
  | "MARKET_PROVISION"
  | "PILOT_PROVISION"
  | "STORAGE_PROVISION"
  | "STORAGE_READ_ONLY"
  | "DRIVE_PROVISION"
  | "DRIVE_DISABLE";

export type EntitlementProvisioningContext = {
  domain?: string | undefined;
  tenantId?: string | undefined;
  serviceInstanceId?: string | undefined;
  targetIp?: string | undefined;
  plan?: string | undefined;
  limits?: Record<string, unknown> | undefined;
  mailboxEmail?: string | undefined;
  mailboxQuotaMb?: number | undefined;
};

export type ProvisioningWorkerStatus = {
  ready: boolean;
  workerId: string | null;
  pid: number | null;
  lastSeenAt: string | null;
  ageMs: number | null;
  reason: string | null;
};

export type EntitlementTransitionAvailability = {
  product: ProductKey;
  fromStatus: EntitlementStatus;
  toStatus: EntitlementStatus;
  available: boolean;
  mode: "database_only" | "provisioning" | "blocked";
  actions: ProvisioningAction[];
  requiredFields: string[];
  reason: string | null;
};

type CurrentEntitlement = {
  id: string;
  product: ProductKey;
  status: EntitlementStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  notes: string | null;
  updatedAt: Date;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
};

function heartbeatFile(): string {
  return (
    process.env.PROVISIONING_WORKER_HEARTBEAT_FILE ??
    "/run/migrateck-provisioning/heartbeat.json"
  );
}

export async function getProvisioningWorkerStatus(): Promise<ProvisioningWorkerStatus> {
  try {
    const raw = await readFile(heartbeatFile(), "utf8");
    const value = JSON.parse(raw) as {
      workerId?: unknown;
      pid?: unknown;
      lastSeenAt?: unknown;
    };
    const lastSeenAt =
      typeof value.lastSeenAt === "string" ? value.lastSeenAt : null;
    const timestamp = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
    const ageMs = Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : null;
    const maxAge = Number(process.env.PROVISIONING_WORKER_HEARTBEAT_MAX_AGE_MS ?? 45_000);
    const ready = ageMs !== null && ageMs <= (Number.isFinite(maxAge) ? maxAge : 45_000);

    return {
      ready,
      workerId: typeof value.workerId === "string" ? value.workerId : null,
      pid: typeof value.pid === "number" ? value.pid : null,
      lastSeenAt,
      ageMs,
      reason: ready ? null : "managed provisioning worker heartbeat is stale",
    };
  } catch {
    return {
      ready: false,
      workerId: null,
      pid: null,
      lastSeenAt: null,
      ageMs: null,
      reason: "managed provisioning worker heartbeat is unavailable",
    };
  }
}

function isInternalOrg(slug: string): boolean {
  return slug.toLowerCase().startsWith("migra");
}

function provisionActions(product: ProductKey, internal: boolean): ProvisioningAction[] {
  switch (product) {
    case "MIGRATECK":
      return ["ACCESS_GRANT"];
    case "MIGRAHOSTING":
      return [...(internal ? [] : ["POD_CREATE" as const]), "DNS_PROVISION"];
    case "MIGRAPANEL":
      return [
        ...(internal ? [] : ["POD_CREATE" as const]),
        "DNS_PROVISION",
        "STORAGE_PROVISION",
      ];
    case "MIGRAVOICE":
      return ["VOICE_PROVISION"];
    case "MIGRAMAIL":
      return ["MAIL_PROVISION"];
    case "MIGRAINTAKE":
      return ["INTAKE_PROVISION"];
    case "MIGRAMARKET":
      return ["MARKET_PROVISION"];
    case "MIGRAPILOT":
      return ["PILOT_PROVISION"];
    case "MIGRADRIVE":
      return ["DRIVE_PROVISION"];
    case "MIGRAINVOICE":
    case "MIGRABUILDER":
      return [];
    default:
      return [];
  }
}

function restrictionActions(product: ProductKey, internal: boolean): ProvisioningAction[] {
  switch (product) {
    case "MIGRATECK":
      return ["ACCESS_RESTRICT"];
    case "MIGRAHOSTING":
    case "MIGRAPANEL":
      return [
        ...(internal ? [] : ["POD_SCALE_DOWN" as const]),
        "STORAGE_READ_ONLY",
      ];
    case "MIGRAVOICE":
      return ["VOICE_DISABLE"];
    case "MIGRAMAIL":
      return ["MAIL_DISABLE"];
    case "MIGRAINTAKE":
    case "MIGRAMARKET":
    case "MIGRAPILOT":
      return ["ACCESS_RESTRICT"];
    case "MIGRADRIVE":
      return ["DRIVE_DISABLE"];
    case "MIGRAINVOICE":
    case "MIGRABUILDER":
      return [];
    default:
      return [];
  }
}

function actionsForTransition(
  orgSlug: string,
  product: ProductKey,
  previousStatus: EntitlementStatus,
  newStatus: EntitlementStatus,
): ProvisioningAction[] {
  const wasAllowed = ACTIVE_LIKE.has(previousStatus);
  const nowAllowed = ACTIVE_LIKE.has(newStatus);
  const internal = isInternalOrg(orgSlug);

  if (!wasAllowed && nowAllowed) {
    return provisionActions(product, internal);
  }
  if (wasAllowed && newStatus === "RESTRICTED") {
    return restrictionActions(product, internal);
  }
  return [];
}

type ActionReadiness = {
  supported: boolean;
  requiredFields: string[];
  reason: string | null;
};

function hasEnv(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function readinessForAction(
  product: ProductKey,
  action: ProvisioningAction,
): ActionReadiness {
  if (product === "MIGRAHOSTING" && action === "POD_CREATE") {
    const configured =
      hasEnv("MIGRAHOSTING_AGENT_URL") &&
      hasEnv("MIGRAHOSTING_AGENT_KEY_ID") &&
      hasEnv("MIGRAHOSTING_AGENT_SECRET");
    return {
      supported: configured,
      requiredFields: ["domain", "tenantId", "serviceInstanceId"],
      reason: configured ? null : "MigraHosting agent is not fully configured",
    };
  }

  if (product === "MIGRAHOSTING" && action === "DNS_PROVISION") {
    const configured =
      hasEnv("MIGRAPANEL_EDGE_URL") &&
      hasEnv("MIGRAPANEL_EDGE_TOKEN");
    return {
      supported: configured,
      requiredFields: ["domain", "targetIp"],
      reason: configured ? null : "MigraPanel edge dispatcher is not fully configured",
    };
  }

  if (product === "MIGRAMAIL" && action === "MAIL_PROVISION") {
    return {
      supported: false,
      requiredFields: [],
      reason:
        "Manual MigraMail activation is locked until mailbox credentials use encrypted async secret transport",
    };
  }

  if (product === "MIGRAMAIL" && action === "MAIL_DISABLE") {
    const configured =
      hasEnv("MIGRAMAIL_CORE_URL") &&
      hasEnv("MIGRAMAIL_CORE_API_KEY");
    return {
      supported: configured,
      requiredFields: ["mailboxEmail"],
      reason: configured ? null : "MigraMail core dispatcher is not fully configured",
    };
  }

  return {
    supported: false,
    requiredFields: [],
    reason:
      "No audited manual provisioning contract exists for " +
      product +
      " / " +
      action,
  };
}

export async function getEntitlementTransitionAvailability(input: {
  orgSlug: string;
  product: ProductKey;
  previousStatus: EntitlementStatus;
  newStatus: EntitlementStatus;
  worker?: ProvisioningWorkerStatus;
}): Promise<EntitlementTransitionAvailability> {
  const actions = actionsForTransition(
    input.orgSlug,
    input.product,
    input.previousStatus,
    input.newStatus,
  );

  if (actions.length === 0) {
    return {
      product: input.product,
      fromStatus: input.previousStatus,
      toStatus: input.newStatus,
      available: true,
      mode: "database_only",
      actions,
      requiredFields: [],
      reason: null,
    };
  }

  const worker = input.worker ?? (await getProvisioningWorkerStatus());
  if (!worker.ready) {
    return {
      product: input.product,
      fromStatus: input.previousStatus,
      toStatus: input.newStatus,
      available: false,
      mode: "blocked",
      actions,
      requiredFields: [],
      reason: worker.reason ?? "managed provisioning worker is unavailable",
    };
  }

  const required = new Set<string>();
  for (const action of actions) {
    const actionReadiness = readinessForAction(input.product, action);
    if (!actionReadiness.supported) {
      return {
        product: input.product,
        fromStatus: input.previousStatus,
        toStatus: input.newStatus,
        available: false,
        mode: "blocked",
        actions,
        requiredFields: [...required],
        reason: actionReadiness.reason,
      };
    }
    for (const field of actionReadiness.requiredFields) required.add(field);
  }

  return {
    product: input.product,
    fromStatus: input.previousStatus,
    toStatus: input.newStatus,
    available: true,
    mode: "provisioning",
    actions,
    requiredFields: [...required],
    reason: null,
  };
}

export async function buildEntitlementTransitionMatrix(input: {
  orgSlug: string;
  entitlements: Array<{ product: ProductKey; status: EntitlementStatus }>;
}) {
  const worker = await getProvisioningWorkerStatus();
  const rows = [];

  for (const entitlement of input.entitlements) {
    const targets = [];
    for (const status of ENTITLEMENT_STATUSES) {
      targets.push(
        await getEntitlementTransitionAvailability({
          orgSlug: input.orgSlug,
          product: entitlement.product,
          previousStatus: entitlement.status,
          newStatus: status,
          worker,
        }),
      );
    }
    rows.push({
      product: entitlement.product,
      currentStatus: entitlement.status,
      targets,
    });
  }

  return { worker, transitions: rows };
}

function requiredContextValue(
  context: EntitlementProvisioningContext,
  field: string,
): unknown {
  return context[field as keyof EntitlementProvisioningContext];
}

function validateContext(
  availability: EntitlementTransitionAvailability,
  context: EntitlementProvisioningContext,
): void {
  const missing = availability.requiredFields.filter((field) => {
    const value = requiredContextValue(context, field);
    return (
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim().length === 0)
    );
  });
  if (missing.length > 0) {
    throw Object.assign(
      new Error("Missing required provisioning context: " + missing.join(", ")),
      { statusCode: 400 },
    );
  }
}

function jobTypeForAction(action: ProvisioningAction): string {
  if (action === "POD_SCALE_DOWN") return "SCALE";
  if (
    action === "ACCESS_RESTRICT" ||
    action === "VOICE_DISABLE" ||
    action === "MAIL_DISABLE" ||
    action === "STORAGE_READ_ONLY" ||
    action === "DRIVE_DISABLE"
  ) {
    return "RESTRICT";
  }
  return "PROVISION";
}

function defaultMaxAttempts(): number {
  const parsed = Number(process.env.PROVISIONING_JOB_DEFAULT_MAX_ATTEMPTS ?? 5);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 20) : 5;
}

async function queueTransitionAction(
  client: PoolClient,
  input: {
    orgId: string;
    actorId: string;
    product: ProductKey;
    action: ProvisioningAction;
    previousStatus: EntitlementStatus;
    newStatus: EntitlementStatus;
    transitionId: string;
    reason: string;
    context: EntitlementProvisioningContext;
  },
) {
  const taskId = randomUUID();
  const jobId = randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
  const type = jobTypeForAction(input.action);
  const payload = {
    action: input.action,
    product: input.product,
    productLane: input.product,
    previousStatus: input.previousStatus,
    newStatus: input.newStatus,
    transitionId: input.transitionId,
    operatorReason: input.reason,
    ...input.context,
  };
  const payloadHash = hashCanonicalPayload(payload);
  const envelopeVersion = 1;
  const signature = signProvisioningEnvelope({
    jobId,
    orgId: input.orgId,
    type,
    payloadHash,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    envelopeVersion,
  });

  await client.query(
    'INSERT INTO "ProvisioningTask" (id,"orgId",product,action,status,attempts,"runAfter","lastError",payload,"createdByUserId","createdAt","updatedAt") VALUES ($1,$2,$3::"ProductKey",$4::"ProvisioningAction",\'PENDING\'::"ProvisioningTaskStatus",0,NULL,NULL,$5::jsonb,$6,$7,$7)',
    [
      taskId,
      input.orgId,
      input.product,
      input.action,
      JSON.stringify(payload),
      input.actorId,
      createdAt,
    ],
  );

  const idempotencyKey =
    "manual-entitlement:" +
    input.transitionId +
    ":" +
    input.orgId +
    ":" +
    input.product +
    ":" +
    input.action;

  await client.query(
    'INSERT INTO "ProvisioningJob" (id,"orgId","createdByActorId",source,type,status,attempts,"maxAttempts","notBefore","lastError","lastErrorAt","lockedAt","lockedBy","startedAt","finishedAt","idempotencyKey","envelopeVersion",payload,"payloadHash",signature,"expiresAt","createdAt","updatedAt") VALUES ($1,$2,$3,\'MANUAL\'::"ProvisioningJobSource",$4::"ProvisioningJobType",\'PENDING\'::"ProvisioningJobStatus",0,$5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$6,$7,$8::jsonb,$9,$10,$11,$12,$12)',
    [
      jobId,
      input.orgId,
      input.actorId,
      type,
      defaultMaxAttempts(),
      idempotencyKey,
      envelopeVersion,
      JSON.stringify(payload),
      payloadHash,
      signature,
      expiresAt,
      createdAt,
    ],
  );

  await client.query(
    'INSERT INTO "ProvisioningJobEvent" (id,"jobId",status,message,metadata,"createdAt") VALUES ($1,$2,\'PENDING\'::"ProvisioningJobStatus",\'queued\',$3::jsonb,$4)',
    [
      randomUUID(),
      jobId,
      JSON.stringify({
        source: "MANUAL",
        type,
        action: input.action,
        product: input.product,
      }),
      createdAt,
    ],
  );

  return { jobId, taskId, action: input.action, type };
}

function parseOptionalDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw Object.assign(new Error("Invalid entitlement date"), { statusCode: 400 });
  }
  return date;
}

function isStripeEvidence(notes: string | null): boolean {
  return Boolean(notes && /synced from stripe subscription/i.test(notes));
}

export async function mutateOrganizationEntitlement(input: {
  orgId: string;
  actorId: string;
  product: ProductKey;
  newStatus: EntitlementStatus;
  expectedUpdatedAt?: string | null | undefined;
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
  notes?: string | null | undefined;
  reason: string;
  acknowledgeBillingOverride: boolean;
  context: EntitlementProvisioningContext;
  ip?: string | null;
  userAgent?: string | null;
}) {
  if (!PRODUCT_KEYS.includes(input.product)) {
    throw Object.assign(new Error("Unsupported product"), { statusCode: 400 });
  }

  const client = await getDb().connect();
  try {
    await client.query("BEGIN");

    const orgResult = await client.query<OrganizationRow>(
      'SELECT id,name,slug FROM "Organization" WHERE id=$1 FOR UPDATE',
      [input.orgId],
    );
    const organization = orgResult.rows[0];
    if (!organization) {
      throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
    }

    const currentResult = await client.query<CurrentEntitlement>(
      'SELECT id,product::text AS product,status::text AS status,"startsAt","endsAt",notes,"updatedAt" FROM "OrgEntitlement" WHERE "orgId"=$1 AND product=$2::"ProductKey" FOR UPDATE',
      [input.orgId, input.product],
    );
    const current = currentResult.rows[0] ?? null;
    const previousStatus: EntitlementStatus = current?.status ?? "RESTRICTED";

    const expected = input.expectedUpdatedAt ?? null;
    const actual = current ? new Date(current.updatedAt).toISOString() : null;
    if (expected !== actual) {
      throw Object.assign(
        new Error("Entitlement changed since it was loaded. Refresh before saving."),
        { statusCode: 409 },
      );
    }

    if (
      current &&
      current.status !== input.newStatus &&
      isStripeEvidence(current.notes) &&
      !input.acknowledgeBillingOverride
    ) {
      throw Object.assign(
        new Error(
          "This entitlement is billing-synchronized. Explicitly acknowledge the manual billing override before changing access.",
        ),
        { statusCode: 409 },
      );
    }

    const availability = await getEntitlementTransitionAvailability({
      orgSlug: organization.slug,
      product: input.product,
      previousStatus,
      newStatus: input.newStatus,
    });
    if (!availability.available) {
      throw Object.assign(
        new Error(availability.reason ?? "This entitlement transition is not operationally ready"),
        { statusCode: 409 },
      );
    }
    validateContext(availability, input.context);

    const startsAtInput = parseOptionalDate(input.startsAt);
    const endsAtInput = parseOptionalDate(input.endsAt);
    const now = new Date();

    const becomingAllowed =
      !ACTIVE_LIKE.has(previousStatus) && ACTIVE_LIKE.has(input.newStatus);
    const becomingRestricted =
      ACTIVE_LIKE.has(previousStatus) && input.newStatus === "RESTRICTED";

    const startsAt =
      startsAtInput !== undefined
        ? startsAtInput
        : current?.startsAt ?? (becomingAllowed ? now : null);
    const endsAt =
      endsAtInput !== undefined
        ? endsAtInput
        : becomingAllowed
          ? null
          : becomingRestricted
            ? now
            : current?.endsAt ?? null;

    if (startsAt && endsAt && endsAt < startsAt) {
      throw Object.assign(new Error("Entitlement end date cannot precede start date"), {
        statusCode: 400,
      });
    }

    const notes =
      input.notes !== undefined
        ? input.notes
        : current?.status !== input.newStatus
          ? "Manual operator override: " + input.reason
          : current?.notes ?? null;

    const entitlementId = current?.id ?? randomUUID();
    const updated = await client.query(
      `INSERT INTO "OrgEntitlement"
         (id,"orgId",product,status,"startsAt","endsAt",notes,"createdAt","updatedAt")
       VALUES ($1,$2,$3::"ProductKey",$4::"EntitlementStatus",$5,$6,$7,NOW(),NOW())
       ON CONFLICT ("orgId",product)
       DO UPDATE SET
         status=EXCLUDED.status,
         "startsAt"=EXCLUDED."startsAt",
         "endsAt"=EXCLUDED."endsAt",
         notes=EXCLUDED.notes,
         "updatedAt"=NOW()
       RETURNING id,product::text AS product,status::text AS status,"startsAt","endsAt",notes,"updatedAt"`,
      [
        entitlementId,
        input.orgId,
        input.product,
        input.newStatus,
        startsAt,
        endsAt,
        notes,
      ],
    );

    const transitionId = randomUUID();
    const queued = [];
    for (const action of availability.actions) {
      queued.push(
        await queueTransitionAction(client, {
          orgId: input.orgId,
          actorId: input.actorId,
          product: input.product,
          action,
          previousStatus,
          newStatus: input.newStatus,
          transitionId,
          reason: input.reason,
          context: input.context,
        }),
      );
    }

    await client.query(
      'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt") VALUES ($1,$2,$3,\'ORG_ENTITLEMENT_MANUAL_UPDATE\',\'org_entitlement\',$4,$5,$6,$7::jsonb,NOW())',
      [
        randomUUID(),
        input.actorId,
        input.orgId,
        entitlementId,
        input.ip ?? null,
        input.userAgent ?? null,
        JSON.stringify({
          reason: input.reason,
          product: input.product,
          before: current
            ? {
                status: current.status,
                startsAt: current.startsAt,
                endsAt: current.endsAt,
                notes: current.notes,
                updatedAt: current.updatedAt,
              }
            : null,
          after: updated.rows[0],
          transitionId,
          actions: availability.actions,
          jobs: queued.map((job) => job.jobId),
          billingOverrideAcknowledged: input.acknowledgeBillingOverride,
        }),
      ],
    );

    await client.query("COMMIT");
    return {
      organization,
      entitlement: updated.rows[0],
      availability,
      transitionId,
      queued,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
