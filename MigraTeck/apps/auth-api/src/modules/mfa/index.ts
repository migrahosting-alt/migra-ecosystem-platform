/**
 * MFA module — TOTP enrollment and verification.
 * Uses SHA-1 based TOTP (RFC 6238) with 6-digit codes, 30s steps.
 * Challenge-based flow: enroll returns challenge_id, verify consumes it.
 */
import { createHmac, randomBytes } from "node:crypto";
import { db } from "../../lib/db.js";
import { hashToken, generateToken } from "../../lib/crypto.js";

const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = "sha1";
const TOTP_WINDOW = 1; // Allow 1 step drift
const CHALLENGE_TTL_S = 600; // 10 minutes

// ── TOTP generation ─────────────────────────────────────────────────

function generateTotpSecret(): string {
  return randomBytes(20).toString("base64url");
}

function base32Encode(buffer: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let result = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    result += alphabet[parseInt(chunk, 2)]!;
  }
  return result;
}

function computeTotp(secret: string, counter: number): string {
  const secretBuf = Buffer.from(secret, "base64url");
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac(TOTP_ALGORITHM, secretBuf);
  hmac.update(counterBuf);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1]! & 0x0f;
  const code =
    ((hash[offset]! & 0x7f) << 24) |
    ((hash[offset + 1]! & 0xff) << 16) |
    ((hash[offset + 2]! & 0xff) << 8) |
    (hash[offset + 3]! & 0xff);

  return (code % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
}

function verifyTotpCode(
  secret: string,
  code: string,
  timestamp = Date.now(),
): boolean {
  const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD);
  for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
    if (computeTotp(secret, counter + i) === code) return true;
  }
  return false;
}

// ── Enrollment ──────────────────────────────────────────────────────

export interface TotpEnrollmentResult {
  challengeId: string;
  secret: string;
  otpauthUri: string;
  recoveryCodes: string[];
}

export async function enrollTotp(
  userId: string,
  userEmail: string,
  /**
   * The name the authenticator app will show. Resolved by `resolveMfaIssuer`
   * from the signed token's client, and defaulted rather than made required so
   * every existing caller keeps working with platform branding.
   */
  issuer: string = DEFAULT_MFA_ISSUER,
): Promise<TotpEnrollmentResult> {
  // Check if already enrolled
  const existing = await db.userCredential.findFirst({
    where: { userId, type: "TOTP", isEnabled: true },
  });
  if (existing) {
    const meta = existing.metadata as Record<string, unknown>;
    if (meta["confirmed"] === true) throw new Error("TOTP already enrolled");
  }

  const secret = generateTotpSecret();
  const secretBuf = Buffer.from(secret, "base64url");
  const base32Secret = base32Encode(secretBuf);

  const otpauthUri = buildOtpauthUri({
    issuer,
    account: userEmail,
    base32Secret,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
  });

  // Store (or replace pending) credential
  if (existing) {
    await db.userCredential.update({
      where: { id: existing.id },
      data: { secretHash: secret, metadata: { confirmed: false } },
    });
  } else {
    await db.userCredential.create({
      data: {
        userId,
        type: "TOTP",
        secretHash: secret,
        metadata: { confirmed: false },
        priority: 0,
        isEnabled: true,
      },
    });
  }

  // Create challenge row
  const challengeSecret = generateToken(32);
  const challengeHash = hashToken(challengeSecret);
  const challenge = await db.mfaChallenge.create({
    data: {
      userId,
      method: "totp",
      challengeHash,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_S * 1000),
    },
  });

  // Generate recovery codes
  const recoveryCodes = generateRecoveryCodes(10);
  await storeRecoveryCodes(userId, recoveryCodes);

  return {
    challengeId: challenge.id,
    secret: base32Secret,
    otpauthUri,
    recoveryCodes,
  };
}

export async function confirmTotpEnrollment(
  userId: string,
  code: string,
  challengeId?: string,
): Promise<boolean> {
  // Validate challenge if provided
  if (challengeId) {
    const challenge = await db.mfaChallenge.findFirst({
      where: { id: challengeId, userId, method: "totp", verifiedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!challenge) return false;
  }

  const cred = await db.userCredential.findFirst({
    where: { userId, type: "TOTP", isEnabled: true },
  });
  if (!cred || !cred.secretHash) return false;

  const meta = cred.metadata as Record<string, unknown>;
  if (meta["confirmed"] === true) return false;

  if (!verifyTotpCode(cred.secretHash, code)) return false;

  await db.userCredential.update({
    where: { id: cred.id },
    data: { metadata: { confirmed: true } },
  });

  // Mark challenge as verified
  if (challengeId) {
    await db.mfaChallenge.update({
      where: { id: challengeId },
      data: { verifiedAt: new Date() },
    });
  }

  return true;
}

export async function verifyTotp(
  userId: string,
  code: string,
): Promise<boolean> {
  const cred = await db.userCredential.findFirst({
    where: { userId, type: "TOTP", isEnabled: true },
  });
  if (!cred || !cred.secretHash) return false;

  const meta = cred.metadata as Record<string, unknown>;
  if (meta["confirmed"] !== true) return false;

  return verifyTotpCode(cred.secretHash, code);
}

export async function disableTotp(userId: string): Promise<boolean> {
  const cred = await db.userCredential.findFirst({
    where: { userId, type: "TOTP" },
  });
  if (!cred) return false;

  await db.userCredential.delete({ where: { id: cred.id } });
  return true;
}

export async function hasTotpEnabled(userId: string): Promise<boolean> {
  const cred = await db.userCredential.findFirst({
    where: { userId, type: "TOTP", isEnabled: true },
  });
  if (!cred) return false;
  const meta = cred.metadata as Record<string, unknown>;
  return meta["confirmed"] === true;
}

// ── Recovery Codes ──────────────────────────────────────────────────

/**
 * ONE NORMALIZATION, USED ON BOTH SIDES.
 *
 * THE BUG THIS EXISTS TO END: codes were STORED hashed as issued —
 * `hashToken("a1b2c-3d4e5")`, dash included — and CONSUMED as
 * `hashToken(code.replace(/-/g, ""))`. Those two hashes can never be equal, so
 * every recovery code this system has ever issued was invalid the moment it was
 * printed. The one credential whose entire purpose is to work when nothing else
 * does, and it worked never.
 *
 * It hid well. A rejected recovery code is indistinguishable from a mistyped or
 * already-used one, so it reads as the person's mistake — and the people hitting
 * it are, by definition, already locked out and not in a position to argue.
 *
 * Normalizing away case and every separator is also the right behaviour on its
 * own terms: these are read off paper or a screenshot and typed by someone under
 * stress, and `A1B2C 3D4E5` is not a different code from `a1b2c-3d4e5`.
 */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const buf = randomBytes(5);
    codes.push(buf.toString("hex").match(/.{5}/g)!.join("-"));
  }
  return codes;
}

export async function storeRecoveryCodes(
  userId: string,
  codes: string[],
): Promise<void> {
  // Hashed through the SAME normalization the consume path applies. Storing the
  // raw form is what made every issued code unusable.
  const hashed = codes.map((code) => hashToken(normalizeRecoveryCode(code)));
  // Remove existing recovery codes first
  await db.userCredential.deleteMany({
    where: { userId, type: "RECOVERY_CODE" },
  });
  await db.userCredential.create({
    data: {
      userId,
      type: "RECOVERY_CODE",
      metadata: { codes: hashed },
      priority: 0,
      isEnabled: true,
    },
  });
}

export async function consumeRecoveryCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const cred = await db.userCredential.findFirst({
    where: { userId, type: "RECOVERY_CODE" },
  });
  if (!cred) return false;

  const meta = cred.metadata as Record<string, unknown>;
  const storedCodes = meta["codes"] as string[];
  const codeHash = hashToken(normalizeRecoveryCode(code));

  const idx = storedCodes.indexOf(codeHash);
  if (idx === -1) return false;

  // Remove used code
  storedCodes.splice(idx, 1);
  await db.userCredential.update({
    where: { id: cred.id },
    data: { metadata: { codes: storedCodes } },
  });

  return true;
}

/**
 * Whose name an authenticator app should show for this enrolment.
 *
 * WHY THIS IS NOT A CONSTANT. MigraAuth is shared identity infrastructure: the
 * same MFA service enrols users of MigraPilot, MigraHosting and everything else
 * on the platform. Hardcoding one product's name -- as this did, globally, as
 * "MigraTeck" -- meant a person enrolling from MigraPilot got an authenticator
 * entry labelled with a name they never used, and someone holding entries from
 * two MigraTeck products could not tell them apart at all.
 *
 * WHY IT IS DERIVED, NOT PASSED. The client id comes from the SIGNED access
 * token, so it is a fact about the credential rather than a claim in the
 * request. Accepting an issuer from the caller would let anyone holding a token
 * choose how MigraAuth brands itself inside a security app, which is precisely
 * the trust an authenticator entry is meant to carry.
 *
 * FIRST-PARTY ONLY. A third-party integration must not be able to make its
 * enrolments look like a MigraTeck product; those fall back to the platform
 * name, as do cookie-session enrolments from MigraAuth's own UI, which have no
 * OAuth client at all.
 */
export const DEFAULT_MFA_ISSUER = "MigraTeck";

/**
 * The Key URI spec gives ":" structural meaning -- it separates issuer from
 * account inside the label -- so an issuer containing one produces an entry that
 * parses wrongly. Stripped rather than escaped, because no correct product name
 * needs it and a mangled label is worse than a plain one.
 */
function sanitizeIssuer(value: string): string {
  return value.replace(/:/g, "").trim();
}

export async function resolveMfaIssuer(clientId?: string | null): Promise<string> {
  if (!clientId) return DEFAULT_MFA_ISSUER;

  const client = await db.oAuthClient.findUnique({
    where: { clientId },
    select: { clientName: true, branding: true, isFirstParty: true, isActive: true },
  });
  if (!client || !client.isFirstParty || !client.isActive) return DEFAULT_MFA_ISSUER;

  /*
   * SNAKE_CASE, because that is what the branding blob already uses everywhere
   * else (`public-clients.ts` reads `display_name` / `product_name` from it).
   * A camelCase key here would have silently never matched, and the fallback
   * would have hidden that by still returning something plausible.
   *
   * `mfa_issuer` first so a product can name itself differently in an
   * authenticator list than in a consent screen; `product_name` next, which is
   * what a product already sets and means exactly this; `clientName` last,
   * since the OAuth client name is an identifier that should stay stable even
   * when the shown name changes.
   */
  const branding = (client.branding ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim().length > 0 ? v : null);
  const configured =
    str(branding["mfa_issuer"]) ?? str(branding["product_name"]) ?? str(branding["display_name"]);

  const chosen = sanitizeIssuer(configured ?? client.clientName ?? "");
  return chosen.length > 0 ? chosen : DEFAULT_MFA_ISSUER;
}

/**
 * Build the otpauth URI.
 *
 * BOTH PLACES THE ISSUER APPEARS MUST AGREE. The spec puts it in the label
 * prefix AND in the `issuer` parameter; authenticators compare the two, and a
 * mismatch is treated as a different account -- some apps show a duplicate, some
 * refuse the entry outright. They are built from one value here so they cannot
 * drift.
 *
 * BOTH ARE PERCENT-ENCODED. The previous string interpolated a bare constant,
 * which was safe only because "MigraTeck" contains nothing needing encoding; a
 * product name with a space would have produced a broken URI.
 */
export function buildOtpauthUri(input: {
  issuer: string;
  account: string;
  base32Secret: string;
  digits: number;
  period: number;
}): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: input.base32Secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(input.digits),
    period: String(input.period),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
