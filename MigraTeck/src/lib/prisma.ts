import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

const globalForPrisma = globalThis as typeof globalThis & {
  prismaGlobal?: PrismaClient;
};

export const prisma =
  globalForPrisma.prismaGlobal ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaGlobal = prisma;
}
