import { PrismaPg } from "@prisma/adapter-pg";
import { createRequire } from "node:module";
import type {
  AuditActorType,
  MemberRole,
  OAuthClient,
  Session,
  User,
  PrismaClient as PrismaClientType,
} from "../node_modules/.prisma/auth-client/index.js";

const require = createRequire(import.meta.url);

function loadPrismaModule() {
  const candidates = [
    "../node_modules/.prisma/auth-client/index.js",
    "../../../../node_modules/.prisma/auth-client/index.js",
  ];

  for (const candidate of candidates) {
    try {
      const resolved = require.resolve(candidate);
      return require(resolved) as { PrismaClient: typeof PrismaClientType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
        continue;
      }

      throw new Error("Failed to load MigraAuth Prisma client.", {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  throw new Error(
    "Unable to resolve MigraAuth Prisma client from source or compiled layout.",
  );
}

export const { PrismaClient } = loadPrismaModule();

export function createAuthPrismaAdapter(connectionString: string) {
  return new PrismaPg({ connectionString });
}

export type { AuditActorType, MemberRole, OAuthClient, Session, User };