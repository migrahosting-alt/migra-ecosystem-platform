import { ProductKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";

interface RegisterLaunchNonceInput {
  nonce: string;
  userId: string;
  orgId: string;
  product: ProductKey;
  ttlSeconds: number;
}

export async function registerLaunchNonce(input: RegisterLaunchNonceInput): Promise<void> {
  await prisma.launchTokenNonce.create({
    data: {
      nonceHash: hashToken(input.nonce),
      userId: input.userId,
      orgId: input.orgId,
      product: input.product,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
    },
  });
}

export async function consumeLaunchNonce(input: {
  nonce: string;
  userId: string;
  orgId: string;
  product: ProductKey;
}): Promise<boolean> {
  const nonceHash = hashToken(input.nonce);

  const nonce = await prisma.launchTokenNonce.findUnique({
    where: { nonceHash },
  });

  if (!nonce) {
    return false;
  }

  if (
    nonce.usedAt ||
    nonce.expiresAt < new Date() ||
    nonce.userId !== input.userId ||
    nonce.orgId !== input.orgId ||
    nonce.product !== input.product
  ) {
    return false;
  }

  await prisma.launchTokenNonce.update({
    where: { id: nonce.id },
    data: { usedAt: new Date() },
  });

  return true;
}
