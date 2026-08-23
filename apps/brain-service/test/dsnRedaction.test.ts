/**
 * Nothing the migration CLI prints may carry a password.
 *
 * The rehearsal reads its DSN from a root-only EnvironmentFile precisely so the
 * value never becomes readable to an ordinary shell user. Its output, however,
 * goes to a log that a human reads afterwards — and connection failures are
 * exactly where a driver likes to echo what it tried to connect to. A DSN in
 * that log would undo the file permissions completely.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactAnyDsn } from '../src/engine/persistence/migration/runMigration.js';

const SECRET = 'Hunter2SuperSecretPassword';

test('a password in a connection string is removed', () => {
  const line = `connecting to postgresql://migrapilot_rehearsal:${SECRET}@100.77.51.91:5432/migrapilot_brain_rehearsal`;
  const out = redactAnyDsn(line);
  assert.ok(!out.includes(SECRET), 'the password must not survive');
  assert.ok(out.includes('migrapilot_rehearsal'), 'the role is not a secret and stays readable');
  assert.ok(out.includes('100.77.51.91:5432'), 'the host stays readable — it is what you debug with');
});

test('the postgres:// scheme is covered as well as postgresql://', () => {
  assert.ok(!redactAnyDsn(`postgres://role:${SECRET}@host:5432/db`).includes(SECRET));
});

test('several DSNs on one line are all redacted', () => {
  const line = `tried postgres://a:${SECRET}@h1/db then postgresql://b:${SECRET}@h2/db`;
  const out = redactAnyDsn(line);
  assert.equal(out.includes(SECRET), false);
  assert.equal((out.match(/\*\*\*/g) ?? []).length, 2, 'both are replaced, not just the first');
});

test('a multi-line stack trace is redacted throughout', () => {
  const stack = [
    'Error: connect ECONNREFUSED',
    `    at Client.connect (postgresql://migrapilot_rehearsal:${SECRET}@100.77.51.91:5432/db)`,
    '    at process.processTicksAndRejections',
  ].join('\n');
  assert.ok(!redactAnyDsn(stack).includes(SECRET));
});

test('ordinary text is left alone', () => {
  // Over-redaction would make the log useless for diagnosing anything.
  const line = 'imported 115 conversations, 270 messages — exact parity';
  assert.equal(redactAnyDsn(line), line);
});
