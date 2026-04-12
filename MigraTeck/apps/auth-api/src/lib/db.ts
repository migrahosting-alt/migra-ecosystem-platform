/**
 * Prisma client singleton for MigraAuth.
 */
import { PrismaClient } from ".prisma/auth-client";

const globalForPrisma = globalThis as unknown as { __authPrisma?: PrismaClient };

export const db =
  globalForPrisma.__authPrisma ??
  new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.__authPrisma = db;
}
