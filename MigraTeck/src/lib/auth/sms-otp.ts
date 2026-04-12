import { randomInt } from "crypto";
import { authSmsMaxAttempts, authSmsCodeTtlSeconds } from "@/lib/env";
import { normalizeUsPhoneNumber } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { sendAuthLoginCodeSms } from "@/lib/sms";
import { hashToken } from "@/lib/tokens";

const LOGIN_PURPOSE = "login";

type SmsLoginUser = {
  id: string;
  name: string | null;
  email: string | null;
  phoneVerifiedAt: Date | null;
};

function generateSmsCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashSmsCode(phone: string, purpose: string, code: string): string {
  return hashToken(`${phone}:${purpose}:${code}`);
}

export async function requestLoginSmsOtp(phone: string) {
  const normalizedPhone = normalizeUsPhoneNumber(phone);
  const user = await prisma.user.findUnique({
    where: { phoneE164: normalizedPhone },
    select: { id: true },
  });

  if (!user) {
    return { sent: false as const, normalizedPhone };
  }

  const code = generateSmsCode();
  const expiresAt = new Date(Date.now() + authSmsCodeTtlSeconds * 1000);

  await prisma.smsOtpChallenge.deleteMany({
    where: {
      userId: user.id,
      phone: normalizedPhone,
      purpose: LOGIN_PURPOSE,
      usedAt: null,
    },
  });

  const challenge = await prisma.smsOtpChallenge.create({
    data: {
      userId: user.id,
      phone: normalizedPhone,
      purpose: LOGIN_PURPOSE,
      codeHash: hashSmsCode(normalizedPhone, LOGIN_PURPOSE, code),
      expiresAt,
    },
  });

  try {
    await sendAuthLoginCodeSms({ to: normalizedPhone, code });
  } catch (error) {
    await prisma.smsOtpChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
    throw error;
  }

  return { sent: true as const, normalizedPhone, expiresAt };
}

export async function verifyLoginSmsOtp(phone: string, code: string): Promise<{ ok: true; user: SmsLoginUser } | { ok: false; reason: string }> {
  const normalizedPhone = normalizeUsPhoneNumber(phone);
  const user = await prisma.user.findUnique({
    where: { phoneE164: normalizedPhone },
    select: {
      id: true,
      name: true,
      email: true,
      phoneVerifiedAt: true,
    },
  });

  if (!user) {
    return { ok: false, reason: "user_missing" };
  }

  const challenge = await prisma.smsOtpChallenge.findFirst({
    where: {
      userId: user.id,
      phone: normalizedPhone,
      purpose: LOGIN_PURPOSE,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    return { ok: false, reason: "challenge_missing" };
  }

  const codeHash = hashSmsCode(normalizedPhone, LOGIN_PURPOSE, code.trim());
  if (challenge.codeHash !== codeHash) {
    const nextAttempts = challenge.attemptCount + 1;
    await prisma.smsOtpChallenge.update({
      where: { id: challenge.id },
      data: {
        attemptCount: nextAttempts,
        ...(nextAttempts >= authSmsMaxAttempts ? { usedAt: new Date() } : {}),
      },
    });

    return { ok: false, reason: "invalid_code" };
  }

  const verifiedAt = user.phoneVerifiedAt || new Date();
  await prisma.$transaction(async (tx) => {
    await tx.smsOtpChallenge.update({
      where: { id: challenge.id },
      data: {
        attemptCount: challenge.attemptCount + 1,
        usedAt: new Date(),
      },
    });

    if (!user.phoneVerifiedAt) {
      await tx.user.update({
        where: { id: user.id },
        data: { phoneVerifiedAt: verifiedAt },
      });
    }
  });

  return {
    ok: true,
    user: {
      ...user,
      phoneVerifiedAt: verifiedAt,
    },
  };
}