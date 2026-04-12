import { createHmac, randomUUID } from "node:crypto";
import { ProductKey, ProvisioningAction, type ProvisioningJob, type Prisma } from "@prisma/client";
import {
  env,
  provisioningDispatchTimeoutMs,
  provisioningEngineDryRun,
} from "@/lib/env";
import {
  getDefaultMigraDrivePlanConfig,
  resolveMigraDrivePlanConfig,
} from "@/lib/drive/drive-plan-config";
import { canonicalizeJson, hashCanonicalPayload, sha256Hex } from "@/lib/security/canonical";

export type ProvisioningExecutionResult =
  | {
      kind: "SUCCESS";
      metadata?: Prisma.InputJsonValue;
    }
  | {
      kind: "RETRYABLE_FAILURE";
      message: string;
      metadata?: Prisma.InputJsonValue;
    }
  | {
      kind: "FATAL_FAILURE";
      message: string;
      metadata?: Prisma.InputJsonValue;
    };

export interface ProvisioningExecutionInput {
  job: ProvisioningJob;
  idempotencyKey: string;
  workerId: string;
}

export interface ProvisioningProvider {
  execute(input: ProvisioningExecutionInput): Promise<ProvisioningExecutionResult>;
}

class DryRunProvisioningProvider implements ProvisioningProvider {
  async execute(input: ProvisioningExecutionInput): Promise<ProvisioningExecutionResult> {
    void input;
    return {
      kind: "SUCCESS",
      metadata: {
        mode: "dry_run",
      },
    };
  }
}

interface DispatchTarget {
  productLane: string | null;
  url: string;
  token: string;
  source: "product_specific" | "default";
}

interface DispatchPayload {
  jobId: string;
  orgId: string;
  type: string;
  payload: Prisma.JsonValue;
  idempotencyKey: string;
  workerId: string;
  createdAt: string;
  envelopeVersion: number;
  envelopeSignature: string;
  jobPayloadHash: string;
  dispatchPayloadHash: string;
}

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
  mailboxName: string | null;
  mailboxQuotaMb: number | null;
  mailDomainDescription: string | null;
  mailDomainMaxMailboxes: number | null;
  mailDomainQuotaMb: number | null;
};

type DriveContext = {
  action: string | null;
  productLane: string | null;
  orgId: string;
  orgSlug: string | null;
  planCode: string | null;
  storageQuotaGb: number | null;
  subscriptionId: string | null;
  entitlementId: string | null;
  customerId: string | null;
};

const PRODUCT_DISPATCH_ENV_KEYS: Record<string, { url?: string | undefined; token?: string | undefined }> = {
  [ProductKey.MIGRATECK]: {
    url: env.MIGRATECK_PROVISION_URL,
    token: env.MIGRATECK_PROVISION_TOKEN,
  },
  [ProductKey.MIGRAHOSTING]: {
    url: env.MIGRAHOSTING_PROVISION_URL,
    token: env.MIGRAHOSTING_PROVISION_TOKEN,
  },
  [ProductKey.MIGRAPANEL]: {
    url: env.MIGRAPANEL_PROVISION_URL,
    token: env.MIGRAPANEL_PROVISION_TOKEN,
  },
  [ProductKey.MIGRAVOICE]: {
    url: env.MIGRAVOICE_PROVISION_URL,
    token: env.MIGRAVOICE_PROVISION_TOKEN,
  },
  [ProductKey.MIGRAMAIL]: {
    url: env.MIGRAMAIL_PROVISION_URL,
    token: env.MIGRAMAIL_PROVISION_TOKEN,
  },
  [ProductKey.MIGRAINTAKE]: {
    url: env.MIGRAINTAKE_PROVISION_URL,
    token: env.MIGRAINTAKE_PROVISION_TOKEN,
  },
  [ProductKey.MIGRAMARKET]: {
    url: env.MIGRAMARKET_PROVISION_URL,
    token: env.MIGRAMARKET_PROVISION_TOKEN,
  },
  [ProductKey.MIGRAPILOT]: {
    url: env.MIGRAPILOT_PROVISION_URL,
    token: env.MIGRAPILOT_PROVISION_TOKEN,
  },
  [ProductKey.MIGRADRIVE]: {
    url: env.MIGRADRIVE_PROVISION_URL,
    token: env.MIGRADRIVE_PROVISION_TOKEN,
  },
};

function asRecord(value: Prisma.JsonValue | null): JsonMap {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {};
  }

  return value as JsonMap;
}

function asNullableRecord(value: unknown): JsonMap | null {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }

  return value as JsonMap;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function asPositiveNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function normalizeProductLane(value: unknown): string | null {
  const normalized = asString(value)?.toUpperCase();
  if (!normalized) {
    return null;
  }

  const aliases: Record<string, string> = {
    MT: ProductKey.MIGRATECK,
    MH: ProductKey.MIGRAHOSTING,
    MP: ProductKey.MIGRAPANEL,
    MV: ProductKey.MIGRAVOICE,
    MM: ProductKey.MIGRAMAIL,
    MI: ProductKey.MIGRAINTAKE,
    MK: ProductKey.MIGRAMARKET,
    PILOT: ProductKey.MIGRAPILOT,
    MDR: ProductKey.MIGRADRIVE,
  };

  return aliases[normalized] || normalized;
}

function normalizeAction(value: unknown): string | null {
  const normalized = asString(value)?.toUpperCase();
  if (!normalized) {
    return null;
  }

  const allowed = new Set<string>(Object.values(ProvisioningAction));
  return allowed.has(normalized) ? normalized : normalized;
}

function normalizeUrl(raw: string | undefined): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : null;
}

function joinUrl(base: string, relativePath: string): string {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return new URL(relativePath.replace(/^\//, ""), normalizedBase).toString();
}

function resolveDispatchTarget(job: ProvisioningJob): DispatchTarget | null {
  const payload = asRecord(job.payload);
  const productLane =
    normalizeProductLane(payload.productLane) || normalizeProductLane(payload.product) || null;

  const productConfig = productLane ? PRODUCT_DISPATCH_ENV_KEYS[productLane] : undefined;
  const defaultUrl = env.PROVISIONING_DISPATCH_URL;
  const defaultToken = env.PROVISIONING_DISPATCH_TOKEN;

  const url = productConfig?.url || defaultUrl;
  const token = productConfig?.token || defaultToken;

  if (!url || !token) {
    return null;
  }

  return {
    productLane,
    url,
    token,
    source: productConfig?.url || productConfig?.token ? "product_specific" : "default",
  };
}

function createDispatchPayload(input: ProvisioningExecutionInput): DispatchPayload {
  const payload: DispatchPayload = {
    jobId: input.job.id,
    orgId: input.job.orgId,
    type: input.job.type,
    payload: input.job.payload,
    idempotencyKey: input.idempotencyKey,
    workerId: input.workerId,
    createdAt: input.job.createdAt.toISOString(),
    envelopeVersion: input.job.envelopeVersion,
    envelopeSignature: input.job.signature,
    jobPayloadHash: input.job.payloadHash,
    dispatchPayloadHash: "",
  };

  payload.dispatchPayloadHash = hashCanonicalPayload({
    ...payload,
    dispatchPayloadHash: undefined,
  });

  return payload;
}

function buildDispatchSignature(payload: DispatchPayload, token: string): string {
  return createHmac("sha256", token).update(canonicalizeJson(payload)).digest("hex");
}

function getHostingContext(job: ProvisioningJob): HostingContext {
  const payload = asRecord(job.payload);
  return {
    action: normalizeAction(payload.action),
    productLane: normalizeProductLane(payload.productLane) || normalizeProductLane(payload.product),
    tenantId: asString(payload.tenantId),
    serviceInstanceId: asString(payload.serviceInstanceId),
    domain: asString(payload.domain),
    targetIp: asString(payload.targetIp),
    plan: asString(payload.plan),
    limits: asNullableRecord(payload.limits),
  };
}

function getMailContext(job: ProvisioningJob): MailContext {
  const payload = asRecord(job.payload);
  return {
    action: normalizeAction(payload.action),
    productLane: normalizeProductLane(payload.productLane) || normalizeProductLane(payload.product),
    domain: asString(payload.domain),
    mailboxEmail: asString(payload.mailboxEmail),
    mailboxPassword: asString(payload.mailboxPassword),
    mailboxName: asString(payload.mailboxName),
    mailboxQuotaMb: asPositiveNumber(payload.mailboxQuotaMb),
    mailDomainDescription: asString(payload.mailDomainDescription),
    mailDomainMaxMailboxes: asPositiveNumber(payload.mailDomainMaxMailboxes),
    mailDomainQuotaMb: asPositiveNumber(payload.mailDomainQuotaMb),
  };
}

function getDriveContext(job: ProvisioningJob): DriveContext {
  const payload = asRecord(job.payload);
  return {
    action: normalizeAction(payload.action),
    productLane: normalizeProductLane(payload.productLane) || normalizeProductLane(payload.product),
    orgId: job.orgId,
    orgSlug: asString(payload.orgSlug),
    planCode: asString(payload.planCode) || asString(payload.plan),
    storageQuotaGb: asPositiveNumber(payload.storageQuotaGb),
    subscriptionId: asString(payload.subscriptionId),
    entitlementId: asString(payload.entitlementId),
    customerId: asString(payload.customerId),
  };
}

function agentHttpResult(
  kind: ProvisioningExecutionResult["kind"],
  message: string,
  metadata: Prisma.InputJsonValue,
): ProvisioningExecutionResult {
  if (kind === "SUCCESS") {
    return { kind, metadata };
  }
  return { kind, message, metadata };
}

async function executeHostingAgentProvision(
  input: ProvisioningExecutionInput,
  context: HostingContext,
): Promise<ProvisioningExecutionResult | null> {
  if (context.productLane !== ProductKey.MIGRAHOSTING || context.action !== ProvisioningAction.POD_CREATE) {
    return null;
  }

  const baseUrl = normalizeUrl(env.MIGRAHOSTING_AGENT_URL);
  const keyId = asString(env.MIGRAHOSTING_AGENT_KEY_ID);
  const signingSecret = asString(env.MIGRAHOSTING_AGENT_SECRET);

  if (!baseUrl || !keyId || !signingSecret) {
    return null;
  }

  if (!context.domain || !context.tenantId || !context.serviceInstanceId) {
    return {
      kind: "FATAL_FAILURE",
      message: "missing_hosting_context",
      metadata: {
        mode: "migrahosting_agent",
        action: context.action,
        hasDomain: Boolean(context.domain),
        hasTenantId: Boolean(context.tenantId),
        hasServiceInstanceId: Boolean(context.serviceInstanceId),
      },
    };
  }

  const url = joinUrl(baseUrl, "/cloudpod/provision");
  const requestBody = {
    tenantId: context.tenantId,
    serviceInstanceId: context.serviceInstanceId,
    domain: context.domain,
    planKey: context.plan,
    limits: context.limits,
  };
  const rawBody = JSON.stringify(requestBody);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const bodyHash = sha256Hex(rawBody);
  const canonical = [
    "v1",
    ts,
    nonce,
    "POST",
    "/cloudpod/provision",
    bodyHash,
    context.tenantId,
    context.serviceInstanceId,
    "provision",
  ].join("\n");
  const signature = createHmac("sha256", signingSecret).update(canonical).digest("base64");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provisioningDispatchTimeoutMs);

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
      body: rawBody,
      signal: controller.signal,
    });

    const responseText = await response.text();
    const metadata = {
      mode: "migrahosting_agent",
      dispatchUrl: url,
      action: context.action,
      productLane: context.productLane,
      status: response.status,
      ok: response.ok,
      responseText: responseText.slice(0, 2000),
      domain: context.domain,
      tenantId: context.tenantId,
      serviceInstanceId: context.serviceInstanceId,
    };

    if (response.ok || response.status === 409) {
      return agentHttpResult("SUCCESS", "", metadata);
    }
    if (response.status === 429 || response.status >= 500) {
      return agentHttpResult("RETRYABLE_FAILURE", `hosting_agent_http_${response.status}`, metadata);
    }
    return agentHttpResult("FATAL_FAILURE", `hosting_agent_http_${response.status}`, metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_hosting_agent_error";
    return agentHttpResult("RETRYABLE_FAILURE", "hosting_agent_network_error", {
      mode: "migrahosting_agent",
      dispatchUrl: url,
      action: context.action,
      productLane: context.productLane,
      error: message,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function executeEdgeProxyProvision(
  input: ProvisioningExecutionInput,
  context: HostingContext,
): Promise<ProvisioningExecutionResult | null> {
  if (context.productLane !== ProductKey.MIGRAHOSTING || context.action !== ProvisioningAction.DNS_PROVISION) {
    return null;
  }

  const baseUrl = normalizeUrl(env.MIGRAPANEL_EDGE_URL);
  if (!baseUrl) {
    return null;
  }

  if (!context.domain || !context.targetIp) {
    return {
      kind: "FATAL_FAILURE",
      message: "missing_edge_context",
      metadata: {
        mode: "migrapanel_edge",
        action: context.action,
        hasDomain: Boolean(context.domain),
        hasTargetIp: Boolean(context.targetIp),
      },
    };
  }

  const url = joinUrl(baseUrl, "/internal/edge/nginx/proxy");
  const requestBody = {
    domain: context.domain,
    targetIp: context.targetIp,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provisioningDispatchTimeoutMs);
  const token = asString(env.MIGRAPANEL_EDGE_TOKEN);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const responseText = await response.text();
    const metadata = {
      mode: "migrapanel_edge",
      dispatchUrl: url,
      action: context.action,
      productLane: context.productLane,
      status: response.status,
      ok: response.ok,
      responseText: responseText.slice(0, 2000),
      domain: context.domain,
      targetIp: context.targetIp,
      authenticated: Boolean(token),
    };

    if (response.ok || response.status === 409) {
      return agentHttpResult("SUCCESS", "", metadata);
    }
    if (response.status === 429 || response.status >= 500) {
      return agentHttpResult("RETRYABLE_FAILURE", `edge_agent_http_${response.status}`, metadata);
    }
    return agentHttpResult("FATAL_FAILURE", `edge_agent_http_${response.status}`, metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_edge_agent_error";
    return agentHttpResult("RETRYABLE_FAILURE", "edge_agent_network_error", {
      mode: "migrapanel_edge",
      dispatchUrl: url,
      action: context.action,
      productLane: context.productLane,
      error: message,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function executeMigraMailProvision(
  input: ProvisioningExecutionInput,
  context: MailContext,
): Promise<ProvisioningExecutionResult | null> {
  if (context.productLane !== ProductKey.MIGRAMAIL || context.action !== ProvisioningAction.MAIL_PROVISION) {
    return null;
  }

  const baseUrl = normalizeUrl(env.MIGRAMAIL_CORE_URL);
  const apiKey = asString(env.MIGRAMAIL_CORE_API_KEY);

  if (!baseUrl || !apiKey) {
    return null;
  }

  if (!context.domain || !context.mailboxEmail || !context.mailboxPassword) {
    return {
      kind: "FATAL_FAILURE",
      message: "missing_mail_context",
      metadata: {
        mode: "migramail_core",
        action: context.action,
        hasDomain: Boolean(context.domain),
        hasMailboxEmail: Boolean(context.mailboxEmail),
        hasMailboxPassword: Boolean(context.mailboxPassword),
      },
    };
  }

  const [mailboxLocalPart, mailboxDomain] = context.mailboxEmail.split("@");
  if (!mailboxLocalPart || !mailboxDomain) {
    return {
      kind: "FATAL_FAILURE",
      message: "invalid_mailbox_email",
      metadata: {
        mode: "migramail_core",
        action: context.action,
        mailboxEmail: context.mailboxEmail,
      },
    };
  }

  if (mailboxDomain.toLowerCase() !== context.domain.toLowerCase()) {
    return {
      kind: "FATAL_FAILURE",
      message: "mailbox_domain_mismatch",
      metadata: {
        mode: "migramail_core",
        action: context.action,
        domain: context.domain,
        mailboxEmail: context.mailboxEmail,
      },
    };
  }

  const domainUrl = joinUrl(baseUrl, "/v1/domains/ensure");
  const domainBody = {
    domain: context.domain,
  };

  const domainController = new AbortController();
  const domainTimer = setTimeout(() => domainController.abort(), provisioningDispatchTimeoutMs);

  try {
    const domainResponse = await fetch(domainUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(domainBody),
      signal: domainController.signal,
    });

    const domainText = await domainResponse.text();
    const domainMetadata = {
      mode: "migramail_core",
      phase: "domain",
      dispatchUrl: domainUrl,
      action: context.action,
      productLane: context.productLane,
      status: domainResponse.status,
      ok: domainResponse.ok,
      responseText: domainText.slice(0, 2000),
      domain: context.domain,
      authenticated: true,
    };

    if (!(domainResponse.ok || domainResponse.status === 409)) {
      if (domainResponse.status === 429 || domainResponse.status >= 500) {
        return agentHttpResult("RETRYABLE_FAILURE", `migramail_domain_http_${domainResponse.status}`, domainMetadata);
      }
      return agentHttpResult("FATAL_FAILURE", `migramail_domain_http_${domainResponse.status}`, domainMetadata);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_migramail_domain_error";
    return agentHttpResult("RETRYABLE_FAILURE", "migramail_domain_network_error", {
      mode: "migramail_core",
      phase: "domain",
      dispatchUrl: domainUrl,
      action: context.action,
      productLane: context.productLane,
      error: message,
      domain: context.domain,
    });
  } finally {
    clearTimeout(domainTimer);
  }

  const mailboxUrl = joinUrl(baseUrl, `/v1/domains/${encodeURIComponent(context.domain)}/mailboxes`);
  const mailboxBody = {
    localPart: mailboxLocalPart,
    password: context.mailboxPassword,
    quotaMb: context.mailboxQuotaMb || undefined,
  };

  const mailboxController = new AbortController();
  const mailboxTimer = setTimeout(() => mailboxController.abort(), provisioningDispatchTimeoutMs);

  try {
    const mailboxResponse = await fetch(mailboxUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(mailboxBody),
      signal: mailboxController.signal,
    });

    const mailboxText = await mailboxResponse.text();
    const metadata = {
      mode: "migramail_core",
      phase: "mailbox",
      dispatchUrl: mailboxUrl,
      action: context.action,
      productLane: context.productLane,
      status: mailboxResponse.status,
      ok: mailboxResponse.ok,
      responseText: mailboxText.slice(0, 2000),
      domain: context.domain,
      mailboxEmail: context.mailboxEmail,
      authenticated: true,
    };

    if (mailboxResponse.ok || mailboxResponse.status === 409) {
      return agentHttpResult("SUCCESS", "", metadata);
    }
    if (mailboxResponse.status === 429 || mailboxResponse.status >= 500) {
      return agentHttpResult("RETRYABLE_FAILURE", `migramail_mailbox_http_${mailboxResponse.status}`, metadata);
    }
    return agentHttpResult("FATAL_FAILURE", `migramail_mailbox_http_${mailboxResponse.status}`, metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_migramail_mailbox_error";
    return agentHttpResult("RETRYABLE_FAILURE", "migramail_mailbox_network_error", {
      mode: "migramail_core",
      phase: "mailbox",
      dispatchUrl: mailboxUrl,
      action: context.action,
      productLane: context.productLane,
      error: message,
      domain: context.domain,
      mailboxEmail: context.mailboxEmail,
    });
  } finally {
    clearTimeout(mailboxTimer);
  }
}

async function executeMigraMailDisable(
  input: ProvisioningExecutionInput,
  context: MailContext,
): Promise<ProvisioningExecutionResult | null> {
  if (context.productLane !== ProductKey.MIGRAMAIL || context.action !== ProvisioningAction.MAIL_DISABLE) {
    return null;
  }

  const baseUrl = normalizeUrl(env.MIGRAMAIL_CORE_URL);
  const apiKey = asString(env.MIGRAMAIL_CORE_API_KEY);

  if (!baseUrl || !apiKey) {
    return null;
  }

  if (!context.mailboxEmail) {
    return {
      kind: "FATAL_FAILURE",
      message: "missing_mail_disable_context",
      metadata: {
        mode: "migramail_core",
        action: context.action,
        hasMailboxEmail: Boolean(context.mailboxEmail),
      },
    };
  }

  const url = joinUrl(baseUrl, `/v1/mailboxes/${encodeURIComponent(context.mailboxEmail)}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provisioningDispatchTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    const responseText = await response.text();
    const metadata = {
      mode: "migramail_core",
      phase: "suspend_mailbox",
      dispatchUrl: url,
      action: context.action,
      productLane: context.productLane,
      status: response.status,
      ok: response.ok,
      responseText: responseText.slice(0, 2000),
      mailboxEmail: context.mailboxEmail,
      authenticated: true,
    };

    if (response.ok || response.status === 409) {
      return agentHttpResult("SUCCESS", "", metadata);
    }
    if (response.status === 429 || response.status >= 500) {
      return agentHttpResult("RETRYABLE_FAILURE", `migramail_disable_http_${response.status}`, metadata);
    }
    return agentHttpResult("FATAL_FAILURE", `migramail_disable_http_${response.status}`, metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_migramail_disable_error";
    return agentHttpResult("RETRYABLE_FAILURE", "migramail_disable_network_error", {
      mode: "migramail_core",
      phase: "suspend_mailbox",
      dispatchUrl: url,
      action: context.action,
      productLane: context.productLane,
      error: message,
      mailboxEmail: context.mailboxEmail,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function executeMigraDriveProvision(
  input: ProvisioningExecutionInput,
  context: DriveContext,
): Promise<ProvisioningExecutionResult | null> {
  if (context.productLane !== ProductKey.MIGRADRIVE || context.action !== ProvisioningAction.DRIVE_PROVISION) {
    return null;
  }

  const baseUrl = normalizeUrl(env.MIGRADRIVE_PROVISION_URL);
  const token = asString(env.MIGRADRIVE_PROVISION_TOKEN);

  if (!baseUrl || !token) {
    return null;
  }

  const defaultPlan = getDefaultMigraDrivePlanConfig();
  const configuredPlan = context.planCode
    ? resolveMigraDrivePlanConfig(context.planCode)
    : defaultPlan;

  if (context.planCode && !configuredPlan && !context.storageQuotaGb) {
    return {
      kind: "FATAL_FAILURE",
      message: `migradrive_unknown_plan_code:${context.planCode}`,
      metadata: {
        phase: "drive_provision",
        productLane: context.productLane,
        planCode: context.planCode,
        orgId: context.orgId,
      },
    };
  }

  const planCode = configuredPlan?.planCode || context.planCode || defaultPlan.planCode;
  const storageQuotaGb = context.storageQuotaGb || configuredPlan?.storageQuotaGb || defaultPlan.storageQuotaGb;

  const url = joinUrl(baseUrl, "/api/internal/drive-provision");
  const requestBody = {
    idempotencyKey: input.idempotencyKey,
    orgId: context.orgId,
    orgSlug: context.orgSlug || context.orgId,
    planCode,
    storageQuotaGb,
    subscriptionId: context.subscriptionId,
    entitlementId: context.entitlementId,
    customerId: context.customerId,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provisioningDispatchTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const responseText = await response.text();

    let parsedResponse: Record<string, unknown> = {};
    try {
      parsedResponse = JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      // non-JSON response — keep empty
    }

    const metadata = {
      mode: "migradrive_provision",
      dispatchUrl: url,
      action: context.action,
      productLane: context.productLane,
      status: response.status,
      ok: response.ok,
      responseText: responseText.slice(0, 2000),
      orgId: context.orgId,
      planCode,
      storageQuotaGb,
      tenantId: parsedResponse.tenantId || null,
      externalRef: parsedResponse.externalRef || null,
      provisionedStatus: parsedResponse.status || null,
      authenticated: true,
    };

    if (response.ok || response.status === 409) {
      return agentHttpResult("SUCCESS", "", metadata);
    }
    if (response.status === 429 || response.status >= 500) {
      return agentHttpResult("RETRYABLE_FAILURE", `migradrive_provision_http_${response.status}`, metadata);
    }
    return agentHttpResult("FATAL_FAILURE", `migradrive_provision_http_${response.status}`, metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_migradrive_provision_error";
    return agentHttpResult("RETRYABLE_FAILURE", "migradrive_provision_network_error", {
      mode: "migradrive_provision",
      dispatchUrl: url,
      action: context.action,
      productLane: context.productLane,
      error: message,
      orgId: context.orgId,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function executeMigraDriveDisable(
  input: ProvisioningExecutionInput,
  context: DriveContext,
): Promise<ProvisioningExecutionResult | null> {
  if (context.productLane !== ProductKey.MIGRADRIVE || context.action !== ProvisioningAction.DRIVE_DISABLE) {
    return null;
  }

  const baseUrl = normalizeUrl(env.MIGRADRIVE_PROVISION_URL);
  const token = asString(env.MIGRADRIVE_PROVISION_TOKEN);

  if (!baseUrl || !token) {
    return null;
  }

  const url = joinUrl(baseUrl, "/api/internal/drive-provision/disable");
  const requestBody = {
    orgId: context.orgId,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provisioningDispatchTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const responseText = await response.text();
    const metadata = {
      mode: "migradrive_disable",
      dispatchUrl: url,
      action: context.action,
      productLane: context.productLane,
      status: response.status,
      ok: response.ok,
      responseText: responseText.slice(0, 2000),
      orgId: context.orgId,
      authenticated: true,
    };

    if (response.ok || response.status === 409) {
      return agentHttpResult("SUCCESS", "", metadata);
    }
    if (response.status === 429 || response.status >= 500) {
      return agentHttpResult("RETRYABLE_FAILURE", `migradrive_disable_http_${response.status}`, metadata);
    }
    return agentHttpResult("FATAL_FAILURE", `migradrive_disable_http_${response.status}`, metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_migradrive_disable_error";
    return agentHttpResult("RETRYABLE_FAILURE", "migradrive_disable_network_error", {
      mode: "migradrive_disable",
      dispatchUrl: url,
      action: context.action,
      productLane: context.productLane,
      error: message,
      orgId: context.orgId,
    });
  } finally {
    clearTimeout(timer);
  }
}

class WebhookProvisioningProvider implements ProvisioningProvider {
  async execute(input: ProvisioningExecutionInput): Promise<ProvisioningExecutionResult> {
    const context = getHostingContext(input.job);
    const mailContext = getMailContext(input.job);
    const driveContext = getDriveContext(input.job);

    const hostingProvision = await executeHostingAgentProvision(input, context);
    if (hostingProvision) {
      return hostingProvision;
    }

    const edgeProvision = await executeEdgeProxyProvision(input, context);
    if (edgeProvision) {
      return edgeProvision;
    }

    const migraMailProvision = await executeMigraMailProvision(input, mailContext);
    if (migraMailProvision) {
      return migraMailProvision;
    }

    const migraMailDisable = await executeMigraMailDisable(input, mailContext);
    if (migraMailDisable) {
      return migraMailDisable;
    }

    const driveProvision = await executeMigraDriveProvision(input, driveContext);
    if (driveProvision) {
      return driveProvision;
    }

    const driveDisable = await executeMigraDriveDisable(input, driveContext);
    if (driveDisable) {
      return driveDisable;
    }

    if (
      context.productLane === ProductKey.MIGRAHOSTING &&
      context.action === ProvisioningAction.STORAGE_PROVISION
    ) {
      return {
        kind: "SUCCESS",
        metadata: {
          mode: "migrahosting_storage",
          action: context.action,
          status: "handled_by_pod_create",
          domain: context.domain,
          tenantId: context.tenantId,
          serviceInstanceId: context.serviceInstanceId,
        },
      };
    }

    const target = resolveDispatchTarget(input.job);
    if (!target) {
      return {
        kind: "FATAL_FAILURE",
        message: "missing_dispatch_target",
        metadata: {
          mode: "webhook",
          productLane: context.productLane,
          action: context.action,
          hasDefaultUrl: Boolean(env.PROVISIONING_DISPATCH_URL),
          hasDefaultToken: Boolean(env.PROVISIONING_DISPATCH_TOKEN),
        },
      };
    }

    const payload = createDispatchPayload(input);
    const signature = buildDispatchSignature(payload, target.token);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), provisioningDispatchTimeoutMs);

    try {
      const response = await fetch(target.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${target.token}`,
          "x-migrateck-provisioning-signature": signature,
          "x-migrateck-job-id": input.job.id,
          "x-idempotency-key": input.idempotencyKey,
          "x-product-lane": target.productLane || "",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseText = await response.text();
      const metadata = {
        mode: "webhook",
        dispatchUrl: target.url,
        dispatchSource: target.source,
        productLane: target.productLane,
        status: response.status,
        ok: response.ok,
        responseText: responseText.slice(0, 2000),
      } as Prisma.InputJsonValue;

      if (response.ok || response.status === 409) {
        return {
          kind: "SUCCESS",
          metadata,
        };
      }

      if (response.status === 429 || response.status >= 500) {
        return {
          kind: "RETRYABLE_FAILURE",
          message: `dispatch_http_${response.status}`,
          metadata,
        };
      }

      return {
        kind: "FATAL_FAILURE",
        message: `dispatch_http_${response.status}`,
        metadata,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_dispatch_error";
      return {
        kind: "RETRYABLE_FAILURE",
        message: "dispatch_network_error",
        metadata: {
          mode: "webhook",
          dispatchUrl: target.url,
          dispatchSource: target.source,
          productLane: target.productLane,
          error: message,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

let cachedProvider: ProvisioningProvider | null = null;

export function getProvisioningProvider(): ProvisioningProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  if (provisioningEngineDryRun) {
    cachedProvider = new DryRunProvisioningProvider();
    return cachedProvider;
  }

  cachedProvider = new WebhookProvisioningProvider();
  return cachedProvider;
}

export function setProvisioningProviderForTests(provider: ProvisioningProvider | null): void {
  cachedProvider = provider;
}
