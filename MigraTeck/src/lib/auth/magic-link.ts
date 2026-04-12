import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

const magicLinkMaxAgeSeconds = 15 * 60;

export function createMagicLinkToken() {
  return randomBytes(32).toString("base64url");
}

export async function storeMagicLinkToken(email: string, token: string) {
  const expiresAt = new Date(Date.now() + magicLinkMaxAgeSeconds * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.verificationToken.deleteMany({
      where: {
        identifier: email,
      },
    });

    await tx.verificationToken.create({
      data: {
        identifier: email,
        token,
        expires: expiresAt,
      },
    });
  });

  return expiresAt;
}

export async function consumeMagicLinkToken(token: string) {
  const verification = await prisma.verificationToken.findUnique({
    where: { token },
  });

  if (!verification) {
    return null;
  }

  if (verification.expires < new Date()) {
    await prisma.verificationToken.delete({
      where: { token },
    }).catch(() => undefined);
    return null;
  }

  await prisma.verificationToken.delete({
    where: { token },
  });

  return verification;
}

export function normalizeMagicLinkCallbackUrl(value: string | null | undefined) {
  if (!value) {
    return "/app";
  }

  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}${url.hash}` || "/app";
  } catch {
    return "/app";
  }
}
