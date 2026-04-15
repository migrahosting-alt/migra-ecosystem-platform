import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getAuthClientConfig } from "./config";
import type { AppSession } from "./types";

function sign(data: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

function signaturesMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function encode(session: AppSession, secret: string) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

function decode(raw: string, secret: string): AppSession | null {
  const [payload, signature] = raw.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expected = sign(payload, secret);
  if (!signaturesMatch(signature, expected)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AppSession;
  } catch {
    return null;
  }
}

function secureCookies(appBaseUrl: string) {
  return appBaseUrl.startsWith("https://") || process.env.NODE_ENV === "production";
}

export async function setAppSession(session: AppSession) {
  const cfg = getAuthClientConfig();
  const store = await cookies();

  store.set(cfg.sessionCookieName, encode(session, cfg.sessionSecret), {
    httpOnly: true,
    secure: secureCookies(cfg.appBaseUrl),
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000)),
  });
}

export async function getAppSession(): Promise<AppSession | null> {
  const cfg = getAuthClientConfig();
  const store = await cookies();
  const raw = store.get(cfg.sessionCookieName)?.value;

  if (!raw) {
    return null;
  }

  const session = decode(raw, cfg.sessionSecret);
  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    return null;
  }

  return session;
}

export async function clearAppSession() {
  const cfg = getAuthClientConfig();
  const store = await cookies();

  store.set(cfg.sessionCookieName, "", {
    httpOnly: true,
    secure: secureCookies(cfg.appBaseUrl),
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}
