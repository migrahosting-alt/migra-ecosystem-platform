/**
 * Users module — account creation, lookup, status management.
 * Passwords live in user_credentials (not on the user row).
 */
import { db } from "../../lib/db.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { generateToken, hashToken } from "../../lib/crypto.js";
import { config } from "../../config/env.js";
import type { User } from "../../prisma-client.js";

export type { User };

export async function createUser(
  email: string,
  password: string,
  displayName?: string,
): Promise<User> {
  const secretHash = await hashPassword(password);
  return db.user.create({
    data: {
      email,
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
  return db.user.update({
    where: { id: userId },
    data: {
      emailVerifiedAt: new Date(),
      status: "ACTIVE",
    },
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
