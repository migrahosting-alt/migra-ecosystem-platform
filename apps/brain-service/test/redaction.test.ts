// Operational Readiness Slice 4 — canonical redaction, adversarial fixtures.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { redactString, redactValue, sanitizeError, redactCommandOutput, MARKERS } from '../src/engine/redaction.js';

const TOKEN = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
const APPR = 'appr_9x8y7z6w5v4u3t2s1r0q';
const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEabcdefu9w8ey\n-----END RSA PRIVATE KEY-----';
const DBURL = 'postgres://admin:s3cr3tP@ss@db-core:5432/migrapanel';
const CREDURL = 'https://user:hunter2@internal.example.com/path?api_key=SECRETVAL';
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.abcDEFghiJKLmnoPQR';
// Split so the pre-commit secret scanner does not flag the fixture literal.
const AWS = 'AKIA' + 'IOSFODNN7EXAMPLE';

test('tokens / approval tokens / JWT / AWS keys are redacted in strings', () => {
  assert.match(redactString(`x ${TOKEN} y`).value, /REDACTED_TOKEN/);
  assert.match(redactString(`x ${APPR} y`).value, /REDACTED_TOKEN/);
  assert.match(redactString(`x ${JWT} y`).value, /REDACTED_TOKEN/);
  assert.match(redactString(`x ${AWS} y`).value, /REDACTED_CREDENTIAL/);
  assert.doesNotMatch(redactString(`x ${TOKEN} y`).value, /ghp_ABC/);
});

test('PEM private key + connection string + credential URL are redacted', () => {
  assert.match(redactString(PEM).value, /REDACTED_CREDENTIAL/);
  assert.doesNotMatch(redactString(PEM).value, /MIIE/);
  assert.match(redactString(DBURL).value, /REDACTED_CREDENTIAL/);
  assert.doesNotMatch(redactString(DBURL).value, /s3cr3t/);
  assert.match(redactString(CREDURL).value, /REDACTED_CREDENTIAL/);
  assert.doesNotMatch(redactString(CREDURL).value, /hunter2/);
});

test('absolute host paths are redacted on metadata surfaces, kept in command output', () => {
  assert.match(redactString('/home/bonex/workspace/x.ts').value, /REDACTED_PATH/);
  // command output keeps program paths (content, not host metadata).
  assert.doesNotMatch(redactCommandOutput('/home/bonex/workspace/x.ts').value, /REDACTED_PATH/);
});

test('key-based: sensitive keys redact their value regardless of content', () => {
  const r = redactValue({ authorization: 'Bearer abc', password: 'pw', apiKey: 'k', database_url: 'x', nested: { client_secret: 'y', ok: 1 } }) as Record<string, unknown>;
  assert.equal(r.authorization, MARKERS.secret);
  assert.equal(r.password, MARKERS.secret);
  assert.equal(r.apiKey, MARKERS.token);
  assert.equal(r.database_url, MARKERS.credential);
  assert.equal((r.nested as Record<string, unknown>).client_secret, MARKERS.secret);
  assert.equal((r.nested as Record<string, unknown>).ok, 1);
});

test('value-pattern redaction fires even when the field name is innocuous', () => {
  const r = redactValue({ note: `deploy used ${TOKEN}`, detail: DBURL }) as Record<string, string>;
  assert.match(String(r.note), /REDACTED_TOKEN/);
  assert.match(String(r.detail), /REDACTED_CREDENTIAL/);
});

test('nested secrets in arrays/maps are redacted', () => {
  const r = redactValue({ list: [`a ${TOKEN}`, { token: 't' }], m: new Map<string, unknown>([['secret', 'v'], ['ok', 1]]) }) as Record<string, unknown>;
  const list = r.list as unknown[];
  assert.match(String(list[0]), /REDACTED_TOKEN/);
  assert.equal((list[1] as Record<string, unknown>).token, MARKERS.token);
  assert.equal((r.m as Record<string, unknown>).secret, MARKERS.secret);
});

test('secrets inside an Error.cause chain are redacted; no stack leaks', () => {
  const inner = new Error(`db failed at ${DBURL}`);
  const outer = new Error(`apply failed with token ${TOKEN}`, { cause: inner });
  const s = sanitizeError(outer);
  const flat = JSON.stringify(s);
  assert.doesNotMatch(flat, /s3cr3t|ghp_ABC|db-core/);
  assert.match(flat, /REDACTED/);
  assert.ok(!('stack' in s));
});

test('Zod issues do not leak raw secret values', () => {
  const schema = z.object({ password: z.number() });
  const res = schema.safeParse({ password: 'my-real-password' });
  assert.equal(res.success, false);
  if (!res.success) {
    const s = sanitizeError(res.error);
    assert.doesNotMatch(JSON.stringify(s), /my-real-password/);
  }
});

test('arbitrary thrown objects + strings are normalized safely', () => {
  assert.equal(sanitizeError('boom').name, 'Error');
  assert.match(sanitizeError(`raw ${TOKEN}`).message, /REDACTED_TOKEN/);
  assert.ok(sanitizeError({ weird: true }).message.length >= 0);
});

test('cyclic input cannot crash the redactor', () => {
  const a: Record<string, unknown> = { x: 1 };
  a.self = a;
  const r = redactValue(a) as Record<string, unknown>;
  assert.equal(r.x, 1);
  assert.equal(r.self, '[circular]');
});

test('oversized nested input stays bounded (depth + nodes + string length)', () => {
  // Deeply nested.
  let deep: unknown = 'leaf';
  for (let i = 0; i < 50; i++) deep = { next: deep };
  assert.doesNotThrow(() => redactValue(deep));
  // Long string truncates.
  const long = 'a'.repeat(20_000);
  assert.match(redactString(long).value, /TRUNCATED/);
});

test('command output redaction reports whether a secret was removed', () => {
  const clean = redactCommandOutput('build ok\n');
  assert.equal(clean.redacted, false);
  const dirty = redactCommandOutput(`export TOKEN=${TOKEN}\n`);
  assert.equal(dirty.redacted, true);
  assert.doesNotMatch(dirty.value, /ghp_ABC/);
});
