import { createHmac, randomUUID } from "node:crypto";
import {
  hashCanonicalPayload,
  sha256Hex,
  signProvisioningDispatch,
} from "./provisioning-crypto.js";

export type ProvisioningJobRecord = {
  id: string;
  orgId: string;
  createdByActorId: string | null;
  source: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  notBefore: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  idempotencyKey: string;
  envelopeVersion: number;
  payload: unknown;
  payloadHash: string;
  signature: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProvisioningExecutionResult =
  | { kind: "SUCCESS"; metadata?: Record<string, unknown> }
  | { kind: "RETRYABLE_FAILURE"; message: string; metadata?: Record<string, unknown> }
  | { kind: "FATAL_FAILURE"; message: string; metadata?: Record<string, unknown> };

type JsonMap = Record<string, unknown>;

type HostingContext = {
  action: string | null;
  productLane: string | null;
  tenantId: string | null;
  serviceInstanceId: string | null;
  domain: string | null;
  targetIp: string | null;
  plan: string | null;
  limits: JsonMap | null;
};

type MailContext = {
  action: string | null;
  productLane: string | null;
  domain: string | null;
  mailboxEmail: string | null;
  mailboxPassword: string | null;
  mailboxQuotaMb: number | null;
};

type DispatchTarget = {
  productLane: string | null;
  url: string;
  token: string;
  source: "product_specific" | "default";
};

function asRecord(value: unknown): JsonMap {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return value as JsonMap;
}

function asNullableRecord(value: unknown): JsonMap | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  return value as JsonMap;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function normalizeProductLane(value: unknown): string | null {
  const normalized = asString(value)?.toUpperCase();
  if (!normalized) return null;
  const aliases: Record<string, string> = {
    MT: "MIGRATECK",
    MH: "MIGRAHOSTING",
    MP: "MIGRAPANEL",
    MV: "MIGRAVOICE",
    MM: "MIGRAMAIL",
    MI: "MIGRAINTAKE",
    MK: "MIGRAMARKET",
    PILOT: "MIGRAPILOT",
    MDR: "MIGRADRIVE",
  };
  return aliases[normalized] || normalized;
}

function normalizeAction(value: unknown): string | null {
  return asString(value)?.toUpperCase() ?? null;
}

function normalizeUrl(raw: string | undefined): string | null {
  const value = String(raw || "").trim();
  return /^https?:\/\//i.test(value) ? value : null;
}

function joinUrl(base: string, relativePath: string): string {
  const normalizedBase = base.endsWith("/") ? base : base + "/";
  return new URL(relativePath.replace(/^\//, ""), normalizedBase).toString();
}

function dispatchTimeoutMs(): number {
  const parsed = Number(process.env.PROVISIONING_DISPATCH_TIMEOUT_MS ?? 10_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
}

function hostingContext(job: ProvisioningJobRecord): HostingContext {
  const payload = asRecord(job.payload);
  return {
    action: normalizeAction(payload.action),
    productLane:
      normalizeProductLane(payload.productLane) ??
      normalizeProductLane(payload.product),
    tenantId: asString(payload.tenantId),
    serviceInstanceId: asString(payload.serviceInstanceId),
    domain: asString(payload.domain),
    targetIp: asString(payload.targetIp),
    plan: asString(payload.plan),
    limits: asNullableRecord(payload.limits),
  };
}

function mailContext(job: ProvisioningJobRecord): MailContext {
  const payload = asRecord(job.payload);
  return {
    action: normalizeAction(payload.action),
    productLane:
      normalizeProductLane(payload.productLane) ??
      normalizeProductLane(payload.product),
    domain: asString(payload.domain),
    mailboxEmail: asString(payload.mailboxEmail),
    mailboxPassword: asString(payload.mailboxPassword),
    mailboxQuotaMb: asPositiveNumber(payload.mailboxQuotaMb),
  };
}

function targetFor(job: ProvisioningJobRecord): DispatchTarget | null {
  const payload = asRecord(job.payload);
  const productLane =
    normalizeProductLane(payload.productLane) ??
    normalizeProductLane(payload.product);

  const productTargets: Record<string, [string | undefined, string | undefined]> = {
    MIGRATECK: [process.env.MIGRATECK_PROVISION_URL, process.env.MIGRATECK_PROVISION_TOKEN],
    MIGRAHOSTING: [process.env.MIGRAHOSTING_PROVISION_URL, process.env.MIGRAHOSTING_PROVISION_TOKEN],
    MIGRAPANEL: [process.env.MIGRAPANEL_PROVISION_URL, process.env.MIGRAPANEL_PROVISION_TOKEN],
    MIGRAVOICE: [process.env.MIGRAVOICE_PROVISION_URL, process.env.MIGRAVOICE_PROVISION_TOKEN],
    MIGRAMAIL: [process.env.MIGRAMAIL_PROVISION_URL, process.env.MIGRAMAIL_PROVISION_TOKEN],
    MIGRAINTAKE: [process.env.MIGRAINTAKE_PROVISION_URL, process.env.MIGRAINTAKE_PROVISION_TOKEN],
    MIGRAMARKET: [process.env.MIGRAMARKET_PROVISION_URL, process.env.MIGRAMARKET_PROVISION_TOKEN],
    MIGRAPILOT: [process.env.MIGRAPILOT_PROVISION_URL, process.env.MIGRAPILOT_PROVISION_TOKEN],
    MIGRADRIVE: [process.env.MIGRADRIVE_PROVISION_URL, process.env.MIGRADRIVE_PROVISION_TOKEN],
  };

  const product = productLane ? productTargets[productLane] : undefined;
  const url = normalizeUrl(product?.[0] || process.env.PROVISIONING_DISPATCH_URL);
  const token = asString(product?.[1] || process.env.PROVISIONING_DISPATCH_TOKEN);
  if (!url || !token) return null;

  return {
    productLane,
    url,
    token,
    source: product?.[0] || product?.[1] ? "product_specific" : "default",
  };
}

async function executeHostingAgent(
  job: ProvisioningJobRecord,
  context: HostingContext,
): Promise<ProvisioningExecutionResult | null> {
  if (context.productLane !== "MIGRAHOSTING" || context.action !== "POD_CREATE") {
    return null;
  }

  const baseUrl = normalizeUrl(process.env.MIGRAHOSTING_AGENT_URL);
  const keyId = asString(process.env.MIGRAHOSTING_AGENT_KEY_ID);
  const secret = asString(process.env.MIGRAHOSTING_AGENT_SECRET);
  if (!baseUrl || !keyId || !secret) return null;

  if (!context.domain || !context.tenantId || !context.serviceInstanceId) {
    return {
      kind: "FATAL_FAILURE",
      message: "missing_hosting_context",
      metadata: {
        mode: "migrahosting_agent",
        hasDomain: Boolean(context.domain),
        hasTenantId: Boolean(context.tenantId),
        hasServiceInstanceId: Boolean(context.serviceInstanceId),
      },
    };
  }

  const path = "/cloudpod/provision";
  const url = joinUrl(baseUrl, path);
  const body = JSON.stringify({
    tenantId: context.tenantId,
    serviceInstanceId: context.serviceInstanceId,
    domain: context.domain,
    planKey: context.plan,
    limits: context.limits,
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const canonical = [
    "v1",
    ts,
    nonce,
    "POST",
    path,
    sha256Hex(body),
    context.tenantId,
    context.serviceInstanceId,
    "provision",
  ].join("\n");
  const signature = createHmac("sha256", secret).update(canonical).digest("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), dispatchTimeoutMs());

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-migrapanel-ts": ts,
        "x-migrapanel-nonce": nonce,
        "x-migrapanel-sig": signature,
        "x-migrapanel-key-id": keyId,
      },
      body,
      signal: controller.signal,
    });
    const metadata = {
      mode: "migrahosting_agent",
      action: context.action,
      productLane: context.productLane,
      status: response.status,
      domain: context.domain,
      tenantId: context.tenantId,
      serviceInstanceId: context.serviceInstanceId,
    };
    if (response.ok || response.status === 409) return { kind: "SUCCESS", metadata };
    if (response.status === 429 || response.status >= 500) {
      return { kind: "RETRYABLE_FAILURE", message: "hosting_agent_http_" + response.status, metadata };
    }
    return { kind: "FATAL_FAILURE", message: "hosting_agent_http_" + response.status, metadata };
  } catch (error) {
    return {
      kind: "RETRYABLE_FAILURE",
      message: "hosting_agent_network_error",
      metadata: {
        mode: "migrahosting_agent",
        action: context.action,
        productLane: context.productLane,
        error: error instanceof Error ? error.message : "unknown",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function executeEdgeProxy(
  job: ProvisioningJobRecord,
  context: HostingContext,
): Promise<ProvisioningExecutionResult | null> {
  void job;
  if (context.productLane !== "MIGRAHOSTING" || context.action !== "DNS_PROVISION") {
    return null;
  }

  const baseUrl = normalizeUrl(process.env.MIGRAPANEL_EDGE_URL);
  if (!baseUrl) return null;
  if (!context.domain || !context.targetIp) {
    return {
      kind: "FATAL_FAILURE",
      message: "missing_edge_context",
      metadata: {
        mode: "migrapanel_edge",
        hasDomain: Boolean(context.domain),
        hasTargetIp: Boolean(context.targetIp),
      },
    };
  }

  const url = joinUrl(baseUrl, "/internal/edge/nginx/proxy");
  const token = asString(process.env.MIGRAPANEL_EDGE_TOKEN);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), dispatchTimeoutMs());

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify({ domain: context.domain, targetIp: context.targetIp }),
      signal: controller.signal,
    });
    const metadata = {
      mode: "migrapanel_edge",
      action: context.action,
      productLane: context.productLane,
      status: response.status,
      domain: context.domain,
      targetIp: context.targetIp,
      authenticated: Boolean(token),
    };
    if (response.ok || response.status === 409) return { kind: "SUCCESS", metadata };
    if (response.status === 429 || response.status >= 500) {
      return { kind: "RETRYABLE_FAILURE", message: "edge_agent_http_" + response.status, metadata };
    }
    return { kind: "FATAL_FAILURE", message: "edge_agent_http_" + response.status, metadata };
  } catch (error) {
    return {
      kind: "RETRYABLE_FAILURE",
      message: "edge_agent_network_error",
      metadata: {
        mode: "migrapanel_edge",
        action: context.action,
        productLane: context.productLane,
        error: error instanceof Error ? error.message : "unknown",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function executeMailProvision(
  job: ProvisioningJobRecord,
  context: MailContext,
): Promise<ProvisioningExecutionResult | null> {
  void job;
  if (context.productLane !== "MIGRAMAIL" || context.action !== "MAIL_PROVISION") return null;

  const baseUrl = normalizeUrl(process.env.MIGRAMAIL_CORE_URL);
  const apiKey = asString(process.env.MIGRAMAIL_CORE_API_KEY);
  if (!baseUrl || !apiKey) return null;

  if (!context.domain || !context.mailboxEmail || !context.mailboxPassword) {
    return {
      kind: "FATAL_FAILURE",
      message: "missing_mail_context",
      metadata: {
        mode: "migramail_core",
        hasDomain: Boolean(context.domain),
        hasMailboxEmail: Boolean(context.mailboxEmail),
        hasMailboxPassword: Boolean(context.mailboxPassword),
      },
    };
  }

  const [localPart, mailboxDomain] = context.mailboxEmail.split("@");
  if (!localPart || !mailboxDomain || mailboxDomain.toLowerCase() !== context.domain.toLowerCase()) {
    return { kind: "FATAL_FAILURE", message: "mailbox_domain_mismatch" };
  }

  const domainUrl = joinUrl(baseUrl, "/v1/domains/ensure");
  const domainController = new AbortController();
  const domainTimer = setTimeout(() => domainController.abort(), dispatchTimeoutMs());
  try {
    const response = await fetch(domainUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify({ domain: context.domain }),
      signal: domainController.signal,
    });
    if (!(response.ok || response.status === 409)) {
      const metadata = { mode: "migramail_core", phase: "domain", status: response.status, domain: context.domain };
      if (response.status === 429 || response.status >= 500) {
        return { kind: "RETRYABLE_FAILURE", message: "migramail_domain_http_" + response.status, metadata };
      }
      return { kind: "FATAL_FAILURE", message: "migramail_domain_http_" + response.status, metadata };
    }
  } catch (error) {
    return {
      kind: "RETRYABLE_FAILURE",
      message: "migramail_domain_network_error",
      metadata: { mode: "migramail_core", phase: "domain", error: error instanceof Error ? error.message : "unknown" },
    };
  } finally {
    clearTimeout(domainTimer);
  }

  const mailboxUrl = joinUrl(baseUrl, "/v1/domains/" + encodeURIComponent(context.domain) + "/mailboxes");
  const mailboxController = new AbortController();
  const mailboxTimer = setTimeout(() => mailboxController.abort(), dispatchTimeoutMs());
  try {
    const response = await fetch(mailboxUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        localPart,
        password: context.mailboxPassword,
        quotaMb: context.mailboxQuotaMb || undefined,
      }),
      signal: mailboxController.signal,
    });
    const metadata = {
      mode: "migramail_core",
      phase: "mailbox",
      status: response.status,
      domain: context.domain,
      mailboxEmail: context.mailboxEmail,
    };
    if (response.ok || response.status === 409) return { kind: "SUCCESS", metadata };
    if (response.status === 429 || response.status >= 500) {
      return { kind: "RETRYABLE_FAILURE", message: "migramail_mailbox_http_" + response.status, metadata };
    }
    return { kind: "FATAL_FAILURE", message: "migramail_mailbox_http_" + response.status, metadata };
  } catch (error) {
    return {
      kind: "RETRYABLE_FAILURE",
      message: "migramail_mailbox_network_error",
      metadata: { mode: "migramail_core", phase: "mailbox", error: error instanceof Error ? error.message : "unknown" },
    };
  } finally {
    clearTimeout(mailboxTimer);
  }
}

async function executeMailDisable(
  job: ProvisioningJobRecord,
  context: MailContext,
): Promise<ProvisioningExecutionResult | null> {
  void job;
  if (context.productLane !== "MIGRAMAIL" || context.action !== "MAIL_DISABLE") return null;

  const baseUrl = normalizeUrl(process.env.MIGRAMAIL_CORE_URL);
  const apiKey = asString(process.env.MIGRAMAIL_CORE_API_KEY);
  if (!baseUrl || !apiKey) return null;
  if (!context.mailboxEmail) {
    return { kind: "FATAL_FAILURE", message: "missing_mail_disable_context" };
  }

  const url = joinUrl(baseUrl, "/v1/mailboxes/" + encodeURIComponent(context.mailboxEmail));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), dispatchTimeoutMs());
  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: { authorization: "Bearer " + apiKey },
      signal: controller.signal,
    });
    const metadata = {
      mode: "migramail_core",
      phase: "suspend_mailbox",
      status: response.status,
      mailboxEmail: context.mailboxEmail,
    };
    if (response.ok || response.status === 404 || response.status === 409) return { kind: "SUCCESS", metadata };
    if (response.status === 429 || response.status >= 500) {
      return { kind: "RETRYABLE_FAILURE", message: "migramail_disable_http_" + response.status, metadata };
    }
    return { kind: "FATAL_FAILURE", message: "migramail_disable_http_" + response.status, metadata };
  } catch (error) {
    return {
      kind: "RETRYABLE_FAILURE",
      message: "migramail_disable_network_error",
      metadata: { mode: "migramail_core", phase: "suspend_mailbox", error: error instanceof Error ? error.message : "unknown" },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function executeGenericDispatch(
  job: ProvisioningJobRecord,
  workerId: string,
): Promise<ProvisioningExecutionResult> {
  const target = targetFor(job);
  const context = hostingContext(job);
  if (!target) {
    return {
      kind: "FATAL_FAILURE",
      message: "missing_dispatch_target",
      metadata: {
        mode: "webhook",
        productLane: context.productLane,
        action: context.action,
      },
    };
  }

  const payload = {
    jobId: job.id,
    orgId: job.orgId,
    type: job.type,
    payload: job.payload,
    idempotencyKey: job.idempotencyKey,
    workerId,
    createdAt: new Date(job.createdAt).toISOString(),
    envelopeVersion: job.envelopeVersion,
    envelopeSignature: job.signature,
    jobPayloadHash: job.payloadHash,
    dispatchPayloadHash: "",
  };
  payload.dispatchPayloadHash = hashCanonicalPayload({
    ...payload,
    dispatchPayloadHash: undefined,
  });

  const signature = signProvisioningDispatch(payload, target.token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), dispatchTimeoutMs());
  try {
    const response = await fetch(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + target.token,
        "x-migrateck-provisioning-signature": signature,
        "x-migrateck-job-id": job.id,
        "x-idempotency-key": job.idempotencyKey,
        "x-product-lane": target.productLane || "",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const metadata = {
      mode: "webhook",
      dispatchSource: target.source,
      productLane: target.productLane,
      status: response.status,
    };
    if (response.ok || response.status === 409) return { kind: "SUCCESS", metadata };
    if (response.status === 429 || response.status >= 500) {
      return { kind: "RETRYABLE_FAILURE", message: "dispatch_http_" + response.status, metadata };
    }
    return { kind: "FATAL_FAILURE", message: "dispatch_http_" + response.status, metadata };
  } catch (error) {
    return {
      kind: "RETRYABLE_FAILURE",
      message: "dispatch_network_error",
      metadata: {
        mode: "webhook",
        dispatchSource: target.source,
        productLane: target.productLane,
        error: error instanceof Error ? error.message : "unknown",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function executeProvisioningJob(
  job: ProvisioningJobRecord,
  workerId: string,
): Promise<ProvisioningExecutionResult> {
  const hosting = hostingContext(job);
  const mail = mailContext(job);

  const hostingResult = await executeHostingAgent(job, hosting);
  if (hostingResult) return hostingResult;

  const edgeResult = await executeEdgeProxy(job, hosting);
  if (edgeResult) return edgeResult;

  const mailProvision = await executeMailProvision(job, mail);
  if (mailProvision) return mailProvision;

  const mailDisable = await executeMailDisable(job, mail);
  if (mailDisable) return mailDisable;

  if (
    hosting.productLane === "MIGRAHOSTING" &&
    hosting.action === "STORAGE_PROVISION"
  ) {
    return {
      kind: "SUCCESS",
      metadata: {
        mode: "migrahosting_storage",
        action: hosting.action,
        status: "handled_by_pod_create",
      },
    };
  }

  return executeGenericDispatch(job, workerId);
}
