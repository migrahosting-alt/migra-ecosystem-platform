import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const projectRoot = path.resolve(__dirname, "../..");

export interface TestDatabaseContext {
  baseUrl: string;
  testUrl: string;
  schema: string;
}

export function isPostgresUrl(databaseUrl: string): boolean {
  return databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://");
}

function withSchema(databaseUrl: string, schema: string): string {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set("schema", schema);
  return parsed.toString();
}

function withoutSchema(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.delete("schema");
  return parsed.toString();
}

function runPrisma(args: string[], env: NodeJS.ProcessEnv, input?: string): void {
  execFileSync("npx", ["prisma", ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...env,
    },
    stdio: input ? ["pipe", "inherit", "inherit"] : "inherit",
    input,
  });
}

export function createTestDatabaseContext(baseUrl: string): TestDatabaseContext {
  if (!isPostgresUrl(baseUrl)) {
    throw new Error("Integration tests require a postgres connection string.");
  }

  const schemaSuffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const schema = `migrateck_it_${Date.now()}_${schemaSuffix}`;

  return {
    baseUrl,
    testUrl: withSchema(baseUrl, schema),
    schema,
  };
}

export function prepareTestDatabase(context: TestDatabaseContext): void {
  runPrisma(["db", "push", "--skip-generate"], {
    DATABASE_URL: context.testUrl,
    NODE_ENV: "test",
  });
}

export function dropTestDatabase(context: TestDatabaseContext): void {
  runPrisma(
    ["db", "execute", "--url", withoutSchema(context.baseUrl), "--stdin"],
    {
      NODE_ENV: "test",
    },
    `DROP SCHEMA IF EXISTS "${context.schema}" CASCADE;`,
  );
}

export function createTestPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set before creating the Prisma test client.");
  }

  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
    log: ["error"],
  });
}
