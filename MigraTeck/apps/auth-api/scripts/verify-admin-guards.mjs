#!/usr/bin/env node
/**
 * Release gate: every `/v1/admin/*` route must name an explicit permission.
 *
 * WHY A GREP IS NOT ENOUGH. The route list for this surface was built with
 * `grep 'app.post("'` — which silently missed
 * `app.post<{ Params: { id: string } }>("/v1/admin/users/:id/mfa/reset", …)`,
 * because the generic parameter sits between the method and the paren. That
 * route STRIPS SOMEONE'S SECOND FACTOR. It had been guarded only by a blanket
 * `addHook`, and the moment per-route guards replaced the hook it would have
 * shipped completely open. A test caught it; the survey that built the list did
 * not.
 *
 * So this does not read source text at all. It registers the real route
 * handlers against a bare Fastify instance and inspects the ROUTE TABLE Fastify
 * itself builds — the same structure that decides what runs at request time.
 * Syntax, formatting and generics cannot hide a route from it.
 *
 * `requirePermission` tags each guard with `platformPermission`, so a route is
 * proven authorized by the presence of that guard in its preHandler chain,
 * rather than by a string appearing near it in a file.
 *
 * Usage: node scripts/verify-admin-guards.mjs
 */

import Fastify from 'fastify';
import { exit } from 'node:process';

const { adminRoutes } = await import('../dist/apps/auth-api/src/routes/admin.js');
const { permissionOfGuard } = await import('../dist/apps/auth-api/src/middleware/session.js');

const registered = [];

const app = Fastify({ logger: false });
app.addHook('onRoute', (route) => {
  if (!String(route.url).startsWith('/v1/admin')) return;
  const handlers = [route.preHandler ?? []].flat();
  const permissions = handlers.map(permissionOfGuard).filter(Boolean);
  registered.push({ method: route.method, url: route.url, permissions });
});

/*
 * Registered exactly as the server does. If `adminRoutes` ever needs more than
 * a bare instance to register, this gate fails loudly rather than checking a
 * shape that no longer resembles production.
 */
await app.register(adminRoutes);

if (registered.length === 0) {
  console.error('✗ no /v1/admin routes registered — this guard is not testing anything');
  exit(1);
}

const unguarded = registered.filter((r) => r.permissions.length === 0);
const ambiguous = registered.filter((r) => r.permissions.length > 1);

for (const r of registered) {
  const methods = [r.method].flat().join(',');
  const mark = r.permissions.length === 1 ? '✓' : '✗';
  console.log(`  ${mark} ${methods.padEnd(6)} ${String(r.url).padEnd(34)} ${r.permissions[0] ?? '(NONE)'}`);
}

if (unguarded.length > 0) {
  console.error(`\n✗ ${unguarded.length} admin route(s) carry NO permission guard:`);
  for (const r of unguarded) console.error(`    ${[r.method].flat().join(',')} ${r.url}`);
  console.error('\n  An unguarded admin route is reachable by any signed-in account.');
  console.error('  Add { preHandler: requirePermission("platform.…") } to each.');
  exit(1);
}

/*
 * Two permission guards on one route is not "extra safe": it is two different
 * claims about what the route requires, and whichever runs first decides. That
 * ambiguity belongs in a failure, not in production.
 */
if (ambiguous.length > 0) {
  console.error(`\n✗ ${ambiguous.length} admin route(s) name more than one permission:`);
  for (const r of ambiguous) console.error(`    ${r.url} -> ${r.permissions.join(', ')}`);
  exit(1);
}

console.log(`\n✓ all ${registered.length} /v1/admin routes name exactly one explicit permission`);
await app.close();
