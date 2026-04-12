import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/types";
import { prisma } from "@/lib/prisma";

const RP_NAME = process.env.WEBAUTHN_RP_NAME || "MigraTeck";
const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
const ORIGIN = process.env.WEBAUTHN_ORIGIN || `https://${RP_ID}`;

// ── Challenge store (short-lived, in-memory backed by DB-less approach) ──
// For production, use a server-side session or Redis.
// Here we use a simple Map with TTL for challenge verification.
const challengeStore = new Map<string, { challenge: string; expiresAt: number }>();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function storeChallenge(userId: string, kind: "register" | "auth", challenge: string): void {
  const key = `${kind}:${userId}`;
  challengeStore.set(key, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}

function consumeChallenge(userId: string, kind: "register" | "auth"): string | null {
  const key = `${kind}:${userId}`;
  const entry = challengeStore.get(key);
  challengeStore.delete(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.challenge;
}

// Periodic cleanup (2% chance per call)
function cleanupExpiredChallenges(): void {
  if (Math.random() > 0.02) return;
  const now = Date.now();
  for (const [key, value] of challengeStore) {
    if (value.expiresAt < now) challengeStore.delete(key);
  }
}

// ── Registration flow ──

export async function startRegistration(userId: string, userEmail: string, userName?: string | null) {
  cleanupExpiredChallenges();

  const existingPasskeys = await prisma.userPasskey.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: userEmail,
    userDisplayName: userName || userEmail,
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((pk) => ({
      id: pk.credentialId,
      transports: pk.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  storeChallenge(userId, "register", options.challenge);

  return options;
}

export async function finishRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  friendlyName?: string | null,
) {
  const expectedChallenge = consumeChallenge(userId, "register");
  if (!expectedChallenge) {
    throw new Error("Registration challenge expired or not found");
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Passkey registration verification failed");
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  const passkey = await prisma.userPasskey.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: (credential.transports ?? []) as string[],
      friendlyName: friendlyName || null,
    },
  });

  return { passkeyId: passkey.id, credentialId: passkey.credentialId };
}

// ── Authentication flow ──

export async function startAuthentication(userId?: string) {
  cleanupExpiredChallenges();

  let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;

  if (userId) {
    const passkeys = await prisma.userPasskey.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });
    allowCredentials = passkeys.map((pk) => ({
      id: pk.credentialId,
      transports: pk.transports as AuthenticatorTransportFuture[],
    }));

    if (allowCredentials.length === 0) {
      throw new Error("No passkeys registered for this user");
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
    ...(allowCredentials ? { allowCredentials } : {}),
  });

  const challengeKey = userId || "__discoverable__";
  storeChallenge(challengeKey, "auth", options.challenge);

  return { options, challengeKey };
}

export async function finishAuthentication(
  challengeKey: string,
  response: AuthenticationResponseJSON,
) {
  const expectedChallenge = consumeChallenge(challengeKey, "auth");
  if (!expectedChallenge) {
    throw new Error("Authentication challenge expired or not found");
  }

  const passkey = await prisma.userPasskey.findUnique({
    where: { credentialId: response.id },
    include: { user: true },
  });

  if (!passkey) {
    throw new Error("Passkey not found");
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: passkey.credentialId,
      publicKey: passkey.publicKey,
      counter: Number(passkey.counter),
      transports: passkey.transports as AuthenticatorTransportFuture[],
    },
  });

  if (!verification.verified) {
    throw new Error("Passkey authentication verification failed");
  }

  // Update counter + last used
  await prisma.userPasskey.update({
    where: { id: passkey.id },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter),
      lastUsedAt: new Date(),
    },
  });

  return {
    userId: passkey.userId,
    user: passkey.user,
    passkeyId: passkey.id,
    credentialId: passkey.credentialId,
  };
}

export async function listUserPasskeys(userId: string) {
  return prisma.userPasskey.findMany({
    where: { userId },
    select: {
      id: true,
      credentialId: true,
      deviceType: true,
      backedUp: true,
      friendlyName: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function removePasskey(userId: string, passkeyId: string) {
  const passkey = await prisma.userPasskey.findFirst({
    where: { id: passkeyId, userId },
  });
  if (!passkey) {
    throw new Error("Passkey not found or does not belong to user");
  }
  await prisma.userPasskey.delete({ where: { id: passkeyId } });
  return { deleted: true };
}
