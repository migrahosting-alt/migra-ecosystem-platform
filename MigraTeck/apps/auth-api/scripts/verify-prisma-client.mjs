#!/usr/bin/env node
/**
 * Release preflight: the generated Prisma client must match the schema.
 *
 * WHY THIS EXISTS. Adding `sessions.mfa_pending_at` and shipping only `dist/`
 * took authentication down. The generated client on the host predated the
 * field, so `validateSession`'s `where: { mfaPendingAt: null }` threw
 * `PrismaClientValidationError: Unknown argument mfaPendingAt` — and because
 * `/authorize` calls `optionalSession`, EVERY sign-in by anyone holding a
 * session cookie returned `internal_error`.
 *
 * It passed every local check. `tsc` was happy because the LOCAL client had been
 * regenerated; the tests were happy because they never touch a database; and the
 * live smoke I ran had cleared its cookies, so the failing branch was never
 * entered. The defect was invisible to everything except a real user with a
 * session — which is the worst possible audience to discover it.
 *
 * So this compares the schema against the generated client and refuses to
 * release when they disagree. It needs no database and takes milliseconds.
 *
 * RUN IT WHERE THE CODE WILL RUN. Checking the workstation proves nothing about
 * the host — that mismatch IS the bug this guards.
 */

import { readFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const SCHEMA = argv[2] ?? 'prisma/schema.prisma';
const CLIENT = argv[3] ?? 'node_modules/.prisma/auth-client/index.d.ts';

let schema, client;
try {
  schema = await readFile(SCHEMA, 'utf8');
} catch {
  console.error(`✗ cannot read schema at ${SCHEMA}`);
  exit(1);
}
try {
  client = await readFile(CLIENT, 'utf8');
} catch {
  console.error(`✗ cannot read generated client at ${CLIENT}`);
  console.error('  Run: npx prisma generate');
  exit(1);
}

/*
 * Parse model blocks LINE BY LINE, tracking where each one closes.
 *
 * The first version matched `/^model\s+(\w+)\s*\{([^}]*)\}/gms`, and `[^}]*`
 * ends a model at the FIRST closing brace — which in `OAuthClient` is the `{}`
 * inside `@default("{}")` on the `branding` line. Every field after it was
 * invisible: `default_post_login_url`, `support_url`, `is_first_party`,
 * `is_active`, `owner_user_id`, `account_return_url`.
 *
 * So the guard against shipping a stale client had a silent hole in exactly the
 * shape of the outage it was written for: it would have passed a client that
 * had never heard of `accountReturnUrl`, and the first symptom would have been
 * `PrismaClientValidationError` on a real request.
 *
 * A closing brace at column 0 ends a model. Prisma's own formatter guarantees
 * it, and it cannot be confused by braces inside attribute values.
 */
const missing = [];
let checked = 0;
let currentModel = null;
let unclosed = null;

for (const rawLine of schema.split('\n')) {
  const line = rawLine.trim();

  if (currentModel === null) {
    const opening = /^model\s+(\w+)\s*\{/.exec(line);
    if (opening) {
      currentModel = opening[1];
      unclosed = currentModel;
    }
    continue;
  }

  if (rawLine.startsWith('}')) {
    currentModel = null;
    unclosed = null;
    continue;
  }

  if (!line || line.startsWith('//') || line.startsWith('@@') || line.startsWith('///')) continue;

  const name = line.split(/\s+/)[0];
  if (!name || !/^[a-z][A-Za-z0-9_]*$/.test(name)) continue;

  checked += 1;
  /*
   * The generated client names every scalar field in its Where/Select types, so
   * a field the client has never heard of simply does not appear.
   */
  if (!client.includes(name)) {
    missing.push(`${currentModel}.${name}`);
  }
}

/*
 * A model left open means the parse lost track, and a parse that lost track
 * reports "no drift" for everything it never reached — the failure this guard
 * exists to make impossible.
 */
if (unclosed !== null) {
  console.error(`✗ schema parse never closed model \`${unclosed}\` — this guard cannot be trusted`);
  exit(1);
}

if (checked === 0) {
  console.error('✗ parsed no model fields — the schema shape changed and this guard needs updating');
  exit(1);
}

if (missing.length > 0) {
  console.error('✗ generated Prisma client is STALE — it does not know these schema fields:');
  for (const field of missing) console.error(`    ${field}`);
  console.error('\n  Any query touching them throws PrismaClientValidationError at runtime.');
  console.error('  Run `npx prisma generate` in THIS environment before releasing.');
  exit(1);
}

console.log(`✓ generated Prisma client matches the schema (${checked} fields checked)`);
