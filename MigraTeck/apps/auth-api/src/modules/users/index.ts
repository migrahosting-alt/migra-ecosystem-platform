/**
 * Users module — account creation, lookup, identifiers, verification, recovery.
 */
import { db } from "../../lib/db.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { generateNumericCode, generateToken, hashToken } from "../../lib/crypto.js";
import { config } from "../../config/env.js";
import type { ParsedIdentifier } from "../../lib/identifier.js";
import type {
  User,
  UserIdentifier,
  VerificationChallenge,
} from "../../prisma-client.js";

export type { User, UserIdentifier, VerificationChallenge };

function buildUserIdentityPatch(identifier: ParsedIdentifier) {
  if (identifier.kind === "EMAIL") {
    return {
      email: identifier.normalized,
      phoneE164: null,
    };
  }

  return {
    email: null,
    phoneE164: identifier.normalized,
  };
}

export async function createUser(
  identifier: ParsedIdentifier,
  password: string,
  displayName?: string,
): Promise<{ user: User; identifier: UserIdentifier }> {
  const secretHash = await hashPassword(password);

  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        ...buildUserIdentityPatch(identifier),
        displayName: displayName ?? null,
        status: "PENDING",
        credentials: {
          create: {
            type: "PASSWORD",
            secretHash,
            priority: 0,
            isEnabled: true,
          },
        },
      },
    });

    const createdIdentifier = await tx.userIdentifier.create({
      data: {
        userId: user.id,
        kind: identifier.kind,
        normalizedValue: identifier.normalized,
        displayValue: identifier.display,
        isPrimary: true,
      },
    });

    return { user, identifier: createdIdentifier };
  });
}

export async function findIdentifierByParsedValue(
  identifier: ParsedIdentifier,
): Promise<UserIdentifier | null> {
  return db.userIdentifier.findUnique({
    where: {
      kind_normalizedValue: {
        kind: identifier.kind,
        normalizedValue: identifier.normalized,
      },
    },
  });
}

export async function findIdentifierById(id: string): Promise<UserIdentifier | null> {
  return db.userIdentifier.findUnique({ where: { id } });
}

export async function findUserByIdentifier(
  identifier: ParsedIdentifier,
): Promise<{ user: User; identifier: UserIdentifier } | null> {
  const match = await db.userIdentifier.findUnique({
    where: {
      kind_normalizedValue: {
        kind: identifier.kind,
        normalizedValue: identifier.normalized,
      },
    },
    include: { user: true },
  });

  if (!match) {
    return null;
  }

  return {
    user: match.user,
    identifier: match,
  };
}

export async function findUserByEmail(email: string): Promise<User | null> {
  return db.user.findUnique({ where: { email: email.toLowerCase() } });
}

export async function findUserById(id: string): Promise<User | null> {
  return db.user.findUnique({ where: { id } });
}

export async function verifyUserPassword(
  user: User,
  password: string,
): Promise<boolean> {
  const cred = await db.userCredential.findFirst({
    where: { userId: user.id, type: "PASSWORD", isEnabled: true },
    orderBy: { priority: "asc" },
  });
  if (!cred || !cred.secretHash) return false;
  return verifyPassword(cred.secretHash, password);
}

export async function markEmailVerified(userId: string): Promise<User> {
  return db.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        emailVerifiedAt: new Date(),
        status: "ACTIVE",
      },
    });

    if (user.email) {
      await tx.userIdentifier.updateMany({
        where: {
          userId,
          kind: "EMAIL",
          normalizedValue: user.email,
        },
        data: {
          isVerified: true,
          verifiedAt: new Date(),
          isPrimary: true,
        },
      });
    }

    return user;
  });
}

export async function markIdentifierVerified(identifierId: string): Promise<{
  user: User;
  identifier: UserIdentifier;
}> {
  return db.$transaction(async (tx) => {
    const identifier = await tx.userIdentifier.update({
      where: { id: identifierId },
      data: {
        isVerified: true,
        verifiedAt: new Date(),
      },
    });

    const user = await tx.user.update({
      where: { id: identifier.userId },
      data: {
        status: "ACTIVE",
        ...(identifier.kind === "EMAIL"
          ? {
              email: identifier.normalizedValue,
              emailVerifiedAt: new Date(),
            }
          : {
              phoneE164: identifier.normalizedValue,
              phoneVerifiedAt: new Date(),
            }),
      },
    });

    await tx.userIdentifier.updateMany({
      where: {
        userId: identifier.userId,
        kind: identifier.kind,
        id: { not: identifier.id },
      },
      data: { isPrimary: false },
    });

    const primaryIdentifier = await tx.userIdentifier.update({
      where: { id: identifier.id },
      data: { isPrimary: true },
    });

    return { user, identifier: primaryIdentifier };
  });
}

export async function updateLastLogin(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
}

export async function lockUser(userId: string): Promise<User> {
  return db.user.update({
    where: { id: userId },
    data: { status: "LOCKED", lockedAt: new Date() },
  });
}

export async function unlockUser(userId: string): Promise<User> {
  return db.user.update({
    where: { id: userId },
    data: { status: "ACTIVE", lockedAt: null },
  });
}

export async function disableUser(userId: string): Promise<User> {
  return db.user.update({
    where: { id: userId },
    data: { status: "DISABLED", disabledAt: new Date() },
  });
}

export async function changePassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  const secretHash = await hashPassword(newPassword);
  const existing = await db.userCredential.findFirst({
    where: { userId, type: "PASSWORD", isEnabled: true },
  });
  if (existing) {
    await db.userCredential.update({
      where: { id: existing.id },
      data: { secretHash },
    });
  } else {
    await db.userCredential.create({
      data: { userId, type: "PASSWORD", secretHash, priority: 0, isEnabled: true },
    });
  }
}

export async function createEmailVerification(
  userId: string,
): Promise<string> {
  const token = generateToken(32);
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.emailVerifyTtl * 1000);

  await db.emailVerification.create({
    data: { userId, tokenHash, status: "ACTIVE", expiresAt },
  });

  return token;
}

export async function consumeEmailVerification(
  token: string,
): Promise<{ userId: string } | null> {
  const tokenHash = hashToken(token);
  const record = await db.emailVerification.findFirst({
    where: {
      tokenHash,
      status: "ACTIVE",
      expiresAt: { gt: new Date() },
    },
  });
  if (!record) return null;

  await db.emailVerification.update({
    where: { id: record.id },
    data: { usedAt: new Date(), status: "USED" },
  });

  return { userId: record.userId };
}

export async function createVerificationChallenge(input: {
  userId?: string | null;
  identifierId: string;
  kind: "SIGNUP_VERIFY" | "LOGIN_STEPUP" | "RESET_PASSWORD" | "ADD_IDENTIFIER" | "CHANGE_IDENTIFIER";
  channel: "EMAIL" | "SMS";
  ipAddress?: string;
  userAgent?: string;
  maxAttempts?: number;
}): Promise<{ challenge: VerificationChallenge; code: string }> {
  const code = generateNumericCode();
  const codeHash = hashToken(code);
  const expiresAt = new Date(Date.now() + config.verificationCodeTtl * 1000);

  const challenge = await db.verificationChallenge.create({
    data: {
      userId: input.userId ?? null,
      identifierId: input.identifierId,
      kind: input.kind,
      channel: input.channel,
      codeHash,
      expiresAt,
      maxAttempts: input.maxAttempts ?? config.verificationCodeMaxAttempts,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });

  return { challenge, code };
}

export async function getVerificationChallenge(
  challengeId: string,
): Promise<(VerificationChallenge & { identifier: UserIdentifier | null }) | null> {
  return db.verificationChallenge.findUnique({
    where: { id: challengeId },
    include: { identifier: true },
  });
}

export async function getLatestVerificationChallengeForIdentifier(input: {
  identifierId: string;
  kind: "SIGNUP_VERIFY" | "LOGIN_STEPUP" | "RESET_PASSWORD" | "ADD_IDENTIFIER" | "CHANGE_IDENTIFIER";
}): Promise<VerificationChallenge | null> {
  return db.verificationChallenge.findFirst({
    where: {
      identifierId: input.identifierId,
      kind: input.kind,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function consumeVerificationChallenge(input: {
  challengeId: string;
  code: string;
  expectedKind?: "SIGNUP_VERIFY" | "LOGIN_STEPUP" | "RESET_PASSWORD" | "ADD_IDENTIFIER" | "CHANGE_IDENTIFIER";
}): Promise<
  | { ok: true; challenge: VerificationChallenge }
  | { ok: false; reason: "not_found" | "expired" | "max_attempts" | "invalid_code" }
> {
  const challenge = await db.verificationChallenge.findUnique({
    where: { id: input.challengeId },
  });

  if (!challenge || challenge.consumedAt) {
    return { ok: false, reason: "not_found" };
  }
  if (input.expectedKind && challenge.kind !== input.expectedKind) {
    return { ok: false, reason: "not_found" };
  }
  if (challenge.expiresAt <= new Date()) {
    return { ok: false, reason: "expired" };
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    return { ok: false, reason: "max_attempts" };
  }

  if (hashToken(input.code) !== challenge.codeHash) {
    await db.verificationChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: "invalid_code" };
  }

  const consumed = await db.verificationChallenge.update({
    where: { id: challenge.id },
    data: {
      consumedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  return { ok: true, challenge: consumed };
}

export async function createPasswordResetToken(
  userId: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<string> {
  const token = generateToken(32);
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.passwordResetTtl * 1000);

  await db.passwordReset.create({
    data: {
      userId,
      tokenHash,
      status: "ACTIVE",
      expiresAt,
      requestedIp: ipAddress ?? null,
      requestedUserAgent: userAgent ?? null,
    },
  });

  return token;
}

export async function consumePasswordReset(
  token: string,
): Promise<{ userId: string } | null> {
  const tokenHash = hashToken(token);
  const record = await db.passwordReset.findFirst({
    where: {
      tokenHash,
      status: "ACTIVE",
      expiresAt: { gt: new Date() },
    },
  });
  if (!record) return null;

  await db.passwordReset.update({
    where: { id: record.id },
    data: { usedAt: new Date(), status: "USED" },
  });

  return { userId: record.userId };
}
