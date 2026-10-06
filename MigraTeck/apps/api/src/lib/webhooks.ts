import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { promises as dns } from "node:dns";
import https from "node:https";
import net from "node:net";
import type { FastifyRequest } from "fastify";
import { getDb } from "./db.js";

const SECRET_PREFIX = "enc:v1";
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000];
const DELIVERY_LEASE_MS = 30_000;
const RESPONSE_LIMIT_BYTES = 8_192;

export type WebhookEventCatalogItem = {
  event: string;
  category: string;
  readiness: "live" | "contract";
  description: string;
};

export const WEBHOOK_EVENT_CATALOG: readonly WebhookEventCatalogItem[] = [
  { event: "api_key.created", category: "Developer", readiness: "live", description: "An organization API key was created." },
  { event: "api_key.revoked", category: "Developer", readiness: "live", description: "An organization API key was revoked." },
  { event: "incident.created", category: "Operations", readiness: "contract", description: "A VPS incident was opened or reopened." },
  { event: "incident.resolved", category: "Operations", readiness: "contract", description: "A VPS incident was resolved." },
  { event: "provisioning.job_failed", category: "Provisioning", readiness: "contract", description: "A provisioning execution failed." },
  { event: "provisioning.job_dead", category: "Provisioning", readiness: "contract", description: "A provisioning execution exhausted retries." },
  { event: "billing.payment_failed", category: "Commerce", readiness: "contract", description: "A payment attempt failed." },
  { event: "billing.invoice_overdue", category: "Commerce", readiness: "contract", description: "An invoice became overdue." },
  { event: "billing.subscription_created", category: "Commerce", readiness: "contract", description: "A subscription was created." },
  { event: "billing.subscription_cancelled", category: "Commerce", readiness: "contract", description: "A subscription was cancelled." },
  { event: "billing.checkout_completed", category: "Commerce", readiness: "contract", description: "A checkout completed successfully." },
  { event: "security.account_locked", category: "Security", readiness: "contract", description: "An organization account was locked." },
  { event: "security.suspicious_login", category: "Security", readiness: "contract", description: "A suspicious sign-in was detected." },
  { event: "usage.quota_exceeded", category: "Usage", readiness: "contract", description: "An organization exceeded a usage quota." },
  { event: "system.health_degraded", category: "System", readiness: "contract", description: "A platform service entered degraded health." },
  { event: "entitlement.granted", category: "Entitlements", readiness: "contract", description: "A product entitlement was granted." },
  { event: "entitlement.revoked", category: "Entitlements", readiness: "contract", description: "A product entitlement was revoked." },
  { event: "builder.site_published", category: "Products", readiness: "contract", description: "A Builder site was published." },
  { event: "org.created", category: "Organization", readiness: "contract", description: "An organization was created." },
  { event: "webhook.endpoint_disabled", category: "Webhooks", readiness: "contract", description: "A webhook endpoint was circuit-broken after repeated failures." },
] as const;

function getEncryptionKey(): Buffer {
  const raw = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("WEBHOOK_SECRET_ENCRYPTION_KEY is not configured");

  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error("WEBHOOK_SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

export function generateWebhookSecret(): string {
  return "whsec_" + randomBytes(32).toString("base64url");
}

export function encryptWebhookSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SECRET_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptWebhookSecret(value: string): string {
  if (!value.startsWith(SECRET_PREFIX + ":")) {
    throw new Error("Webhook signing secret is not encrypted");
  }

  const parts = value.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("Webhook signing secret has an invalid encrypted format");
  }
  const iv = Buffer.from(parts[2]!, "base64url");
  const tag = Buffer.from(parts[3]!, "base64url");
  const ciphertext = Buffer.from(parts[4]!, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error("Webhook signing secret has invalid encrypted components");
  }

  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function signWebhookPayload(secret: string, payload: string, timestamp: number): string {
  return createHmac("sha256", secret)
    .update(String(timestamp) + "." + payload)
    .digest("hex");
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    // Block IPv4-mapped IPv6 literals as a class. URL parsers may normalize
    // dotted notation into hexadecimal form, and treating the entire mapped
    // range as ineligible avoids a private-address bypass.
    return true;
  }

  return normalized === "::1"
    || normalized === "::"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
    || normalized.startsWith("ff");
}

function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  return trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
}

export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

export function validateWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error("Enter a valid HTTPS webhook URL."), { statusCode: 400 });
  }

  if (url.protocol !== "https:") {
    throw Object.assign(new Error("Webhook endpoints must use HTTPS."), { statusCode: 400 });
  }
  if (url.username || url.password) {
    throw Object.assign(new Error("Webhook URLs cannot contain embedded credentials."), { statusCode: 400 });
  }
  if (!url.hostname) {
    throw Object.assign(new Error("Webhook URL hostname is required."), { statusCode: 400 });
  }

  const hostname = normalizeHostname(url.hostname);
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
  ) {
    throw Object.assign(
      new Error("Webhook endpoints cannot target local or internal hostnames."),
      { statusCode: 400 },
    );
  }
  if (net.isIP(hostname) && isPrivateAddress(hostname)) {
    throw Object.assign(
      new Error("Webhook endpoints cannot target private or loopback addresses."),
      { statusCode: 400 },
    );
  }

  return url;
}

async function resolveSafeAddress(hostnameValue: string): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = normalizeHostname(hostnameValue);
  const directFamily = net.isIP(hostname);
  if (directFamily) {
    if (isPrivateAddress(hostname)) throw new Error("Webhook target resolved to a private address");
    return { address: hostname, family: directFamily as 4 | 6 };
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("Webhook target did not resolve");
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Webhook target resolved to a private or reserved address");
  }

  const chosen = addresses[0]!;
  return { address: chosen.address, family: chosen.family as 4 | 6 };
}

async function validateWebhookDestination(raw: string): Promise<URL> {
  const url = validateWebhookUrl(raw);
  try {
    await resolveSafeAddress(url.hostname);
  } catch {
    throw Object.assign(
      new Error("Webhook hostname must resolve only to public internet addresses."),
      { statusCode: 400 },
    );
  }
  return url;
}

async function postWebhook(urlValue: string, headers: Record<string, string>, body: string) {
  const url = validateWebhookUrl(urlValue);
  const resolved = await resolveSafeAddress(url.hostname);

  return new Promise<{ status: number; body: string; duration: number }>((resolve, reject) => {
    const started = Date.now();
    const request = https.request(
      url,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body).toString(),
        },
        timeout: 10_000,
        lookup: ((_hostname: string, _options: unknown, callback: (err: Error | null, address: string, family: number) => void) => {
          callback(null, resolved.address, resolved.family);
        }) as never,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          if (received >= RESPONSE_LIMIT_BYTES) return;
          const remaining = RESPONSE_LIMIT_BYTES - received;
          const slice = chunk.subarray(0, remaining);
          chunks.push(slice);
          received += slice.length;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            duration: Date.now() - started,
          });
        });
      },
    );

    request.on("timeout", () => request.destroy(new Error("Webhook request timed out")));
    request.on("error", reject);
    request.end(body);
  });
}

async function audit(input: {
  userId: string;
  orgId: string;
  action: string;
  entityType: string;
  entityId: string;
  request?: FastifyRequest;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  await db.query(
    'INSERT INTO "AuditLog" (id, "userId", "orgId", action, "entityType", "entityId", ip, "userAgent", metadata, "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())',
    [
      randomUUID(),
      input.userId,
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

export async function listWebhookEndpoints(orgId: string) {
  const result = await getDb().query(
    'SELECT id,url,events,status,description,"failCount","lastDeliveryAt","createdAt","updatedAt" FROM "OrgWebhookEndpoint" WHERE "orgId"=$1 ORDER BY "createdAt" DESC',
    [orgId],
  );
  return result.rows;
}

export async function createWebhookEndpoint(input: {
  orgId: string;
  userId: string;
  url: string;
  events: string[];
  description?: string | null;
  request: FastifyRequest;
}) {
  const url = (await validateWebhookDestination(input.url)).toString();
  const secret = generateWebhookSecret();
  const encrypted = encryptWebhookSecret(secret);
  const id = randomUUID();
  const events = [...new Set(input.events)];

  await getDb().query(
    'INSERT INTO "OrgWebhookEndpoint" (id,"orgId",url,secret,events,status,description,"failCount","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5::text[],\'ACTIVE\',$6,0,NOW(),NOW())',
    [id, input.orgId, url, encrypted, events, input.description ?? null],
  );
  await audit({
    userId: input.userId,
    orgId: input.orgId,
    action: "WEBHOOK_ENDPOINT_CREATED",
    entityType: "webhook_endpoint",
    entityId: id,
    request: input.request,
    metadata: { url, events },
  });

  return {
    endpoint: (await listWebhookEndpoints(input.orgId)).find((endpoint) => endpoint.id === id),
    signingSecret: secret,
  };
}

export async function updateWebhookEndpoint(input: {
  orgId: string;
  userId: string;
  endpointId: string;
  url?: string;
  events?: string[];
  description?: string | null;
  status?: "ACTIVE" | "PAUSED";
  request: FastifyRequest;
}) {
  const existing = await getDb().query(
    'SELECT id FROM "OrgWebhookEndpoint" WHERE id=$1 AND "orgId"=$2',
    [input.endpointId, input.orgId],
  );
  if (!existing.rows[0]) throw Object.assign(new Error("Webhook endpoint not found"), { statusCode: 404 });

  const updates: string[] = [];
  const values: unknown[] = [];
  const push = (sql: string, value: unknown) => {
    values.push(value);
    updates.push(sql.replace("?", "$" + values.length));
  };

  if (input.url !== undefined) {
    push('url=?', (await validateWebhookDestination(input.url)).toString());
  }
  if (input.events !== undefined) push('events=?::text[]', [...new Set(input.events)]);
  if (input.description !== undefined) push('description=?', input.description);
  if (input.status !== undefined) {
    push('status=?::"WebhookStatus"', input.status);
    if (input.status === "ACTIVE") updates.push('"failCount"=0');
  }
  updates.push('"updatedAt"=NOW()');
  values.push(input.endpointId, input.orgId);

  await getDb().query(
    'UPDATE "OrgWebhookEndpoint" SET ' + updates.join(",") + ' WHERE id=$' + (values.length - 1) + ' AND "orgId"=$' + values.length,
    values,
  );
  await audit({
    userId: input.userId,
    orgId: input.orgId,
    action: "WEBHOOK_ENDPOINT_UPDATED",
    entityType: "webhook_endpoint",
    entityId: input.endpointId,
    request: input.request,
  });
}

export async function disableWebhookEndpoint(input: {
  orgId: string;
  userId: string;
  endpointId: string;
  request: FastifyRequest;
}) {
  const result = await getDb().query(
    'UPDATE "OrgWebhookEndpoint" SET status=\'DISABLED\', "updatedAt"=NOW() WHERE id=$1 AND "orgId"=$2 RETURNING id',
    [input.endpointId, input.orgId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Webhook endpoint not found"), { statusCode: 404 });
  await audit({
    userId: input.userId,
    orgId: input.orgId,
    action: "WEBHOOK_ENDPOINT_DISABLED",
    entityType: "webhook_endpoint",
    entityId: input.endpointId,
    request: input.request,
  });
}

export async function rotateWebhookSecret(input: {
  orgId: string;
  userId: string;
  endpointId: string;
  request: FastifyRequest;
}) {
  const secret = generateWebhookSecret();
  const result = await getDb().query(
    'UPDATE "OrgWebhookEndpoint" SET secret=$1, "updatedAt"=NOW() WHERE id=$2 AND "orgId"=$3 RETURNING id',
    [encryptWebhookSecret(secret), input.endpointId, input.orgId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Webhook endpoint not found"), { statusCode: 404 });

  await audit({
    userId: input.userId,
    orgId: input.orgId,
    action: "WEBHOOK_SECRET_ROTATED",
    entityType: "webhook_endpoint",
    entityId: input.endpointId,
    request: input.request,
  });
  return secret;
}

export async function enqueueEventForOrg(input: {
  orgId: string;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  const endpoints = await getDb().query<{ id: string; events: string[] }>(
    'SELECT id,events FROM "OrgWebhookEndpoint" WHERE "orgId"=$1 AND status=\'ACTIVE\'',
    [input.orgId],
  );

  let count = 0;
  for (const endpoint of endpoints.rows) {
    if (endpoint.events.length > 0 && !endpoint.events.includes(input.eventType)) continue;
    await createDelivery(endpoint.id, input.eventType, input.payload);
    count += 1;
  }
  return count;
}

async function createDelivery(endpointId: string, eventType: string, payload: Record<string, unknown>) {
  const id = randomUUID();
  await getDb().query(
    'INSERT INTO "WebhookDelivery" (id,"endpointId","eventType",payload,status,attempts,"maxAttempts","nextRetryAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4::jsonb,\'PENDING\',0,$5,NOW(),NOW(),NOW())',
    [id, endpointId, eventType, JSON.stringify(payload), MAX_ATTEMPTS],
  );
  return id;
}

export async function enqueueTestDelivery(input: {
  orgId: string;
  userId: string;
  endpointId: string;
  request: FastifyRequest;
}) {
  const endpoint = await getDb().query(
    'SELECT id,url FROM "OrgWebhookEndpoint" WHERE id=$1 AND "orgId"=$2 AND status=\'ACTIVE\'',
    [input.endpointId, input.orgId],
  );
  if (!endpoint.rows[0]) {
    throw Object.assign(
      new Error("Webhook endpoint must be active before a test delivery can be queued"),
      { statusCode: 409 },
    );
  }

  const deliveryId = await createDelivery(input.endpointId, "platform.test", {
    test: true,
    message: "MigraTeck webhook endpoint test",
    requested_at: new Date().toISOString(),
  });
  await audit({
    userId: input.userId,
    orgId: input.orgId,
    action: "WEBHOOK_TEST_ENQUEUED",
    entityType: "webhook_delivery",
    entityId: deliveryId,
    request: input.request,
    metadata: { endpointId: input.endpointId },
  });
  return deliveryId;
}

export async function listWebhookDeliveries(orgId: string, endpointId?: string, limit = 50) {
  const values: unknown[] = [orgId];
  let extra = "";
  if (endpointId) {
    values.push(endpointId);
    extra = ' AND d."endpointId"=$2';
  }
  values.push(Math.min(Math.max(limit, 1), 100));
  const result = await getDb().query(
    'SELECT d.id,d."endpointId",d."eventType",d.status,d.attempts,d."maxAttempts",d."lastAttemptAt",d."nextRetryAt",d."httpStatus",d."responseBody",d.duration,d."createdAt",e.url FROM "WebhookDelivery" d JOIN "OrgWebhookEndpoint" e ON e.id=d."endpointId" WHERE e."orgId"=$1' + extra + ' ORDER BY d."createdAt" DESC LIMIT $' + values.length,
    values,
  );
  return result.rows;
}

export async function replayWebhookDelivery(input: {
  orgId: string;
  userId: string;
  deliveryId: string;
  request: FastifyRequest;
}) {
  const found = await getDb().query<{ endpointId: string; eventType: string; payload: Record<string, unknown> }>(
    'SELECT d."endpointId",d."eventType",d.payload FROM "WebhookDelivery" d JOIN "OrgWebhookEndpoint" e ON e.id=d."endpointId" WHERE d.id=$1 AND e."orgId"=$2 AND e.status=\'ACTIVE\'',
    [input.deliveryId, input.orgId],
  );
  const source = found.rows[0];
  if (!source) throw Object.assign(new Error("Replay source not found or endpoint is not active"), { statusCode: 404 });

  const newId = await createDelivery(source.endpointId, source.eventType, source.payload);
  await audit({
    userId: input.userId,
    orgId: input.orgId,
    action: "WEBHOOK_DELIVERY_REPLAYED",
    entityType: "webhook_delivery",
    entityId: newId,
    request: input.request,
    metadata: { sourceDeliveryId: input.deliveryId },
  });
  return newId;
}

type ClaimedDelivery = {
  id: string;
  endpointId: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  url: string;
  encryptedSecret: string;
  endpointStatus: "ACTIVE" | "PAUSED" | "DISABLED";
};

async function claimPendingDeliveries(batchSize: number): Promise<ClaimedDelivery[]> {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query(
      'SELECT d.id,d."endpointId",d."eventType",d.payload,d.attempts,d."maxAttempts",d."createdAt",e.url,e.secret AS "encryptedSecret",e.status AS "endpointStatus" FROM "WebhookDelivery" d JOIN "OrgWebhookEndpoint" e ON e.id=d."endpointId" WHERE d.status=\'PENDING\' AND d."nextRetryAt"<=NOW() ORDER BY d."nextRetryAt" ASC FOR UPDATE OF d SKIP LOCKED LIMIT $1',
      [batchSize],
    );
    const ids = selected.rows.map((row) => row.id);
    if (ids.length > 0) {
      await client.query(
        'UPDATE "WebhookDelivery" SET "nextRetryAt"=NOW()+($1::text || \' milliseconds\')::interval, "updatedAt"=NOW() WHERE id=ANY($2::text[])',
        [DELIVERY_LEASE_MS, ids],
      );
    }
    await client.query("COMMIT");
    return selected.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markDeliveryExpired(id: string) {
  await getDb().query(
    'UPDATE "WebhookDelivery" SET status=\'EXPIRED\',"nextRetryAt"=NULL,"updatedAt"=NOW() WHERE id=$1',
    [id],
  );
}

async function recordDeliverySuccess(delivery: ClaimedDelivery, result: { status: number; body: string; duration: number }) {
  const now = new Date();
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      'UPDATE "WebhookDelivery" SET status=\'DELIVERED\',attempts=$1,"lastAttemptAt"=$2,"nextRetryAt"=NULL,"httpStatus"=$3,"responseBody"=$4,duration=$5,"updatedAt"=NOW() WHERE id=$6',
      [delivery.attempts + 1, now, result.status, result.body.slice(0, 1000), result.duration, delivery.id],
    );
    await client.query(
      'UPDATE "OrgWebhookEndpoint" SET "failCount"=0,"lastDeliveryAt"=$1,"updatedAt"=NOW() WHERE id=$2',
      [now, delivery.endpointId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordDeliveryFailure(delivery: ClaimedDelivery, result: { status: number; body: string; duration: number }) {
  const nextAttempt = delivery.attempts + 1;
  const final = nextAttempt >= delivery.maxAttempts;
  const delay = RETRY_DELAYS_MS[Math.min(nextAttempt - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS.at(-1)!;
  const nextRetryAt = final ? null : new Date(Date.now() + delay);
  const db = getDb();
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      'UPDATE "WebhookDelivery" SET status=$1::"WebhookDeliveryStatus",attempts=$2,"lastAttemptAt"=NOW(),"nextRetryAt"=$3,"httpStatus"=$4,"responseBody"=$5,duration=$6,"updatedAt"=NOW() WHERE id=$7',
      [final ? "FAILED" : "PENDING", nextAttempt, nextRetryAt, result.status, result.body.slice(0, 1000), result.duration, delivery.id],
    );
    const endpoint = await client.query<{ failCount: number }>(
      'UPDATE "OrgWebhookEndpoint" SET "failCount"="failCount"+1,"updatedAt"=NOW() WHERE id=$1 RETURNING "failCount"',
      [delivery.endpointId],
    );
    if ((endpoint.rows[0]?.failCount ?? 0) >= 20) {
      await client.query(
        'UPDATE "OrgWebhookEndpoint" SET status=\'DISABLED\',"updatedAt"=NOW() WHERE id=$1',
        [delivery.endpointId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function processWebhookBatch(batchSize = 20) {
  const deliveries = await claimPendingDeliveries(batchSize);
  let processed = 0;

  for (const delivery of deliveries) {
    if (delivery.endpointStatus !== "ACTIVE") {
      await markDeliveryExpired(delivery.id);
      continue;
    }
    if (delivery.attempts >= delivery.maxAttempts) {
      await getDb().query(
        'UPDATE "WebhookDelivery" SET status=\'FAILED\',"nextRetryAt"=NULL,"updatedAt"=NOW() WHERE id=$1',
        [delivery.id],
      );
      continue;
    }

    const envelope = {
      id: delivery.id,
      type: delivery.eventType,
      created_at: new Date(delivery.createdAt).toISOString(),
      data: delivery.payload,
    };
    const body = JSON.stringify(envelope);
    const timestamp = Math.floor(Date.now() / 1000);

    try {
      const secret = decryptWebhookSecret(delivery.encryptedSecret);
      const signature = signWebhookPayload(secret, body, timestamp);
      const result = await postWebhook(
        delivery.url,
        {
          "Content-Type": "application/json",
          "User-Agent": "MigraTeck-Webhooks/1.0",
          "X-MigraTeck-Delivery": delivery.id,
          "X-MigraTeck-Event": delivery.eventType,
          "X-MigraTeck-Timestamp": String(timestamp),
          "X-MigraTeck-Signature": "v1=" + signature,
        },
        body,
      );

      if (result.status >= 200 && result.status < 300) {
        await recordDeliverySuccess(delivery, result);
      } else {
        await recordDeliveryFailure(delivery, result);
      }
    } catch (error) {
      await recordDeliveryFailure(delivery, {
        status: 0,
        body: error instanceof Error ? error.message : "Connection error",
        duration: 0,
      });
    }

    processed += 1;
  }

  return processed;
}
