// Programmatic migration runner — run with: node --input-type=module < src/db/migrate.mjs
// Or: npx tsx src/db/migrate.ts
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(__dirname, "schema.sql"), "utf8");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(sql);
  console.log("✅ MigraBuilder schema applied successfully.");
} finally {
  await pool.end();
}
