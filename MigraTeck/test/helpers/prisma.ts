import { PrismaClient } from "@prisma/client";
import { createTestPrismaClient } from "../setup/db";

declare global {
  var migrateckTestPrisma: PrismaClient | undefined;
}

const globalForTests = globalThis as typeof globalThis & {
  migrateckTestPrisma?: PrismaClient;
};

export const prisma = globalForTests.migrateckTestPrisma || createTestPrismaClient();

if (!globalForTests.migrateckTestPrisma) {
  globalForTests.migrateckTestPrisma = prisma;
}
