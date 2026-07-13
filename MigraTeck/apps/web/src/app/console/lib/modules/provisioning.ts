import { randomUUID } from "node:crypto";

/**
 * Console -> panel-api provisioning boundary.
 *
 * WHAT THIS REPLACED, AND WHY
 * ---------------------------
 * This module used to INSERT a row into `provisioning_tasks` and return. That was
 * a no-op in production:
 *
 *   - The provisioning worker is a BullMQ worker. It only wakes when a Redis job
 *     arrives carrying { tenantId, taskId }. Nothing polls `provisioning_tasks`.
 *   - The console has no Redis client, so it could never enqueue that job.
 *   - Worse, the old INSERTs were invalid anyway: two branches wrote a `payload`
 *     column that does not exist on `provisioning_tasks`, and two omitted
 *     `serviceInstanceId`, which is NOT NULL. Every path errored.
 *   - This helper was documented to "NEVER throw" — it swallowed those errors and
 *     returned null, and the calling server action redirected as success.
 *
 * Net effect: an operator clicked "Trigger Deploy"/"Trigger Backup", saw success,
 * and nothing happened. Production `provisioning_tasks` held 0 rows.
 *
 * The fix is to stop writing the database directly and submit the operation to
 * panel-api, which owns the durable command ledger (`control_operations`), the
 * task record, and the queue. panel-api reports success ONLY after the queue has
 * accepted the job and returned a job id.
 *
 * This module must never again report success it cannot prove.
 */

const PANEL_API_BASE = (process.env.PANEL_API_BASE ?? "").trim();
const PANEL_INTERNAL_TOKEN = (process.env.PANEL_INTERNAL_TOKEN ?? "").trim();

/**
 * Is the operation boundary wired up? If not, provisioning controls MUST render
 * as unavailable rather than as working buttons. A disabled honest action is
 * strictly better than a false success.
 */
export const isProvisioningBoundaryConfigured = (): boolean =>
  Boolean(PANEL_API_BASE && PANEL_INTERNAL_TOKEN);

/**
 * Truthful operation states. Note what is absent: "deployed", "backed up".
 * Queue acceptance is not completion, and the UI must not claim otherwise.
 */
export type OperationStatus =
  | "requested"
  | "validated"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "partially_completed"
  | "cancelled"
  | "manual_intervention";

export type SubmitOperationInput = {
  commandType: string;
  tenantId: string;
  /** Required: every provisioning task acts on a concrete service instance. */
  serviceInstanceId: string;
  payload?: Record<string, unknown>;
  reason?: string;
  /** Supply a stable key to make a retry idempotent. Defaults to a fresh UUID. */
  idempotencyKey?: string;
  actorEmail: string;
};

export type SubmitOperationResult =
  | {
      ok: true;
      operationId: string;
      status: OperationStatus;
      queueJobId: string;
      duplicate?: boolean;
    }
  | { ok: false; error: string; message: string; operationId?: string };

/**
 * Submit a provisioning operation.
 *
 * Returns ok:true ONLY when panel-api confirms the queue accepted the job and
 * returned a job id. Every other outcome is an explicit, surfaceable failure.
 * Callers must not redirect with a success message on ok:false.
 */
export const submitProvisioningOperation = async (
  input: SubmitOperationInput,
): Promise<SubmitOperationResult> => {
  if (!isProvisioningBoundaryConfigured()) {
    return {
      ok: false,
      error: "boundary_not_configured",
      message:
        "Provisioning through the Control Center is unavailable: PANEL_API_BASE / PANEL_INTERNAL_TOKEN are not configured.",
    };
  }
  if (!input.tenantId || !input.commandType || !input.serviceInstanceId) {
    return {
      ok: false,
      error: "invalid_request",
      message: "commandType, tenantId and serviceInstanceId are required.",
    };
  }

  const correlationId = randomUUID();

  let res: Response;
  try {
    res = await fetch(`${PANEL_API_BASE}/internal/operations/provisioning`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Service credential stays server-side; it is never exposed to a browser.
        "x-internal-key": PANEL_INTERNAL_TOKEN,
        // Employee identity propagated from the console session. panel-api
        // resolves it against `users` and fails closed if it cannot.
        "x-actor-email": input.actorEmail,
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify({
        commandType: input.commandType,
        tenantId: input.tenantId,
        serviceInstanceId: input.serviceInstanceId,
        payload: input.payload ?? {},
        reason: input.reason ?? null,
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
      }),
      cache: "no-store",
    });
  } catch {
    // Cannot reach panel-api => we know nothing happened => not success.
    return {
      ok: false,
      error: "panel_api_unreachable",
      message: `Could not reach panel-api (correlation ${correlationId}). The operation was NOT submitted.`,
    };
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, any>;

  if (!res.ok || !data?.ok) {
    return {
      ok: false,
      error: String(data?.error ?? `http_${res.status}`),
      message: String(
        data?.message ??
          data?.errorSummary ??
          `panel-api rejected the operation (HTTP ${res.status}).`,
      ),
      operationId: data?.operationId,
    };
  }

  // Success requires a queue job id. Without one the job is not queued, whatever
  // else the response says.
  if (!data.queueJobId) {
    return {
      ok: false,
      error: "not_queued",
      message:
        "panel-api accepted the request but the queue did not confirm a job. Nothing is running.",
      operationId: data?.operationId,
    };
  }

  return {
    ok: true,
    operationId: String(data.operationId),
    status: (data.status ?? "queued") as OperationStatus,
    queueJobId: String(data.queueJobId),
    duplicate: Boolean(data.duplicate),
  };
};

/** Read the true state of a submitted operation. */
export const getOperation = async (operationId: string) => {
  if (!isProvisioningBoundaryConfigured()) return null;
  try {
    const res = await fetch(`${PANEL_API_BASE}/internal/operations/${operationId}`, {
      headers: { "x-internal-key": PANEL_INTERNAL_TOKEN },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, any>;
    return data?.operation ?? null;
  } catch {
    return null;
  }
};

/**
 * Command types that the Control Center cannot yet execute safely.
 *
 * These call sites used to INSERT into `provisioning_tasks` directly. Every one of
 * them was inert, and several were incoherent besides:
 *
 *   - `voice.number.purchase` (voice/new) passed a freshly generated randomUUID()
 *     as the "serviceInstanceId" — an id that referenced no service at all.
 *   - `hosting-actions.ts` passed a `websiteId` where a `service_instances` id
 *     belongs, and wrote a `"payloadJson"` column that does not exist on the table.
 *   - `hosting/new` and `marketing/new` provision brand-new services, so no
 *     service instance exists to target at submission time.
 *
 * The operation contract requires a real, tenant-owned `service_instances` row.
 * Until each of these has a defined command type and a valid target, the action is
 * DISABLED rather than faked. Per the closeout rule: a truthful unavailable state
 * is required, and the old inert implementation must not be retained.
 *
 * Phase 1 must define: voice.number.purchase, hosting.create, marketing.provision,
 * and the website-scoped hosting commands (against a real service instance).
 */
export const UNAVAILABLE_COMMANDS = [
  "voice.number.purchase",
  "hosting.create",
  "marketing.provision",
  "website.*",
] as const;

export class ProvisioningUnavailableError extends Error {
  readonly commandType: string;
  constructor(commandType: string) {
    super(
      `"${commandType}" cannot be run from the Control Center yet. It is not defined in the operation contract, ` +
        `so nothing was submitted and no work has started. (This control previously reported success while doing nothing.)`,
    );
    this.name = "ProvisioningUnavailableError";
    this.commandType = commandType;
  }
}

/**
 * Explicitly refuse a command we cannot execute. Throwing keeps the caller honest:
 * a Next.js server action that throws does not redirect with a success message.
 */
export const provisioningCommandUnavailable = (commandType: string): never => {
  throw new ProvisioningUnavailableError(commandType);
};

export type LegacyEnqueueInput = {
  type: string;
  tenantId: string;
  serviceInstanceId?: string | null;
  payload?: Record<string, unknown> | null;
  status?: "queued" | "pending";
  idempotencyKey?: string;
  /** Session email of the acting employee. Required: we will not invent an actor. */
  actorEmail?: string;
};

/**
 * @deprecated Use `submitProvisioningOperation()` directly.
 *
 * Compatibility shim for the existing call sites. The signature is preserved so
 * the console keeps building, but the SEMANTICS are now inverted on purpose:
 *
 *   BEFORE: swallowed every error, returned null, caller redirected as success.
 *   NOW:    THROWS unless panel-api confirms the queue accepted a job.
 *
 * Throwing is deliberate. A Next.js server action that throws does not redirect
 * with a success message — which is exactly the requirement: a visible failure is
 * strictly better than a false success. Until PANEL_API_BASE / PANEL_INTERNAL_TOKEN
 * are configured for the console, these controls fail loudly instead of lying.
 */
export const enqueueProvisioningTask = async (input: LegacyEnqueueInput): Promise<string> => {
  if (!input.serviceInstanceId) {
    throw new Error(
      `Provisioning operation "${input.type}" requires a serviceInstanceId. ` +
        `(provisioning_tasks."serviceInstanceId" is NOT NULL — the previous code omitted it, so the insert always failed silently.)`,
    );
  }
  if (!input.actorEmail) {
    throw new Error(
      `Provisioning operation "${input.type}" requires the acting employee's email. Actions are never attributed to a fallback account.`,
    );
  }

  const result = await submitProvisioningOperation({
    commandType: input.type,
    tenantId: input.tenantId,
    serviceInstanceId: input.serviceInstanceId,
    payload: input.payload ?? {},
    actorEmail: input.actorEmail,
    // exactOptionalPropertyTypes: only set the key when we actually have a value.
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  });

  if (!result.ok) {
    throw new Error(
      `Provisioning operation "${input.type}" was NOT queued: ${result.message} (${result.error}). No work has been started.`,
    );
  }
  return result.operationId;
};
