/**
 * Self-contained login gate for the Command Center.
 *
 * Auth source of truth = two env vars on app-core (loaded via
 * /etc/migrateck/console.env):
 *
 *   CONSOLE_ADMIN_EMAIL=admin@migrateck.com
 *   CONSOLE_ADMIN_PASSWORD_HASH=<output of `node -e "..." scryptSync` — see below>
 *   CONSOLE_SESSION_SECRET=<random 32+ char string used to HMAC-sign cookies>
 *
 * To generate a fresh password hash for storage:
 *   node -e "const c=require('crypto');const s=c.randomBytes(16);const h=c.scryptSync(process.argv[1], s, 64).toString('hex');console.log('scrypt\$'+s.toString('hex')+'\$'+h)" 'THE_PASSWORD'
 *
 * Verification uses crypto.timingSafeEqual to prevent timing attacks.
 */

import { cookies } from "next/headers";
import crypto from "node:crypto";

const COOKIE_NAME = "migrateck_console_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

type SessionPayload = {
  email: string;
  iat: number; // issued-at (unix seconds)
  exp: number; // expiry (unix seconds)
};

const getSecret = () => {
  const s = process.env.CONSOLE_SESSION_SECRET;
  if (!s || s.length < 24) {
    // Production should always have a strong secret. Refuse to issue sessions
    // if one isn't configured.
    throw new Error("CONSOLE_SESSION_SECRET not configured (must be ≥24 chars).");
  }
  return s;
};

const sign = (data: string, secret: string) =>
  crypto.createHmac("sha256", secret).update(data).digest("base64url");

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};

const encode = (payload: SessionPayload, secret: string): string => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
};

const decode = (raw: string, secret: string): SessionPayload | null => {
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = sign(body, secret);
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
};

export const verifyPassword = (plain: string): boolean => {
  const stored = process.env.CONSOLE_ADMIN_PASSWORD_HASH || "";
  // Format: scrypt:<saltHex>:<hashHex>
  // (Colon separator chosen so the value contains no `$` and isn't subject to
  // shell/systemd variable expansion when stored in env files.)
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  let derived: Buffer;
  try {
    derived = crypto.scryptSync(plain, salt, 64);
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
};

export const verifyEmail = (email: string): boolean => {
  const allowed = (process.env.CONSOLE_ADMIN_EMAIL || "").trim().toLowerCase();
  return Boolean(allowed) && email.trim().toLowerCase() === allowed;
};

export const issueSession = async (email: string): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    email,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const value = encode(payload, getSecret());
  const store = await cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/console",
    maxAge: SESSION_TTL_SECONDS,
  });
};

export const clearSession = async (): Promise<void> => {
  const store = await cookies();
  store.delete(COOKIE_NAME);
};

export const getSession = async (): Promise<SessionPayload | null> => {
  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null;
  }
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return decode(raw, secret);
};

export const isConfigured = () =>
  Boolean(
    process.env.CONSOLE_ADMIN_EMAIL &&
      process.env.CONSOLE_ADMIN_PASSWORD_HASH &&
      process.env.CONSOLE_SESSION_SECRET,
  );
