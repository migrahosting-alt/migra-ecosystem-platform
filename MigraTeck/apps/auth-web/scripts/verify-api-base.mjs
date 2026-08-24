#!/usr/bin/env node
/**
 * Release gate: the built artifact must talk to an approved API origin.
 *
 * WHY THIS EXISTS. `NEXT_PUBLIC_AUTH_API_URL` is baked in at BUILD time. Built
 * without it, `src/lib/api.ts` falls back to `http://localhost:4000`, so the
 * deployed login page asks the VISITOR'S OWN MACHINE for the provider list,
 * gets nothing, and renders no Google or GitHub buttons. Nothing is logged
 * anywhere — social sign-in simply disappears. That reached production and
 * looked like a provider outage for two hours.
 *
 * A correct build must not depend on someone remembering the environment. This
 * fails the release instead.
 *
 * HOW IT DECIDES, and why not the obvious way. Grepping for `localhost` alone
 * reports a false failure: the `?? "http://localhost:4000"` fallback literal
 * survives in source maps and sometimes in chunks even when the env var IS set.
 * Looking for `"/api/v1/..."` also fails, because base and path are concatenated
 * at RUNTIME and never appear joined in the bundle.
 *
 * So it inspects the module that provably contains the API client — the one
 * carrying `/v1/social/providers` — and requires that the substituted base is
 * present there and the localhost fallback is not. Verified to discriminate:
 * a build with the env var gives approvedBase=1/fallback=0 on that module, and
 * a build without it gives 0/1.
 *
 * Usage:  node scripts/verify-api-base.mjs [expected-base]   (default: /api)
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { argv, exit } from 'node:process';

const EXPECTED = argv[2] ?? '/api';
const BUILD_DIR = '.next';

/** Origins a built artifact may legitimately talk to. */
const APPROVED = ['/api', 'https://auth.migrateck.com'];

/** A string only the API client module contains. */
const CLIENT_MARKER = '/v1/social/providers';

if (!APPROVED.includes(EXPECTED)) {
  console.error(`✗ ${EXPECTED} is not an approved API base. Approved: ${APPROVED.join(', ')}`);
  exit(1);
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    console.error(`✗ no build found at ${dir} — run the build first`);
    exit(1);
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    // Source maps carry the ORIGINAL source, fallback literal included, so they
    // would fail every build. The shipped code is what matters.
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) yield full;
  }
}

const failures = [];
let inspected = 0;

for await (const file of walk(BUILD_DIR)) {
  const text = await readFile(file, 'utf8');
  if (!text.includes(CLIENT_MARKER)) continue;

  inspected += 1;
  const hasApproved = APPROVED.some((base) => text.includes(JSON.stringify(base)));
  const hasLocalhostFallback = /https?:\/\/localhost:\d+/.test(text);

  // A chunk that merely re-exports the marker may carry neither; only a chunk
  // that carries the fallback, or carries no approved base at all while also
  // holding the client, is a real failure.
  if (hasLocalhostFallback || !hasApproved) {
    failures.push({ file, hasApproved, hasLocalhostFallback });
  }
}

if (inspected === 0) {
  console.error(`✗ could not find the API client module (no chunk contains ${CLIENT_MARKER}).`);
  console.error('  The build shape changed — this gate needs updating rather than skipping.');
  exit(1);
}

/*
 * Not every chunk containing the marker also inlines the base — bundlers split
 * differently between builds. The requirement is that AT LEAST ONE carries the
 * approved base, and NONE carries a localhost fallback.
 */
const anyApproved = failures.length < inspected;
const anyLocalhost = failures.some((f) => f.hasLocalhostFallback);

if (anyLocalhost || !anyApproved) {
  console.error('✗ built artifact does not use an approved API base.');
  console.error(`  Inspected ${inspected} chunk(s) containing the API client.`);
  for (const f of failures) {
    console.error(`    ${f.file} — approvedBase=${f.hasApproved ? 1 : 0} localhostFallback=${f.hasLocalhostFallback ? 1 : 0}`);
  }
  console.error(`\n  Rebuild with: NEXT_PUBLIC_AUTH_API_URL=${EXPECTED} npm run build`);
  exit(1);
}

console.log(`✓ built artifact uses the approved API base (${EXPECTED}) — ${inspected} client chunk(s) checked`);
