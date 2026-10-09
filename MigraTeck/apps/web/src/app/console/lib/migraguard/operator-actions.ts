import "server-only";

import {
  createHash,
  createPrivateKey,
  randomUUID,
  sign as signEd25519,
} from "node:crypto";
import { getSession, verifyEmail } from "../auth";

export type GuardOperatorAction =
  | "protection_alert.acknowledge"
  | "incident.notes.read"
  | "incident.assignment.options.read"
  | "incident.note.add"
  | "incident.status.update"
  | "incident.assign"
  | "protection.response.request";

export type GuardOperatorActionResult =
  | { ok: true; status: number; data: Record<string, unknown> }
  | { ok: false; status: number; error: string };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function guardOperatorParametersSha256(parameters: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(parameters)), "utf8")
    .digest("hex");
}

function guardOrigin(): string {
  const raw = process.env.MIGRAGUARD_API_URL;
  if (!raw) throw new Error("MigraGuard API is not configured");
  const url = new URL(raw);
  const privateHttp =
    url.protocol === "http:" &&
    /^(127\.0\.0\.1|localhost|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      url.hostname,
    );
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid MigraGuard API origin");
  }
  if (url.protocol !== "https:" && !privateHttp) {
    throw new Error("MigraGuard API must use HTTPS or a private HTTP address");
  }
  return url.origin;
}

function machineCredential(): string {
  const value = process.env.MIGRAGUARD_CONSOLE_API_CREDENTIAL || "";
  if (!value.startsWith("mgk_") || value.length < 20) {
    throw new Error("MigraGuard operator machine credential is not configured");
  }
  return value;
}

function signingKey() {
  const encoded = process.env.MIGRAPANEL_OPERATOR_FEDERATION_PRIVATE_KEY_B64;
  if (!encoded || encoded.length < 32) {
    throw new Error("MigraGuard operator federation signing key is not configured");
  }
  try {
    return createPrivateKey({
      key: Buffer.from(encoded, "base64"),
      format: "der",
      type: "pkcs8",
    });
  } catch {
    throw new Error("MigraGuard operator federation signing key is invalid");
  }
}

export function isGuardOperatorFederationConfigured(): boolean {
  return Boolean(
    process.env.MIGRAGUARD_API_URL &&
      process.env.MIGRAGUARD_CONSOLE_API_CREDENTIAL &&
      process.env.MIGRAPANEL_OPERATOR_FEDERATION_PRIVATE_KEY_B64,
  );
}

function safeActionError(status: number, action: GuardOperatorAction): string {
  if (status === 401) return "Operator authorization was rejected.";
  if (status === 403) return "Your operator role cannot perform this action.";
  if (status === 404 && action === "protection.response.request") return "Acknowledge this protection decision in your current session, then retry the governed response request.";
  if (status === 404) return "The target is no longer available.";
  if (status === 409) return "The action conflicted with current security state. Refresh and retry.";
  if (status === 503) return "Operator action federation is not available.";
  return "MigraGuard rejected the operator action.";
}

export async function performGuardOperatorAction(input: {
  action: GuardOperatorAction;
  targetId: string;
  parameters?: Record<string, unknown>;
}): Promise<GuardOperatorActionResult> {
  const session = await getSession() as (Awaited<ReturnType<typeof getSession>> & { sid?: string });
  if (!session || !verifyEmail(session.email)) {
    return { ok: false, status: 401, error: "Not authenticated." };
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.targetId,
    )
  ) {
    return { ok: false, status: 400, error: "Invalid security target." };
  }

  if (!session.sid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(session.sid)) {
    return { ok: false, status: 401, error: "Sign in with a federation-enabled console session before changing security cases." };
  }

  const parameters = input.parameters || {};
  const now = Math.floor(Date.now() / 1000);
  if (session.exp <= now + 5) {
    return { ok: false, status: 401, error: "Your console session has expired." };
  }

  let origin: string;
  let credential: string;
  let key: ReturnType<typeof signingKey>;
  try {
    origin = guardOrigin();
    credential = machineCredential();
    key = signingKey();
  } catch {
    return {
      ok: false,
      status: 503,
      error: "Secure MigraGuard operator actions are not provisioned.",
    };
  }

  const payload = {
    v: 1,
    iss: "migrapanel-console",
    aud: "migraguard-operator-actions",
    sub: session.email.trim().toLowerCase(),
    sid: session.sid,
    jti: randomUUID(),
    iat: now,
    exp: Math.min(now + 45, session.exp),
    sessionExp: session.exp,
    action: input.action,
    targetId: input.targetId,
    parametersSha256: guardOperatorParametersSha256(parameters),
  } as const;

  const payloadSegment = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = signEd25519(
    null,
    Buffer.from(payloadSegment, "utf8"),
    key,
  ).toString("base64url");
  const assertion = `${payloadSegment}.${signature}`;

  let response: Response;
  try {
    response = await fetch(`${origin}/v1/machine/operator-actions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ assertion, parameters }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return {
      ok: false,
      status: 503,
      error: "MigraGuard operator authority is unreachable.",
    };
  }

  let data: Record<string, unknown> = {};
  try {
    const text = await response.text();
    const responseLimit = input.action === "incident.notes.read" ? 512 * 1024 : 64 * 1024;
    if (text.length > responseLimit) {
      return {
        ok: false,
        status: 502,
        error: "MigraGuard returned an invalid operator response.",
      };
    }
    const parsed = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    return {
      ok: false,
      status: 502,
      error: "MigraGuard returned an invalid operator response.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: safeActionError(response.status, input.action),
    };
  }

  return { ok: true, status: response.status, data };
}
