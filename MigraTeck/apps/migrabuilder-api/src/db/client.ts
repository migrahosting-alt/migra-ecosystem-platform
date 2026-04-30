import pg from "pg";
import { config } from "../config/env.js";

const { Pool } = pg;

export const pool = new Pool({ connectionString: config.databaseUrl });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, values);
}
