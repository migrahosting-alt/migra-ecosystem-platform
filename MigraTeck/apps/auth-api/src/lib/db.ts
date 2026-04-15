/**
 * Prisma client singleton for MigraAuth.
 */
import { config } from "../config/env.js";
import { createAuthPrismaAdapter, PrismaClient } from "../prisma-client.js";

type AuthPrismaClient = InstanceType<typeof PrismaClient>;

const globalForPrisma = globalThis as unknown as { __authPrisma?: AuthPrismaClient };

export const db =
  globalForPrisma.__authPrisma ??
  new PrismaClient({
    adapter: createAuthPrismaAdapter(config.databaseUrl),
    log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.__authPrisma = db;
}
